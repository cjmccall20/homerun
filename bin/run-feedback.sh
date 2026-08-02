#!/bin/bash
# The self-update loop.
#
# launchd watches jobs/feedback/. When somebody submits a suggestion from the
# Suggestion Box, this hands it to a Claude session that may edit this repo,
# build it, commit it, and restart the service.
#
# Two rules hold this together, and both are enforced HERE rather than in the
# prompt, because a prompt is a request and a shell script is a fact:
#
#   1. A request must never be left saying "building". A phone is polling it.
#   2. If the app does not come back up after a restart, the change is reverted
#      and the request is snagged. A green build is strong evidence but it is
#      not proof that the thing still serves.
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FEEDBACK_DIR="${HOMERUN_FEEDBACK_DIR:-$REPO/jobs/feedback}"
CLAUDE_BIN="${CLAUDE_BIN:-${CLAUDE_BIN:-claude}}"
PROMPT_FILE="$REPO/prompts/feedback.md"
SETTINGS="$REPO/.claude/dev-settings.json"
LOG="$REPO/feedback-runner.log"
LOCK="$REPO/.run-feedback.lock"
HEALTH_URL="${HOMERUN_HEALTH_URL:-http://127.0.0.1:3010/login}"
SERVICE="${HOMERUN_SERVICE:-gui/$(id -u)/com.homerun.app}"
MAX_TURNS="${HOMERUN_FEEDBACK_MAX_TURNS:-150}"

mkdir -p "$FEEDBACK_DIR"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }

# One at a time. Two sessions editing the same repo would collide, and
# WatchPaths fires more than once per write.
if ! mkdir "$LOCK" 2>/dev/null; then
  log "another runner holds the lock, exiting"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

patch_request() {
  local file="$1" status="$2" blocker="${3:-}"
  node -e '
    const fs = require("node:fs");
    const [file, status, blocker] = process.argv.slice(1);
    let job = {};
    try { job = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    job.status = status;
    if (blocker) job.blocker = blocker;
    if (status === "building") job.startedAt = new Date().toISOString();
    else job.finishedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(job, null, 2) + "\n");
  ' "$file" "$status" "$blocker"
}

read_field() {
  node -e '
    const fs = require("node:fs");
    try {
      const job = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(job[process.argv[2]] ?? ""));
    } catch { process.stdout.write(""); }
  ' "$1" "$2"
}

app_healthy() {
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sS -o /dev/null --max-time 5 "$HEALTH_URL"; then return 0; fi
    sleep 2
  done
  return 1
}

shopt -s nullglob
for job_file in "$FEEDBACK_DIR"/*.json; do
  [[ "$(read_field "$job_file" status)" == "received" ]] || continue

  job_id="$(basename "$job_file" .json)"
  who="$(read_field "$job_file" who)"
  log "picking up $job_id from $who"

  before_head="$(git -C "$REPO" rev-parse HEAD)"
  patch_request "$job_file" "building"

  prompt="$(sed "s|{{JOB_FILE}}|$job_file|g" "$PROMPT_FILE")"
  output="$(cd "$REPO" && "$CLAUDE_BIN" -p "$prompt" \
    --max-turns "$MAX_TURNS" \
    --settings "$SETTINGS" 2>&1)"
  exit_code=$?

  log "$job_id claude exited $exit_code"
  printf '%s\n' "$output" >> "$LOG"

  if grep -qiE "has not been trusted|trust dialog" <<< "$output"; then
    git -C "$REPO" checkout . 2>/dev/null
    patch_request "$job_file" "snag" \
"The workspace is not trusted, so I could not change anything. Cooper needs to run 'cd $REPO && claude' once and accept the prompt."
    continue
  fi

  status="$(read_field "$job_file" status)"

  # Something shipped: prove the app actually still serves. A green build is
  # strong evidence, not proof.
  if [[ "$status" == "shipped" ]]; then
    log "$job_id reported shipped, checking the app is up"
    if ! app_healthy; then
      log "$job_id app did not come back, reverting"
      after_head="$(git -C "$REPO" rev-parse HEAD)"
      if [[ "$after_head" != "$before_head" ]]; then
        git -C "$REPO" revert --no-edit "$after_head" >> "$LOG" 2>&1
      fi
      git -C "$REPO" checkout . 2>/dev/null
      (cd "$REPO" && npm run build >> "$LOG" 2>&1)
      launchctl kickstart -k "$SERVICE" >> "$LOG" 2>&1
      app_healthy && log "$job_id rolled back and the app is up again"
      patch_request "$job_file" "snag" \
"I made the change and it built, but the app did not come back up afterwards, so I put everything back the way it was. Cooper should take a look."
      continue
    fi
    log "$job_id shipped and healthy"
    continue
  fi

  # Anything that is not a terminal state is a runner failure, not a snag the
  # session chose. Say so rather than leaving a spinner.
  if [[ "$status" != "snag" ]]; then
    git -C "$REPO" checkout . 2>/dev/null
    tail_output="$(printf '%s' "$output" | tail -c 400)"
    patch_request "$job_file" "snag" \
"Something went wrong on my side and I did not finish. Nothing was changed. (${tail_output})"
  fi
done

exit 0
