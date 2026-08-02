# Publix pickup automation - spike RESULTS (2026-07-26) + remaining plan

## Proven today (Cooper logged in, Ashlyn's account, Wake Forest store)

- Session, store selection, and order history all accessible via the Chrome
  extension. Two orders mined into Family/Ingredient-Prefs.md (brand patterns:
  always-organic produce, Thousand Hills beef, Farmer Focus chicken, GreenWise
  frozen, pragmatic conventional exceptions).
- Full cart mechanic verified end to end: search -> correct product match (the
  "Buy it again" badge marks previously-purchased items, making repeat matching
  trivial) -> add to cart (badge 0->1) -> remove (cart restored empty).
- No anti-bot friction encountered at this usage level.

## What this means for the app

Pickup ordering works as an INTERACTIVE session task, not the 5am cron: the
extension needs a live session, and checkout stays human regardless (Claude
builds the cart, a human reviews and places the order). Flow: HomeRun's "Order
pickup" button (or Cooper in chat) -> live session walks Grocery-List.md using
Ingredient-Prefs.md, preferring Buy-it-again matches -> stops at review-cart ->
Cooper or Ashlyn places the order.

## Still to verify on first real order

Goal: prove or disprove that a Claude session driving the Chrome extension can
place a real Publix pickup order from the generated grocery list, before any of
it is promised in the app.

Steps (interactive session, Cooper present):
1. Cooper logs into publix.com in Chrome and sets his store + a pickup window
   manually once, so the session cookie exists.
2. Claude (with claude-in-chrome) walks the current Grocery-List.md: for each
   item, search on publix.com, pick the match using Ingredient-Prefs.md brand
   preferences, add to cart. Flag ambiguous matches instead of guessing.
3. Stop at the review-cart screen. Cooper reviews and places the order himself -
   checkout stays human (payment action, and per assistant safety rules Claude
   does not click the final place-order button).
4. Assess: hit rate on item matching, time taken, anti-bot friction, whether the
   flow survives headless-scheduled use or must stay interactive.

Decision after spike: wire "Order pickup" in the app to queue an interactive
session request (digest reminds Cooper to run it), or keep list-handoff as the
permanent flow if friction is too high.
