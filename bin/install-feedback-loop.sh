#!/bin/bash
# Installs the self-update loop. Run by hand, once, on purpose.
#
# This agent lets the app rewrite its own source from a suggestion typed on a
# phone. That should never be switched on as a side effect of a build.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.cooper.homerun-feedback"
UID_NUM="$(id -u)"

mkdir -p "$REPO/jobs/feedback"
cp "$REPO/launchd/$LABEL.plist" "$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$HOME/Library/LaunchAgents/$LABEL.plist"

echo "installed $LABEL"
echo "  watch it:  tail -f $REPO/feedback-runner.log"
echo "  stop it:   launchctl bootout gui/$UID_NUM/$LABEL"
