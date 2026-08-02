# homerun-orders

Builds a Publix pickup cart for [HomeRun](..), unattended.

You tap "Build cart" in the Grocery tab on your phone. The Mac wakes up, drives
a Chrome that is already logged in to Publix, searches for each item on the
list, picks products according to the household's dietary principles and brand
preferences, and puts them in the cart. Then it stops.

**Nothing here places an order.** You open the Publix app, look at what it put
in the cart, fix anything you disagree with, and place the order yourself. The
code cannot reach a checkout or payment page even if something goes wrong: see
`lib/safety.js`, and the tests that prove it.

## One-time setup

This is the part a person has to do, and it only happens once.

### 1. Open the dedicated Chrome and log in

This Chrome is separate from the one you browse with. It has its own profile
directory, its own cookies, and its own window, so the order runner can drive
it at 6am without touching or logging out of your real browser.

```
cd the sidecar directory && ./bin/start-chrome.sh
```

That opens a Chrome window on the Publix delivery storefront. In that window:

1. Log in to your Publix account (use the one with the order history, if your
   household has more than one).
2. Set the store to the one you actually use, and confirm it says pickup.
3. Choose pickup rather than delivery, so the cart it builds is a pickup cart.
4. If Publix offers to remember the device, say yes. That is the point.

Leave it logged in. The session lives in `chrome-profile/` and persists across
restarts.

### 2. Check that the tooling can see it

In a second terminal:

```
cd the sidecar directory && node cart.js status
```

You want `"signedIn": true`. If you get `CHROME_NOT_RUNNING`, the browser from
step 1 is not up. If you get `NOT_LOGGED_IN`, finish logging in in that window.

### 3. Hand it over to launchd

Quit the Chrome you started by hand (Cmd+Q), then:

```
cd the sidecar directory && ./bin/install-launchd.sh
```

That installs two agents:

- `com.homerun.chrome` keeps the dedicated Chrome running and listening
  on port 9222, restarting it if it ever quits.
- `com.homerun.order-runner` watches
  `<homerun>/jobs/orders/` and runs an order the moment the app drops one
  there.

Confirm with `node cart.js status` one more time. The Chrome window will
reappear; minimize it and forget about it. It has to stay running, because a
closed browser has no session to drive.

To undo all of it: `./bin/uninstall-launchd.sh`. That stops both agents and
leaves `chrome-profile/` (and your Publix login) alone.

## What it does with an order

1. The app writes `<homerun>/jobs/orders/<id>.json` with a snapshot of
   every unchecked item on the grocery list.
2. launchd notices the new file and runs `bin/run-order.sh`.
3. That hands the job to `claude -p` with the prompt in `prompts/order.md` and
   a permission allowlist (`.claude/settings.json`) that permits exactly three
   things: reading the Family vault, editing the order job file, and running
   `node cart.js`. It cannot browse the web, spawn agents, or run any other
   command.
4. Claude reads `Ingredient-Prefs.md`, then for each item searches, picks a
   product, and adds it. Ambiguous items are skipped with a reason rather than
   guessed at.
5. It writes the result back into the job file. Your phone is polling it.

## cart.js

```
node cart.js status                       is Chrome up and signed in
node cart.js search "ground beef"         top results as JSON
node cart.js add 0                        add result 0 from the last search
node cart.js cart                         what is in the cart, with the total
node cart.js clear-item "Organic Limes"   take something back out
node cart.js probe [auth|products|cart]   diagnostics when the site changes
```

Every command prints one JSON object and exits 0 or 1. Failures carry a `code`
you can branch on and a `hint` a human can act on:

| code | what happened |
|---|---|
| `CHROME_NOT_RUNNING` | the dedicated Chrome is not up on port 9222 |
| `NOT_LOGGED_IN` | the profile lost its Publix session; log in again |
| `NO_RESULTS` | Publix returned nothing for that query |
| `PRODUCT_MOVED` | the product left the results between search and add, so nothing was added |
| `ADD_BUTTON_MISSING` | found the product but its Add control was not clickable, usually out of stock |
| `ITEM_NOT_IN_CART` | asked to remove something that is not there |
| `UNSAFE_ACTION` | something tried to navigate to checkout. This should never happen |

