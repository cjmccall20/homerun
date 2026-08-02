#!/bin/bash
# Removes both agents and stops the dedicated Chrome.
set -uo pipefail
UID_NUM="$(id -u)"
for label in com.homerun.chrome com.homerun.order-runner; do
  launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null && echo "stopped $label" || echo "$label was not loaded"
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
echo "done. the chrome-profile directory (and its Publix login) is left alone."
