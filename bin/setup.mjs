#!/usr/bin/env node
/**
 * First-run setup. Run it from the repo root:
 *
 *   node bin/setup.mjs
 *
 * Asks the questions a fresh install needs, then does everything that can be
 * done non-interactively: writes .env.local, generates the Claude permission
 * files from their templates (they must contain YOUR absolute paths or every
 * AI job silently writes nothing), seeds the vault, and renames the household.
 *
 * Safe to re-run: it refuses to overwrite an existing .env.local and never
 * touches a vault directory that already has notes in it.
 */

import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const REPO = process.cwd();

// Flags first (what an agent uses), questions as the fallback (what a human
// at a terminal gets): --name-a --name-b --vault --pin
const flags = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, "");
  if (key) flags[key] = process.argv[i + 1] ?? "";
}
const rl = createInterface({ input: process.stdin, output: process.stdout });

function die(msg) {
  console.error(`\n${msg}`);
  process.exit(1);
}

async function ask(question, fallback, flag) {
  if (flag && flags[flag]) return flags[flag];
  const raw = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
  return raw || fallback || "";
}

if (!existsSync(path.join(REPO, "package.json")) || !existsSync(path.join(REPO, ".claude"))) {
  die("Run this from the repo root: node bin/setup.mjs");
}
if (existsSync(path.join(REPO, ".env.local"))) {
  die(".env.local already exists. Delete it first if you really want to start over.");
}

console.log("\nHomeRun setup. Four questions.\n");

// 1. The household.
const nameA = (await ask("First person's name", "Alex", "name-a")).replace(/[^A-Za-z]/g, "");
const nameB = (await ask("Second person's name", "Sam", "name-b")).replace(/[^A-Za-z]/g, "");
if (!nameA || !nameB || nameA === nameB) die("Two different names, letters only.");

// 2. The vault.
const vaultDefault = path.join(homedir(), "HomeRun", "Family");
const vault = path.resolve(await ask("Where should household notes live", vaultDefault, "vault"));

// 3. The PIN.
const pin = await ask("Pick a login PIN (share it with the household)", "", "pin");
if (pin.length < 4) die("A PIN needs at least 4 characters.");

rl.close();

// --- .env.local -------------------------------------------------------------
const secret = randomBytes(32).toString("hex");
writeFileSync(
  path.join(REPO, ".env.local"),
  [
    `HOMERUN_PIN=${pin}`,
    `HOMERUN_SECRET=${secret}`,
    `HOMERUN_VAULT=${vault}`,
    "# Path to the claude CLI if it is not on PATH:",
    "# CLAUDE_BIN=",
    "",
  ].join("\n")
);
console.log("wrote .env.local (the signing secret was generated, you never need to know it)");

// --- Claude permission files from templates ----------------------------------
// These are absolute-path allowlists. Wrong paths do not error: the AI jobs
// report success and write nothing. This step is why setup exists.
const vaultParent = path.dirname(vault);
function render(template) {
  return readFileSync(template, "utf8")
    .replaceAll("{{REPO}}", REPO)
    .replaceAll("{{VAULT}}", vault)
    .replaceAll("{{VAULT_PARENT}}", vaultParent)
    .replaceAll("{{HOME}}", homedir());
}
for (const name of ["settings.json", "dev-settings.json"]) {
  writeFileSync(path.join(REPO, ".claude", name), render(path.join(REPO, ".claude", `${name}.template`)));
}
writeFileSync(path.join(REPO, "prompts", "feedback.md"), render(path.join(REPO, "prompts", "feedback.md.template")));
console.log("generated .claude/settings.json, .claude/dev-settings.json, prompts/feedback.md");

// The orders sidecar's sandbox, same treatment. Rendering it here costs
// nothing if the sidecar is never used.
const sidecarSettings = path.join(REPO, "orders-sidecar", ".claude", "settings.json.template");
if (existsSync(sidecarSettings)) {
  const rendered = readFileSync(sidecarSettings, "utf8")
    .replaceAll("{{SIDECAR}}", path.join(REPO, "orders-sidecar"))
    .replaceAll("{{HOMERUN}}", REPO)
    .replaceAll("{{VAULT}}", vault)
    .replaceAll("{{VAULT_PARENT}}", vaultParent);
  writeFileSync(path.join(REPO, "orders-sidecar", ".claude", "settings.json"), rendered);
  console.log("generated orders-sidecar/.claude/settings.json");
}

// --- the household name, in code and data format -----------------------------
// Names live in ~10 source files and in recipe frontmatter keys
// (rating-<name>). A fresh install has no recipes to migrate, so a plain
// replace is complete and safe here. Do NOT re-run on a lived-in install.
const RENAMES = [
  "src/lib/people.ts",
  "src/lib/parse/recipe.ts",
  "src/lib/parse/week.ts",
  "src/lib/session.ts",
  "src/lib/claude.ts",
  "src/lib/goals.ts",
  "src/lib/meal.ts",
  "src/lib/threads.ts",
  "src/app/api/auth/name/route.ts",
  "src/components/SuggestionBox.tsx",
];
// The tests and their fixtures carry the names too (rating-<name> is an
// on-disk format), so they rename together or the suite goes red.
const renameTargets = [...RENAMES];
const collectTests = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTests(p);
    else if (/\.(ts|md)$/.test(entry.name)) renameTargets.push(path.relative(REPO, p));
  }
};
collectTests(path.join(REPO, "tests"));

let touched = 0;
for (const rel of renameTargets) {
  const file = path.join(REPO, rel);
  if (!existsSync(file)) continue;
  const before = readFileSync(file, "utf8");
  const after = before
    .replaceAll("Cooper", nameA)
    .replaceAll("cooper", nameA.toLowerCase())
    .replaceAll("Ashlyn", nameB)
    .replaceAll("ashlyn", nameB.toLowerCase())
    .replaceAll("the McCall family", "the household");
  if (after !== before) {
    writeFileSync(file, after);
    touched += 1;
  }
}
console.log(`renamed the household to ${nameA} and ${nameB} in ${touched} files`);

// --- the vault ----------------------------------------------------------------
mkdirSync(vault, { recursive: true });
const hasNotes = readdirSync(vault).some((f) => f.endsWith(".md"));
if (hasNotes) {
  console.log(`vault at ${vault} already has notes, leaving it alone`);
} else {
  cpSync(path.join(REPO, "vault-template"), vault, { recursive: true });
  // Personalize the seeded notes, including frontmatter keys like rating-alex.
  const personalize = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) personalize(p);
      else if (entry.name.endsWith(".md")) {
        writeFileSync(
          p,
          readFileSync(p, "utf8")
            .replaceAll("Alex", nameA)
            .replaceAll("alex", nameA.toLowerCase())
            .replaceAll("Sam", nameB)
            .replaceAll("sam", nameB.toLowerCase())
        );
      }
    }
  };
  personalize(vault);
  console.log(`seeded the vault at ${vault}`);
}

console.log(`
Done. What is left needs a human:

1. npm install && npm test     (expect all green, one skipped without recipes)
2. npm run build && npm start  (http://localhost:3010, sign in with your PIN)
3. For the AI features: run "claude" once in this directory and accept the
   trust prompt, then /exit. Without that step, AI jobs silently do nothing.
   Details in SETUP.md, which also covers the optional pieces (phone access
   via Tailscale, add-to-home-screen, the morning email, budget, and
   grocery-order automation) and how to import recipes in bulk.
`);
