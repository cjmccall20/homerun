# FOR HomeRun

A plain-language tour of what this thing is, why it is built the way it is, and
where the bodies are buried. Written for whoever opens this repo next, which is
probably Cooper in eight months wondering what past-Cooper was thinking.

## The one-sentence version

HomeRun is a phone-shaped window onto a folder of markdown files.

That is the whole idea, and almost every decision below falls out of it.

## Why there is no database

The obvious way to build a family meal planner is Postgres, a couple of tables,
an ORM, a migration folder. We did not do that, and the reason is worth stating
plainly.

The meal plan already existed. It lived in `~/Obsidian/HQ/Family/Meal-Plan.md`
as a markdown table, where Cooper could edit it in Obsidian on the couch, where
Basic Memory had already indexed it, and where the 5am digest already read it to
say what was for dinner. A database would not have replaced that file. It would
have created a *second* copy of the truth, and then the real work of the project
would have been syncing two things that disagree.

So the vault is the database. There is no schema migration because there is no
schema, only files a human can read. Delete this app tomorrow and the household
loses a nice interface, not its data. That is the property worth protecting.

The cost is real and you should know it: no transactions, no queries, no
referential integrity. If two phones write the same file in the same second, the
last one wins. For a household of two, that is a trade worth making. For a
hundred users it would be malpractice.

## The prime directive: do not mangle the files

Here is the trap. The lazy way to edit a markdown file with frontmatter is:

```
parse the whole file -> mutate the object -> serialize the whole file
```

Do that once and your file comes back subtly different. `tags: [a, b]` becomes a
block list. Empty values become the literal word `null`. Comment spacing moves.
Key order changes. None of it breaks the parser, and all of it makes Obsidian
show a diff on a file the user never touched. Do it enough times and the notes
stop looking hand-written, which was the entire point.

So HomeRun reads with a tolerant parser and writes with a scalpel.
`src/lib/md.ts` works on the original array of lines and touches only the lines
it was asked to touch:

- Setting a rating rewrites exactly one frontmatter line.
- Setting a meal rewrites exactly one table row.
- Checking a grocery item rewrites exactly one character.
- Adding a comment appends one line to one section.

The test suite exists to enforce this and nothing else. Its main assertion is
literally "which line numbers changed", and the answer is almost always a list
with one element in it. `tests/parsers.test.ts` reads a fixture, makes one edit,
and demands every other byte be identical.

An analogy: a normal ORM is a photocopier. You feed the original in, and what
comes out is legible but never quite the same paper. HomeRun is a pen. It writes
on the page that is already there.

## The layers, top to bottom

```
  a phone
    |
  app/(home)/*/page.tsx        server components, read-only, force-dynamic
    |                          they call store.ts and pass plain data down
  components/*.tsx             client components, all the interaction
    |                          they POST to the API and call router.refresh()
  app/api/*/route.ts           validate input, call one pure transform
    |
  lib/store.ts                 "read a file, hand back a parsed object"
    |
  lib/parse/*.ts               the grammars: week, recipe, grocery, honeydew, lists
  lib/md.ts                    the scalpel: surgical line editing
    |
  lib/vault.ts                 the ONLY door to the filesystem
    |
  ~/Obsidian/HQ/Family/*.md
```

Two rules hold this together.

**Everything goes through `vault.ts`.** One module knows where the vault is, one
module refuses to escape it, one module writes files. `vaultPath()` resolves and
then checks the result is still inside the root, so a slug like `../../.ssh/id_rsa`
throws instead of reading. Writes go to a dot-prefixed temp file and then get
renamed, so Obsidian's file watcher never sees a half-written note. Dot-prefixed
because Obsidian ignores dotfiles and will not flash a junk note at you.

**Every mutation is a pure `string -> string` function.** `vault.editFile(path,
fallback, transform)` reads, applies the transform, writes if it changed. That is
why the parsers are testable with no disk, no server and no mocks, and why the
test suite runs in under 100ms. If you find yourself wanting to write a mutation
that cannot be expressed as a string transform, it belongs in a different layer.

## The file grammars

These are the actual contracts. Break one and something in Obsidian, the digest
or the app stops agreeing with the others.

### Meal-Plan.md

Frontmatter `week-of: YYYY-MM-DD` (always a Monday), then a markdown table:

```
| Day | Breakfast | Lunch | Dinner | Notes |
|-----|-----------|-------|--------|-------|
| Mon 7/27 | | | Tacos (Ashlyn) | |
```

