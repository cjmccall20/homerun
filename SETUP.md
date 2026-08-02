# Setting up HomeRun

These instructions are written for a Claude Code (or similar) agent doing the
install, with a human nearby for the handful of steps that need one. If you are
a human reading this without an agent, everything still works top to bottom.

HomeRun is a household app for two people: meal planning, recipes, the grocery
list, chores, and daily goals. It runs entirely on one Mac. Notes live in plain
markdown in a folder you choose (an Obsidian vault if you use Obsidian, a plain
directory if you do not). There is no database and no cloud account.

## What is required and what is optional

| Piece | Needed for | Skip it and... |
| --- | --- | --- |
| Node 24+ and npm | everything | nothing works |
| A vault directory | everything | nothing works (setup creates it) |
| The `claude` CLI, logged in | AI features: chat planner, recipe import from a URL/photo, grocery list generation | every screen still works; you type recipes and lists by hand |
| Tailscale | using it from phones outside your wifi | works on your wifi / on the Mac |
| Add to Home Screen (PWA) | app-like feel on the phone | works fine in the browser |
| Resend account | the optional morning email | no email; the Goals tab is the same information |
| Actual Budget + SimpleFIN | the Budget tab | Budget tab shows nothing; everything else unaffected |
| The orders sidecar (included) + a grocer with a web storefront | one-tap "build my cart" | you shop from the list on your phone like a normal person |

## Phase 1 - the machine (agent can verify, human installs what is missing)

1. `node --version` must be 24 or newer (26 recommended; the test suite runs
   TypeScript directly and needs modern type stripping).
2. `npm install` in this repo.
3. For AI features later: `claude --version`. If missing, the human installs
   Claude Code and signs in first.

## Phase 2 - setup script (interactive, human answers four questions)

```
node bin/setup.mjs
```

It asks the two household names, where notes should live, and a PIN. It then:

- writes `.env.local` (PIN, a generated signing secret, the vault path)
- generates `.claude/settings.json`, `.claude/dev-settings.json`, and
  `prompts/feedback.md` from their `.template` files with THIS machine's
  absolute paths. This is the step you must not skip or hand-edit around:
  those files are permission allowlists for the AI jobs, and wrong paths do
  not error - the jobs report success and silently write nothing.
- renames the household throughout the source (fresh installs only; the
  recipe rating keys in frontmatter carry the names, so renaming later means
  migrating notes)
- seeds the vault from `vault-template/` if it is empty

## Phase 3 - prove it runs (agent does all of this)

```
npm test          # expect: all pass, 1 skipped (the live-vault smoke test)
npm run build     # expect: routes listed and the line: ƒ Proxy (Middleware)
npm start         # http://localhost:3010
```

If `ƒ Proxy (Middleware)` is missing from the build output, the auth gate is
not running and every route is open - stop and investigate before continuing.

Sign in with the PIN, pick a name, add a goal on the Goals tab, check it off.
If that works, the vault wiring is correct.

To keep it running across reboots (macOS):

```
sed -e "s|{{REPO}}|$PWD|g" -e "s|{{HOME}}|$HOME|g" \
  launchd/com.homerun.app.plist.template > ~/Library/LaunchAgents/com.homerun.app.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.homerun.app.plist
```

## Phase 4 - the AI features (one human step, then agent verifies)

1. HUMAN: `cd` into this repo, run `claude`, accept the workspace trust
   prompt, `/exit`. This cannot be automated and everything AI-related
   silently fails without it (the CLI ignores the permission settings of an
   untrusted workspace and still exits 0).
2. Agent: in the app, open Plan and ask for a dinner idea, or open
   Recipes -> Add -> paste any public recipe URL. Then confirm a file actually
   appeared or changed under the vault (`Recipes/` or `Weeks/Drafts/`). The
   file on disk is the proof; the chat transcript is not.

## Phase 5 - phones (optional, human does the account parts)

**Tailscale** (use it away from home): install Tailscale on the Mac and both
phones, sign into the same tailnet, and open `http://<mac-tailscale-name>:3010`
from a phone. Do not expose port 3010 to the public internet: the login is a
short shared PIN with no rate limiting, which is fine on a private tailnet and
not fine on the open web.