`add` deliberately re-runs the search before clicking, and refuses to add
anything whose name no longer matches what the search returned. Publix reorders
its results constantly, and silently adding the wrong groceries is the failure
that actually costs you money.

## How the page is read

`lib/extract.js` does not use Publix's CSS classes or test ids. That markup is
generated and changes without notice, and a scraper pinned to it breaks
silently on a Tuesday.

Instead it reads the page structurally: find every element whose whole text is
a price, walk up to the box that price lives in, and take the name, size and
badges out of that box. A price next to a name next to an Add button is a
product tile no matter what it is called in the DOM.

**This has not been run against a logged-in Publix session yet.** The approach
is markup-independent by design, but the first live run deserves a look:

```
node cart.js search "limes"        # do the results look right?
node cart.js probe products        # if not, this dumps what the page looks like
```

`probe` reports how many price elements and candidate tiles it found, which is
usually enough to see what changed.

## Layout

```
cart.js                  the CLI
lib/safety.js            the checkout boundary (pure, tested)
lib/extract.js           reading the storefront (in-page + pure helpers)
lib/browser.js           CDP connection, navigation, waits
bin/start-chrome.sh      launches the dedicated Chrome
bin/run-order.sh         the launchd-triggered order runner
bin/install-launchd.sh   installs both agents (run by hand, once)
prompts/order.md         what Claude is told to do with an order
launchd/*.plist          the two agents
tests/cart.test.js       node --test, no framework
chrome-profile/          the logged-in Publix session (never committed)
```

## Troubleshooting

**The app says the cart could not be built.** Read the error on the card; it is
the real one. Then `node cart.js status`.

**Every order fails with a permissions message.** Claude Code ignores this
repo's allowlist until the workspace is trusted, and it fails quietly when it
does. Fix: `cd the sidecar directory && claude`, accept the trust prompt,
`/exit`.

**Searches return nothing.** Run `node cart.js probe products`. If it reports
zero price elements, the storefront markup changed or the page did not finish
loading; if it reports plenty but no tiles, the walk-up heuristic needs a look.

**Chrome keeps reappearing.** That is `KeepAlive`. It has to stay running.
Minimize it, or stop it entirely with
`launchctl bootout gui/$(id -u)/com.homerun.chrome`.

**Logs.** `run-order.log` for order runs, `chrome.log` and `chrome.err` for the
browser.

## Adapting this to a different grocer

The architecture is grocer-agnostic; the selectors are not. What transfers
unchanged: the dedicated Chrome profile driven over CDP on port 9222, the
three-phase runner (one model call plans the whole list, a mechanical bulk
pass adds the easy items with no model involved, a judge pass shops the hard
ones properly), the job-file protocol with the app, the checkout blocklist in
lib/safety.js, and the sandbox in .claude/settings.json.template.

What is Publix-specific and needs rewriting for your store: the storefront
URLs and the sign-in detection in lib/browser.js, the search-results tile
walking in lib/extract.js and lib/search.js, and the add-to-cart flow in
lib/bulk.js. It is a few hours of work for an agent with this repo open in one
window and your grocer's storefront in the other. The method that built the
original: open the storefront in the dedicated Chrome, use `node cart.js probe
products` style DOM probes to find stable landmarks (price elements are
usually the most stable thing on a retail page - walk up from them to find the
product tile), and keep `node cart.js search "limes"` running until it returns
clean structured results. Then port the add flow the same way. Keep the
safety.js blocklist pointed at your grocer's checkout and payment URLs, and
keep the rule that nothing in this repo ever places an order.

The whole flow degrades cleanly if you skip this: order jobs queue politely
and the grocery list is always usable by hand.