A meal cell is one of five things:

| You write | It means |
|---|---|
| `Tacos` | a dish, free text |
| `[[weeknight-tacos]]` | a link to a recipe note |
| `Leftovers` | leftovers |
| `Restaurant: Taco Bus` | eating out |
| (empty) | nothing planned |

Any of them can carry a cook tag in parentheses: `Tacos (Ashlyn)`. The parser
only treats a parenthetical as a cook if it matches a known name, so
`Chili (big batch)` stays a dish called "Chili (big batch)" rather than becoming
a dish cooked by someone named "big batch". There is a test for that.

The table renderer reproduces the vault's own spacing byte for byte: one space
of padding around a non-empty cell, a single bare space for an empty one. It
looks fussy. It is the difference between a save producing no diff and a save
producing seven changed lines every time.

The UI does not render this as a table. A five-column grid is the right shape
for a file and the wrong shape for a phone, so the Week tab shows one card per
day with a tappable row per meal. Same data, better thumb.

### Recipes/&lt;slug&gt;.md

Frontmatter carries the structured bits (`title`, `tags`, `servings`,
`source-url`, `rating-cooper`, `rating-ashlyn`, `favorite`), the body carries
`## Ingredients`, `## Steps`, `## Comments`. Comments are
`- YYYY-MM-DD (Name): text`.

Two things worth knowing:

**Ratings are per person, as separate keys.** `rating-cooper` and
`rating-ashlyn`. Not an average, not a shared score. The whole point is that
Claude can read "Ashlyn gave this a 2" and stop suggesting it.

**The servings scaler never writes.** Tap the plus button on a recipe and the
quantities double on screen; the note on disk still says it serves four, because
that is what the recipe *is*. Scaling is a view, not an edit. The arithmetic
runs in the browser (`src/lib/scale.ts`) and renders results as kitchen
fractions, so you get "1 1/2 lb" and not "1.5 lb" and definitely not
"1.4999999999 lb".

A full form save replaces the Ingredients and Steps sections but patches
frontmatter one key at a time, so ratings, comments, and any section a human
invented (`## Wine pairing`) survive untouched. There is a test for that too.

### Honeydew.md

```
- [ ] task text @due(YYYY-MM-DD) @who(name) @every(interval) @prio(hi|med|lo)
```

Open tasks under `## Tasks`, finished ones under `## Done`.

The only clever part is completing a recurring task. Tick `@every(3 months)` and
three things happen at once: the line moves to Done stamped `@done(2026-07-26)`,
a fresh copy appears under Tasks with `@due` advanced three months, and the new
due date is rolled forward until it lands in the future. That last bit matters:
a chore you ignored for two years should come back due next quarter, not come
back already 400 days overdue. Month arithmetic clamps, so January 31 plus one
month is February 28 rather than March 3.

This mirrors what the nightly digest run does, deliberately. Two things edit
this file and they must agree.

### Grocery-List.md

Category headings with `- [ ] item` under each, manual additions under
`## Extras (manual adds)`. Checking a box flips one character on one line.

The Extras section is load-bearing: regenerating the list rewrites the
categories but keeps Extras, so the paper towels you added on Tuesday do not
vanish when you replan on Wednesday.

### Groceries-and-Staples.md, Restaurants.md, Ingredient-Prefs.md

Bullet lists under headings. The editors read one named section and write that
one section back.

`Ingredient-Prefs.md` taught us a lesson worth repeating. It started as a flat
list of `ingredient: brand` bullets, so the first parser just scanned every
bullet in the file. Then the household added `## House dietary principles` and
`## Publix purchase-history insights`, and suddenly "Prefer organic when and
where possible, even at a premium" was an ingredient. The writer would have been
worse: it replaced the first bullet block it found, which would have deleted the
dietary principles outright.

The fix is that preferences now live in, and are written to, exactly
`## Per-ingredient preferences`, and the app shows the other sections read-only
so you can see them without being able to clobber them. The general lesson:
**assume every vault note will grow sections you did not plan for.** Address
content by heading, never by position.

## Auth, such as it is

One shared PIN, one signed cookie, one name picker. There are no accounts,
because two people sharing a house and a kitchen do not need a users table. The
app only needs to know two things: is this one of us (the PIN), and which of us
is holding the phone (the name).