**Add to Home Screen**: open the app in Safari on the phone, Share -> Add to
Home Screen. It ships a manifest and icons, so it launches full screen like an
app.

## Phase 6 - optional modules

**Morning email (Resend).** `bin/morning-email.mjs` emails both people's goals
for the day, tonight's dinner, and any chores due. Human creates a free Resend
account, verifies a sending domain, puts `RESEND_API_KEY`, `MORNING_EMAIL_TO`,
`MORNING_EMAIL_FROM` in `.env.local`. Run `node bin/morning-email.mjs` once by
hand: with keys missing it prints the email instead of sending, so you can see
it before wiring the launchd template (`com.homerun.morning-email`).

**Budget tab (Actual + SimpleFIN).** The most involved option and entirely
separable: a nightly script pulls bank transactions via SimpleFIN (paid, ~$15/yr)
into a self-hosted Actual Budget server and writes a snapshot JSON the app
reads. Set `HOMERUN_BUDGET_SNAPSHOT` and `HOMERUN_BUDGET_DATA`, then follow
`bin/budget-setup.mjs`. Skip freely.

**Grocery cart automation.** Included, in `orders-sidecar/`. One tap on
"Build cart" in the Grocery tab writes a job file; a launchd agent hands it to
a three-phase runner (a model call plans the whole list, a mechanical bulk
pass adds the easy items, a judge pass shops the hard ones) that drives a
dedicated always-running Chrome, logged into your grocer, over CDP. It fills
the cart and stops; a hard blocklist in `lib/safety.js` keeps it off checkout
and payment pages, with tests. The reference implementation targets Publix.
For any other grocer, `orders-sidecar/README.md` has an "Adapting this to a
different grocer" section that names exactly which files carry the
store-specific selectors and the probe-driven method for porting them; it is
a few focused hours for an agent. Setup: `bin/setup.mjs` already generated the
sidecar's sandbox; the human steps are logging into the grocer once in the
dedicated Chrome (`orders-sidecar/bin/start-chrome.sh`) and running
`orders-sidecar/bin/install-launchd.sh`. Skip freely: order jobs queue
politely and the list is always usable by hand.

**The self-update loop.** `bin/install-feedback-loop.sh` wires the in-app
Suggestion Box to a Claude session that edits this repo, verified by tests and
an HTTP check, with a deny-list sandbox. Read `prompts/feedback.md` and
`.claude/dev-settings.json` before enabling it: it is the sharpest tool here,
off by default, and entirely optional.

## Importing your recipes

**One at a time (built in).** Recipes -> Add -> paste a URL or take photos of
a cookbook page. Imports land as drafts for review; the planner ignores drafts
until you publish them.

**From Pinterest, in bulk.** Do not hand your Pinterest password to a scraper
extension. Pinterest will email you your own data: Settings -> Privacy and
data -> Request your data (takes up to 48 hours). The export lists every pin
with its source URL. Then loop the recipe pins through the built-in importer -
paste each URL, or hand the export file to your Claude Code agent with: "for
each recipe pin in this export, import the source URL through the app's
import, leave everything as drafts". Most food pins link out to a real recipe
page, which is exactly what the importer eats.

**From TikTok, in bulk.** Harder, because the recipe is inside the video.
Cooper's pipeline (yt-dlp with your own browser cookies -> Whisper transcript +
frames -> Claude writes the note) lives in a separate repo and is described in
`FORHomeRun.md`; budget an afternoon and expect quantities to be estimates
where the video never states them. Imports should land as `status: draft` and
get reviewed - a bulk import that goes straight to live will quietly feed your
meal planner unverified recipes.

**From anywhere else.** If it has a URL or you can photograph it, the built-in
importer handles it one at a time.

## When something is wrong

`.claude/napkin.md` is the accumulated engineering history of this app - every
gotcha that cost real time, from the Next.js 16 proxy rename to why the vault
parsers tolerate reindexed frontmatter. Read it before debugging anything.
