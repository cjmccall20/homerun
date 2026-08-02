#!/bin/bash
# The dedicated Publix Chrome.
#
# This is a SEPARATE Chrome from the one Cooper browses with: its own profile
# directory, its own window, its own cookie jar. That separation is the whole
# design. The order runner needs a logged-in Publix session it can drive at any
# hour without touching, closing, or logging out of a real browsing session.
#
# It must stay running for cart.js to attach over CDP. launchd keeps it alive.
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${HOMERUN_CHROME_PROFILE:-$REPO/chrome-profile}"
PORT="${HOMERUN_CDP_PORT:-9222}"
START_URL="https://delivery.publix.com/store/publix/storefront"

if [[ ! -x "$CHROME" ]]; then
  echo "Google Chrome is not installed at $CHROME" >&2
  exit 1
fi

mkdir -p "$PROFILE"

# HOMERUN_CHROME_EXTRA_ARGS lets you switch this to --headless=new later
# without editing the plist. Headful is the default because that is how the
# session was logged in, and storefronts are less suspicious of a real window.
#
# macOS ships bash 3.2, where expanding an EMPTY array under `set -u` is an
# unbound-variable error rather than nothing. The ${A[@]+"${A[@]}"} dance is
# the portable way to say "these arguments, if there are any". Without it this
# script dies on every boot with no extra args set, which is the normal case.
EXTRA=()
if [[ -n "${HOMERUN_CHROME_EXTRA_ARGS:-}" ]]; then
  read -r -a EXTRA <<< "$HOMERUN_CHROME_EXTRA_ARGS"
fi

exec "$CHROME" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --remote-allow-origins="http://127.0.0.1:${PORT}" \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --window-size=1280,900 \
  --window-position=40,40 \
  ${EXTRA[@]+"${EXTRA[@]}"} \
  "$START_URL"