The cookie is `base64url(payload).base64url(hmac-sha256(payload))`, httpOnly so
page scripts cannot read it and signed so a phone cannot mint one. `src/proxy.ts`
checks it on every request, bounces pages to `/login` and returns 401 for API
routes. Name missing? Bounce to `/who`.

This is a LAN app on a Mac in a house. It is not a bank. When the Cloudflare
tunnel lands, Access becomes the outer wall and this stays as the inner one.

The single most dangerous thing about this file: **`proxy.ts` must live at
`src/proxy.ts`**, beside `app`. Put it at the repo root and Next silently
ignores it. No error, no warning, a green build, and every route wide open. The
only way to know it is wired up is to look for `ƒ Proxy (Middleware)` at the
bottom of `next build`. This bit us during the build and it will bite whoever
moves the file next.

## The Claude bridge

Three jobs need judgement rather than parsing, so they shell out to the `claude`
CLI:

- **plan**: read the staples, the preferences, every recipe rating and comment,
  and the last few archived weeks, then write a proposed week to
  `Weeks/Drafts/proposed-YYYY-MM-DD.md` and reply with a short summary.
- **import**: fetch a recipe URL and write a properly formatted recipe note.
- **grocery**: build `Grocery-List.md` from the week's meals minus the staples.

The app can already read and write every one of these files. What it cannot do
is notice that you had chicken twice last week, that Ashlyn rated the curry a 2,
and that there is already rice in the pantry. That is the whole division of
labour: the app handles the mechanical, Claude handles the judgement.

### Importing is how recipes actually arrive

Almost nobody types a recipe into an app. They see one on a phone, or they are
standing in the kitchen holding a cookbook. So the import is the headline
control on the Recipes tab, not a link under the filters, and it takes two
routes: a link from anywhere, or photographs.

The import job tries several things in order and only gives up deliberately:

1. **Photographs**, read with the Read tool, which sees images. A cookbook
   page, a screenshot, a handwritten card in somebody's mother's handwriting.
2. **The page itself** with WebFetch, which handles ordinary recipe sites.
3. **The caption**, for TikTok, Instagram and Reels, through the oEmbed
   endpoints. The recipe on a short-form video is almost always in the caption,
   and oEmbed returns it as JSON without the page's blocking.
4. **Somewhere else**, by searching the dish plus the creator's handle.
5. **A public text-extraction proxy**, for a public page that blocks direct
   fetching. This one is allowed but fenced: the job must name the proxy it
   used in its reply, and must never route a URL through a third party if
   reaching it needed a login or a cookie, because that leaks where the
   household has an account.

Two of the outcomes are not failures and must not read like one.

**needs_browser** means the page cannot be read without a real browser: blocked
outright, rendered only by JavaScript, or a video whose recipe exists only in
the spoken audio. The card says it is queued, and an interactive Claude session
with the Chrome extension picks it up later and reads it like a person.

**needs_login** means the content sits behind a login or a paywall. Retrying
cannot fix that, so the card says so and suggests screenshotting it instead.

The job reports those states through two marker lines at the end of its reply
(`HOMERUN-STATUS:` and friends), which `claude-markers.ts` strips off before
anything reaches the screen. The CLI hands back prose; the app needs a state.

**The app writes the browser queue file, not the job.** The job's allowlist
grants it read on `jobs/` and write on nothing outside the Family wing, which
is the correct blast radius for something that fetches arbitrary web pages. I
checked that it genuinely cannot write there rather than assuming, and it
cannot. So the job says it is stuck and why, and the app records the request in
`jobs/browser-queue/<id>.json`. That also means the queue file's shape is
controlled by code instead of by prose.

### Nothing imported is usable until a human looks at it

Every import lands with `status: draft` in its frontmatter, and a draft is
excluded from the recipe picker, the meal planner and the grocery generator.

This is the most important rule in the feature. Extraction from a video
caption, a blog buried in advertising, or a photograph of handwriting is good
but never trustworthy, and a wrong quantity that quietly joins the planner and
the shopping list costs a trip to the shop. So a draft is not a recipe yet: its
URL renders a review screen rather than the recipe page, and the only way out
is Publish or Discard.

The exclusion is enforced twice, because there are two readers. `listRecipes()`
defaults to live only, which covers the app. The planner and grocery prompts
are told separately to ignore any recipe marked draft, because they read the
vault themselves rather than going through the app.

