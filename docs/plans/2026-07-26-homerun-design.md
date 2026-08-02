# HomeRun - vault-backed family hub

Approved by Cooper 2026-07-26 (architecture: vault-backed on Mac; Publix: spike
when Cooper is home and logged in; timing: build now, autonomously).

Priority order (Cooper, mid-build): the FUNCTIONALITY is the product - meal
planning and household org that buys back time for Cooper and Ashlyn. The app
surface is the thinnest usable UI over that. Distribution polish is explicitly
not a goal.

## Architecture

- Data: the Obsidian vault (`~/Obsidian/HQ/Family/`) is the only datastore.
  Markdown + frontmatter, human-editable, already indexed by Basic Memory and
  read by the 5am digest. No Neon, no Supabase.
- App: Next.js (App Router, TS) at `~/Tools/homerun`, served on the Mac Studio,
  port 3010, launchd KeepAlive. LAN access for Ashlyn's phone
  (http://<mac>.local:3010, installable as PWA). Remote access later =
  Cloudflare Tunnel + Access (needs Cooper's browser login; documented, not built).
- Auth: shared household PIN -> signed cookie (HOMERUN_PIN in .env.local).
  Cloudflare Access becomes the outer wall when the tunnel lands.
- Claude bridge: API route spawns `claude -p` (same pattern as nightly triage)
  from ~/Tools/homerun with its own scoped .claude/settings.json (read vault,
  edit Family/ only, WebFetch for recipe import). Jobs dir for status/results.
- Publix pickup ordering: DEFERRED (Cooper not logged in). UI shows the
  finalized list with a copy-for-Reminders button; "Order pickup" button stubs
  to the spike doc.

## Vault data layer (Family/)

- `Meal-Plan.md` - CURRENT week. Table: Day | Breakfast | Lunch | Dinner | Notes.
  Meal cell grammar: "Tacos", "[[recipe-slug]]", "Leftovers", "Restaurant: name",
  optional "(Cooper)"/"(Ashlyn)" cook tag. Digest reads the Dinner column.
- `Weeks/Drafts/<name>.md` - proposed/draft weeks (chat planner writes here).
- `Weeks/Templates/<name>.md` - reusable week templates.
- `Weeks/Archive/YYYY-MM-DD.md` - past weeks (rotated when a new week goes live).
- `Recipes/<slug>.md` - frontmatter: title, tags[], servings, source-url,
  rating-cooper, rating-ashlyn, favorite; body: ## Ingredients (- qty unit item),
  ## Steps, ## Comments (- YYYY-MM-DD (name): text).
- `Grocery-List.md` - current list; checkboxes grouped by category headings;
  Generated-from + date in frontmatter; manual adds under ## Extras.
- `Groceries-and-Staples.md` - pantry + house staples (exists).
- `Restaurants.md` - favorites + order-history entries.
- `Ingredient-Prefs.md` - brand/label prefs per ingredient (feeds Publix later).
- `Honeydew.md` - exists; grammar `- [ ] task @due() @who() @every() @prio(hi|med|lo)`.

## Features (parity with McCallHome inventory + the new chat planner)

1. Week planner: current-week grid (B/L/D per day, cook tags, leftovers,
   restaurant), edit cells inline; draft weeks list; promote draft -> current
   (archives old week); save-as-template; apply template.
2. Chat planner (the centerpiece): conversation UI; user says what's on hand /
   constraints; Claude reads staples, prefs, recipe ratings and comments,
   recent archive (avoid repeats), proposes a week + grocery list as a DRAFT
   file; user edits in the grid and promotes. Multi-turn via history replay.
3. Recipes: searchable list (title/tag/rating/favorite filters), detail view
   (scaler for servings), star ratings per person, comments box, edit, new,
   and import-from-URL (incl. TikTok) via Claude job -> structured recipe note.
4. Grocery: generate from current week (dedupe against staples marked stocked),
   grouped by category, tap to check off, manual adds, copy-as-text for Apple
   Reminders / Publix.
5. Honeydew: list with All/Mine/ToDo/Done/Recurring filters, add/edit/complete;
   completing an @every task writes the next occurrence (same logic the nightly
   run applies).
6. Staples, Restaurants, Ingredient-Prefs: simple editable lists.
7. PWA shell: manifest + icon so it installs to the home screen; no offline
   guarantees in v1 (LAN app).

## Non-goals (v1)

App Store anything, offline sync, accounts (PIN + name picker covers two users),
push notifications (the digest is the notifier), Publix automation (spike later).

## Verification

npm run build green; smoke test every feature in the real browser (screenshots);
chat planner produces a real draft week from the real vault; digest still runs.
