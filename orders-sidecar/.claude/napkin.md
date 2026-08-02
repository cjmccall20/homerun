# napkin.md - homerun-orders

Notes from building the Publix cart runner. Read before changing anything here.

## The one rule

This repo may add to a cart. It may not check out, pay, or place an order. A
human does that in the Publix app. `lib/safety.js` enforces it on every
navigation and every click, and `tests/cart.test.js` proves it. If you find
yourself adding a URL or a button label to get past that guard, stop: the guard
is the product, not an obstacle.

## Environment facts

- The dedicated Chrome runs on CDP port 9222 with its own profile at
  `chrome-profile/`. It is NOT the browser Cooper uses. It must stay running.
- `playwright-core` only, never `playwright`. We attach to an existing browser
  with `connectOverCDP`; we never download or launch a bundled one.
- Headless claude cannot use the claude-in-chrome extension. That is why this
  exists at all. Do not try to route it back through the extension.
- Both `~/Tools/homerun` and `the sidecar directory` are trusted in
  `~/.claude.json` as of 2026-07-26, so `claude -p` honours the allowlists.

## Gotchas hit while building

1. **Do not scrape by CSS class or test id.** Publix runs an Instacart
   white-label; the class names are generated and change. `lib/extract.js`
   works structurally instead: find text that is a price, walk up to the tile
   containing it, read the name and badges out of that tile. It survives a
   redesign that would break a selector list.

2. **`add` must re-search before it clicks.** Tile tags do not survive a page
   load, and each CLI invocation is a fresh process. So `add <index>` re-runs
   the stored query, then refuses to click unless the product name at that
   index still matches what the search recorded. Publix reshuffles results
   constantly and adding the wrong groceries is the expensive failure.

3. **Playwright puts ANSI colour codes in its error messages.** Those ended up
   in a job file and then on a phone screen. `cleanCause()` in `lib/browser.js`
   strips them. Anything that captures a Playwright error must go through it.

4. **`waitForLoadState("networkidle")` is not enough.** The storefront keeps
   polling, so `settle()` also waits for the DOM node count to stop changing.

5. **WatchPaths fires more than once per write**, and it fires on any change in
   the directory including our own status updates. `run-order.sh` takes a
   `mkdir` lock and only picks up jobs whose status is exactly `pending`.

6. **A job must never be left saying "building".** A phone is polling it and a
   spinner that never stops is worse than an error. If Claude exits without
   writing a result, the runner writes the failure itself. `isStalled()` in the
   app is the second line of defence for a runner that died outright.

7. **The app snapshots the grocery list server-side**, not from the phone. A
   stale screen would otherwise order last week's groceries.

8. **Job files are written to a temp name and renamed.** WatchPaths would
   otherwise hand the runner a half-written file.

9. **`Edit(path)` creates files too; this allowlist needs no `Write`.** Verified
   by experiment against Claude Code: an allowlist of Read plus Edit creates a
   brand new file under that path. If a write is ever refused, check the PATH
   against the glob before widening the permission.

## Still unverified

The scraping has never run against a logged-in Publix session. The structural
approach is deliberately markup-independent, but the first live run should be
`node cart.js search "limes"` and, if that looks wrong, `node cart.js probe
products`, which dumps how many price elements and candidate tiles were found.
Everything else (the safety boundary, the error taxonomy, the runner state
machine, the app wiring) is tested.

## 2026-07-27 - first full 42-item run, three lessons

- The shopper once audited the family's existing cart contents and died in
  analysis. Prompt now forbids reasoning about existing cart lines at all.
- Monitoring through the instrument corrupts the run: polling cart.js while a
  job shops navigates the shared Chrome under the shopper. Observe from the
  job file and the claude transcript only, never the browser.
- Search parser scraped sponsored carousels as results ("Dole pineapple for
  cilantro"), causing 18 false unavailable-skips. Anchor scraping to the real
  results grid; sponsored rails are not search results. (Fix dispatched.)

## The real cause of the carousel bug (fixed 2026-07-27)

It was not really about carousels. The scraper anchored on "an element whose
whole text is a price", and on the real results grid **no such element exists**:
Publix splits a price for screen readers, rendering `Current price: $3.29`
and then `$329` separately. So the anchor matched nothing in the results and
the only tiles it ever found were the sponsored rails further down, whose
markup differs. Hence cilantro returning Dole pineapple.

What the page actually gives you, verified by probing it:

- the real grid sits under `h1` reading `Results for "<query>"`
- every real result names itself in an `h3`
- sponsored carousel tiles use `div[role=heading]` instead, under their own `h2`
- the add button carries the full product name: `aria-label="Add 1 ct Organic Cilantro"`

So scraping now anchors on the results heading, takes the `h3`s after it, walks
up to the tile holding an Add button, and reads the price from the
`Current price:` label. Sponsored sections are excluded by name and by ancestor.

**"No results" and "could not find the grid" are now different error codes.**
Conflating them is what turned "our scraper broke" into "Publix is out of
cilantro" 18 times in one run. `RESULTS_GRID_NOT_FOUND` says explicitly that it
is not evidence the shop lacks the item.

## The cart drawer opens OVER the storefront

`cart` was reading every product tile behind the drawer: 85 rows for a cart the
badge said held 44. The drawer is `div[role="dialog"][aria-label="Cart"]`;
scoping to it is the same lesson as the search fix. Rows the parser cannot
trust (merged, duplicated, priced like a total) are returned under `suspect`
with a reason rather than presented as fact.

Still imperfect: the drawer holds more headings than it has items, so the row
count still runs above the badge, and subtotal/total often read null without
scrolling the drawer. Treat `cart` totals as indicative, not authoritative.

## Three phases instead of one turn per item (2026-07-28)

One model turn per item cost ~75 minutes for 42 items, and most turns did
something mechanical. Now: PLAN (one sonnet call decides what a good match
looks like per item), BULK (`cart.js bulk`, three tabs, no model), JUDGE (the
old shopping flow, on the leftovers only).

Measured: plan 31s for the whole list; bulk 58s per item per tab, so ~19s per
item across three tabs; judge 63s per item. A 42 item list projects to 23-28
minutes depending on how much lands in judge.

**The bulk matcher must check the product is the thing you asked for.** The
first live dry run planned "3 organic limes" and `organic-best` selected
"Terra Delyssa Olive Oil, Organic, Extra Virgin". Being organic is not being
limes. Every rule now requires all significant query words to appear in the
product name, stems included, and demotes otherwise. Head noun alone was not
enough either: it let "Thousand Hills Beef Sticks" satisfy "ground beef".

Demotion is always the safe direction. A demoted item costs the judge phase a
minute; a wrong one costs a trip back to the shop.

## What is in the cart is what has a Remove button

`clear-item` had never been run live and did not work: it walked up from the
product name hunting for a button and found a container far too small.
Publix labels the control `aria-label="Remove <exact product name>"`, so target
that directly.

That same label is the definition of a cart row, which fixed the over-counting
too. The drawer carries a "you might also like" rail whose tiles look identical
to cart lines but offer "Add 1 ct <name>" instead. Keying on the Remove control
took the cart scrape from 69 rows for a 45 item cart to exactly right: badge 2,
rows 2.