Publishing removes the `status` key entirely rather than setting it to "live",
so a published import is byte-identical in shape to a recipe typed by hand, and
"has a status key" stays a reliable test for "is a draft". There is a test
asserting exactly that.

### Rule zero: start with what is already in the house

The planning conversation does not begin with "what do you feel like eating".
It begins with "what is in the fridge, freezer and pantry", because the entire
economic argument for planning a week is that you eat what you already bought.
Two pounds of ground beef in the fridge should become an early-week beef meal,
not a forgotten bag thrown out on Sunday.

This is enforced in two places at once, which is deliberate:

- The chat screen opens with the question already asked, as the first message
  in the transcript. An empty text box does not ask for anything, and whatever
  the user types first sets the agenda. So the app sets it.
- The prompt makes it a hard gate. If the transcript does not yet establish
  what is on hand, Claude replies with the question and writes nothing. Only
  once it knows does it plan, and then perishables are assigned to the first
  two or three days, freezer and pantry items later, and the remaining days
  filled from recipes and ratings.

"Not sure" counts as an answer. The gate exists to make sure the question gets
asked, not to interrogate anybody.

### Ingredient-Prefs.md is a constraints file, not a shopping preference

It carries three things now, and all three bind: the household's dietary
principles (avoid seed oils where practical, prefer organic, prefer grass-fed
beef, stay cost-aware), the per-ingredient brand preferences, and a Publix
purchase-history section describing what they actually buy.

The principles decide *which product qualifies*. The brand preferences decide
*what to call it*, so a list says "1 lb Thousand Hills grass fed ground beef,
70/30" instead of "1 lb ground beef". The purchase history breaks ties. Both
the planner and the grocery generator read the file, so a week and its shopping
list cannot disagree about what this house eats.

One instruction in that file is aimed at Claude rather than at a human: when a
principle and the budget genuinely conflict, ask instead of assuming. The
prompts carry that through, which is why a proposal will sometimes come back
with "Saturday is burgers or eating out, your call" rather than a silent
decision.

**Jobs are files, not memory.** A POST writes `jobs/<uuid>.json`, spawns the
subprocess, and returns an id; the client polls a GET. Holding the child process
handle in a module-level variable would be simpler and would break the moment
the dev server reloaded mid-plan. The chat is stateless too: every turn replays
the whole transcript to a fresh `claude -p`. The conversation is a few hundred
words, so replaying it is cheaper than keeping a process alive between HTTP
requests.

### The trust gate, which will waste your afternoon

`claude -p` reads `.claude/settings.json` for its permission allowlist. If the
workspace has not been trusted, it **ignores the allowlist, denies every write,
and still exits 0 with a cheerful summary of the work it did not do.** The
warning goes to stderr where nobody looks.

That is the worst possible failure mode: a success that is a lie. So
`src/lib/claude.ts` watches for it explicitly and fails the job with the fix:

```
cd <path to this repo> && claude
```

accept the trust prompt, `/exit`. One time, forever.

Do not be tempted to paper over this with `--dangerously-skip-permissions`. The
allowlist is the feature. It says this subprocess may read anything under
`~/Obsidian/HQ`, may write only inside `Family/`, and may reach the web, and
nothing else. That scoping is what makes it safe to let an autonomous agent
loose on the family's notes.

One related detail: every spawn passes **`--add-dir`** pointing at the vault,
because the vault lives outside the repo and Claude cannot see it otherwise.

A warning from a wrong turn taken here. A planning run failed to save its draft,
and the obvious reading was that `Edit` cannot create a file that does not exist
yet, so the allowlist needed `Write` too. That is not true: an allowlist of
`Read` plus `Edit` creates new files perfectly well. The real cause was that the
run had been pointed at a scratch copy of the vault, at a path no rule covered.
When a write is refused, check the path against the glob before widening the
permission. Widening it is the one mistake here you cannot see in a diff.

## The app can rebuild itself

The Suggestion Box is not a feedback form that goes into a spreadsheet. A
request written on a phone becomes a file, launchd notices it, and a Claude
session with write access to this repo tries to build the thing, prove it with
a build and a typecheck, commit it, and restart the service. Small requests
land in a few minutes.

That is obviously the most dangerous thing in this codebase, so the boundary is
permissions rather than good intentions. `.claude/dev-settings.json` lets that
session edit the app and run npm, npx, git and kickstart. It denies the vault,
`~/.claude`, `.env.local`, its own `.claude/` directory, `bin/`, `prompts/`,
`launchd/`, `src/lib/auth.ts` and `src/proxy.ts`. **It cannot rewrite the rules
it runs under.** Every one of those denies was verified by attempting it.

