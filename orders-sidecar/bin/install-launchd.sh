#!/bin/bash
# Installs the two launchd agents. Run this once, by hand.
#
# Deliberately not run by any build step: loading these starts a Chrome window
# and arms a watcher on your filesystem, and that should be something you chose.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOMERUN="$(cd "$REPO/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"

mkdir -p "$AGENTS" "${HOMERUN_ORDERS_DIR:-$HOMERUN/jobs/orders}"

for label in com.homerun.chrome com.homerun.order-runner; do
  src="$REPO/launchd/$label.plist.template"
  dst="$AGENTS/$label.plist"
  echo "installing $label"
  sed -e "s|{{SIDECAR}}|$REPO|g" \
      -e "s|{{HOMERUN}}|$HOMERUN|g" \
      -e "s|{{HOME}}|$HOME|g" \
      "$src" > "$dst"
  launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$dst"
done

echo
echo "installed. check them with:"
echo "  launchctl print gui/$UID_NUM/com.homerun.chrome | head -20"
echo "  launchctl print gui/$UID_NUM/com.homerun.order-runner | head -20"
echo
echo "then confirm the browser side is up and logged in:"
echo "  cd $REPO && node cart.js status"
