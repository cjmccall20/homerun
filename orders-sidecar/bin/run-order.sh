#!/bin/bash
# The order runner.
#
# launchd watches ~/Tools/homerun/jobs/orders/. When the HomeRun app drops an
# order job there, this wakes up, hands the job to `claude -p`, and makes sure
# the job file ends up in a terminal state no matter how that goes.
#
# The one rule: a job must never be left saying "building" forever. A phone is
# polling this file, and a spinner that never stops is worse than an error.
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORDERS_DIR="${HOMERUN_ORDERS_DIR:-$REPO/../jobs/orders}"
# The household vault, taken from the parent app's .env.local so there is one
# source of truth for where the notes live.
if [[ -z "${HOMERUN_VAULT:-}" && -f "$REPO/../.env.local" ]]; then
  HOMERUN_VAULT="$(sed -n 's/^HOMERUN_VAULT=//p' "$REPO/../.env.local" | head -1)"
fi
[[ -n "${HOMERUN_VAULT:-}" ]] || { echo "HOMERUN_VAULT is not set and $REPO/../.env.local does not define it" >&2; exit 1; }
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
PROMPT_FILE="$REPO/prompts/order.md"
LOG="$REPO/run-order.log"
LOCK="$REPO/.run-order.lock"
MAX_TURNS="${HOMERUN_ORDER_MAX_TURNS:-120}"

mkdir -p "$ORDERS_DIR"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }

# Only one runner at a time. Two Claudes filling the same cart would double
# every item, and WatchPaths fires more than once per write.
if ! mkdir "$LOCK" 2>/dev/null; then
  log "another runner holds the lock, exiting"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# Sets status/error on a job file without disturbing the rest of it.
patch_job() {
  local file="$1" status="$2" message="${3:-}"
  node -e '
    const fs = require("node:fs");
    const [file, status, message] = process.argv.slice(1);
    let job = {};
    try { job = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    job.status = status;
    if (message) job.error = message;
    if (status === "building") job.startedAt = new Date().toISOString();
    else job.finishedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(job, null, 2) + "\n");
  ' "$file" "$status" "$message"
}

read_status() {
  node -e '
    const fs = require("node:fs");
    try {
      process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).status || ""));
    } catch { process.stdout.write("unreadable"); }
  ' "$1"
}

shopt -s nullglob
for job_file in "$ORDERS_DIR"/*.json; do
  status="$(read_status "$job_file")"
  [[ "$status" == "pending" ]] || continue

  job_id="$(basename "$job_file" .json)"
  log "picking up $job_id"
  patch_job "$job_file" "building"

  # --- phase 1: plan -------------------------------------------------------
  # One model call for the whole list. It decides what a good match looks like
  # per item; nothing after this needs to ask a model about an easy item.
  log "$job_id phase 1: planning"
  plan_prompt="$(sed -e "s|{{JOB_FILE}}|$job_file|g" -e "s|{{VAULT}}|$HOMERUN_VAULT|g" "$REPO/prompts/plan.md")"
  plan_started=$(date +%s)
  plan_out="$(cd "$REPO" && "$CLAUDE_BIN" -p "$plan_prompt" --model "${ORDER_MODEL:-sonnet}" \
    --max-turns 20 \
    --settings "$REPO/.claude/settings.json" \
    --add-dir "$ORDERS_DIR" \
    --add-dir "$HOMERUN_VAULT" 2>&1)"
  plan_seconds=$(( $(date +%s) - plan_started ))
  log "$job_id planning took ${plan_seconds}s"
  printf '%s\n' "$plan_out" >> "$LOG"

  if grep -qiE "has not been trusted|trust dialog" <<< "$plan_out"; then
    patch_job "$job_file" "failed" \
"The workspace is not trusted, so nothing could run. You need to run 'cd $REPO && claude' once and accept the prompt."
    continue
  fi

  # --- phase 2: bulk -------------------------------------------------------
  # Mechanical execution of the plan, three tabs at a time. No model involved.
  bulk_seconds=0
  if [[ -f "$job_file.plan.json" ]]; then
    log "$job_id phase 2: bulk"
    bulk_started=$(date +%s)
    (cd "$REPO" && node cart.js bulk "$job_file.plan.json" \
      --tabs "${ORDER_TABS:-3}" --rate "${ORDER_ADD_RATE:-2}" >> "$LOG" 2>&1) || true
    bulk_seconds=$(( $(date +%s) - bulk_started ))
    log "$job_id bulk took ${bulk_seconds}s"
  else
    log "$job_id no plan file; everything falls through to the judge phase"
  fi

  # --- phase 3: judge ------------------------------------------------------
  # The genuinely hard items, shopped properly, and the final result write.
  log "$job_id phase 3: judging"
  prompt="$(sed -e "s|{{JOB_FILE}}|$job_file|g" -e "s|{{VAULT}}|$HOMERUN_VAULT|g" "$PROMPT_FILE")"
  judge_started=$(date +%s)
  output="$(cd "$REPO" && "$CLAUDE_BIN" -p "$prompt" --model "${ORDER_MODEL:-sonnet}" \
    --max-turns "$MAX_TURNS" \
    --settings "$REPO/.claude/settings.json" \
    --add-dir "$ORDERS_DIR" \
    --add-dir "$HOMERUN_VAULT" 2>&1)"
  exit_code=$?
  judge_seconds=$(( $(date +%s) - judge_started ))
  log "$job_id phases: plan ${plan_seconds}s, bulk ${bulk_seconds}s, judge ${judge_seconds}s"

  log "$job_id claude exited $exit_code"
  printf '%s\n' "$output" >> "$LOG"

  # The trust gate is a success that lies: without it Claude Code silently
  # drops the permission allowlist, denies every tool call, and still exits 0.
  if grep -qiE "has not been trusted|trust dialog" <<< "$output"; then
    patch_job "$job_file" "failed" \
"Claude Code is ignoring this workspace's permission allowlist because the
workspace has not been trusted, so it could not run cart.js. One-time fix:
run 'cd $REPO && claude' in a terminal, accept the trust prompt, then /exit."
    continue
  fi

  final="$(read_status "$job_file")"
  if [[ "$final" == "building" ]]; then
    # Claude finished without writing a result. Say so rather than spinning.
    tail_output="$(printf '%s' "$output" | tail -c 600)"
    patch_job "$job_file" "failed" \
"The order run finished without writing a result (claude exited ${exit_code}). Last output: ${tail_output}"
  fi
  log "$job_id finished as $(read_status "$job_file")"
done

exit 0