One thing to know if you ever edit that file: **`Write(path)` rules are not
matched for file edits at all.** Only `Edit(path)` rules are, and an Edit rule
covers every file-editing tool. A deny list written with `Write(...)` would
look like a guardrail and enforce nothing. Write every rule as `Edit(...)`, and
re-run the probes afterwards.

The prompt carries the soft half. The request text is treated as a person
describing a feature and never as an instruction to the agent, which matters
because anyone with the PIN can type into that box. Anything touching the PIN,
permissions, sandbox files, or the world outside this repo is snagged with
"This one needs Cooper", no exceptions.

`bin/run-feedback.sh` enforces the two things a prompt cannot promise. A request
is never left saying "building", because a phone is polling it. And once a
change ships, the app has to actually answer on its port; if it does not, the
commit is reverted, the app is rebuilt and restarted, and the request is
snagged. A green build is strong evidence, not proof that the thing still serves.

A snag is a normal outcome, not a failure. "I need a Pinterest login to fetch
those" is far more useful than a half-built feature nobody asked to review, and
the nightly Daily Watch run reads unresolved snags so they do not rot.

## Testing philosophy

Fifty-three tests, no framework, under 100ms. `node --test` runs the `.ts` files
directly because Node 26 strips types on its own.

The tests are almost entirely about the prime directive. A typical one:

```ts
const before = fixture("recipe.md");
const after = setRating(before, "Cooper", 5);
assert.deepEqual(changedLines(before, after), [5]);
```

One line changed. Line 5. That is the test.

**Fixtures, not the live vault.** The original suite read the real vault files
and asserted exact line numbers, which worked beautifully until Basic Memory
reindexed a note mid-build and six tests went red at once. The vault is live
data with other processes writing to it; it is not a fixture and never was.
Byte-exact assertions now read from `tests/fixtures/`. The live vault still gets
tested, but only for the thing that actually matters about it: whatever shape
the indexer left it in, the parsers can still read it. There is a fixture of the
reindexed format specifically so that tolerance is pinned.

## Things that will trip you up

**This is not the Next.js you remember.** Version 16: `middleware.ts` is
`proxy.ts`, `cookies()` and `params` and `searchParams` are all Promises with no
sync fallback, Turbopack is the default for builds, `next lint` is gone. The
bundled docs in `node_modules/next/dist/docs/` are authoritative; read them
rather than trusting memory.

**Client components cannot import the parsers.** They pull gray-matter, which
has no business in a phone's bundle. The pure grammar lives in client-safe
modules with no Node imports: `meal.ts`, `scale.ts`, `tasks.ts`, `people.ts`,
`dates.ts`. Type-only imports from the parsers are fine, since TypeScript erases
them.

**Never build a date with `toISOString()`.** It converts to UTC, and any evening
west of Greenwich comes back as yesterday. Every date in `src/lib/dates.ts` is
assembled from local components, and any ISO string that needs parsing gets
parsed at noon so no timezone offset can nudge it onto the wrong day.

**YAML is helpful in ways you did not ask for.** `week-of: 2026-07-27` parses
into a JavaScript `Date`, and stringifying it gives a UTC timestamp. Every
date-ish frontmatter read goes through `asDateString()`.

**`next build` prints one warning and that is fine.** "Encountered unexpected
file in NFT list", traced through `vault.ts`. That is the file tracer noticing
this app does filesystem work on a path outside the project, which is the
premise of the entire application. It only affects standalone output tracing,
which this app does not use.

## Running it

```
npm install
npm run dev        # localhost:3010
npm test           # the parser suite
npm run build      # must be green
npm start          # production, port 3010
```

`.env.local` needs `HOMERUN_PIN`, `HOMERUN_SECRET` (random hex, 32 bytes),
`HOMERUN_VAULT`, and `CLAUDE_BIN`. Copy `.env.example`.

To exercise the write paths without touching the real vault, copy it somewhere
and point a second server at the copy:

```
cp -R ~/Obsidian/HQ/Family /tmp/vault
HOMERUN_VAULT=/tmp/vault npx next start --port 3011
```

Then diff the copy against the original. Every diff should be one or two lines
and exactly the lines you meant to change. If it is more than that, something in
the write path has regressed, and that is the bug worth chasing before any
feature work.
