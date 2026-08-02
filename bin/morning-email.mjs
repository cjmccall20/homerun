#!/usr/bin/env node
/**
 * Optional morning email, via Resend. Sends today's goals for both people,
 * tonight's dinner row, and any Honeydew tasks due or overdue.
 *
 * Needs three keys in .env.local: RESEND_API_KEY, MORNING_EMAIL_TO (comma
 * separated), MORNING_EMAIL_FROM (an address on a domain you verified with
 * Resend). Without them it prints what it would have sent and exits 0, so it
 * is safe to schedule before you have decided whether you want it.
 *
 * Schedule it however you like; on a Mac, launchd:
 *   sed -e "s|{{REPO}}|$PWD|g" -e "s|{{HOME}}|$HOME|g" \
 *     launchd/com.homerun.morning-email.plist.template \
 *     > ~/Library/LaunchAgents/com.homerun.morning-email.plist
 *   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.homerun.morning-email.plist
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));

// Load .env.local ourselves; this script runs outside Next.
if (existsSync(path.join(REPO, ".env.local"))) {
  for (const line of readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const VAULT = process.env.HOMERUN_VAULT;
if (!VAULT) {
  console.error("HOMERUN_VAULT is not set; run bin/setup.mjs first.");
  process.exit(1);
}

const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

function readOr(file, fallback = "") {
  try {
    return readFileSync(path.join(VAULT, file), "utf8");
  } catch {
    return fallback;
  }
}

// Goals: every "- [ ]"/"- [x]" line under each "## Name" section.
const goalsRaw = readOr(path.join("Goals", `${today}.md`));
const goals = {};
let current = null;
for (const line of goalsRaw.split("\n")) {
  const h = /^##\s+(.+?)\s*$/.exec(line);
  if (h) {
    current = h[1].trim();
    goals[current] = goals[current] ?? [];
    continue;
  }
  const g = /^\s*-\s*\[([ xX])\]\s*(.+)$/.exec(line);
  if (g && current) goals[current].push({ text: g[2].trim(), done: g[1] !== " " });
}

// Tonight's dinner: the Meal-Plan row whose Day column matches today.
const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date());
const dinner =
  readOr("Meal-Plan.md")
    .split("\n")
    .filter((l) => l.startsWith("|") && l.includes(dayLabel))
    .map((l) => l.split("|").map((c) => c.trim()))
    .map((cells) => cells[4] ?? "")
    .find((d) => d && d !== "Dinner") ?? "";

// Honeydew: unchecked tasks due today or earlier.
const due = readOr("Honeydew.md")
  .split("\n")
  .filter((l) => /^\s*-\s*\[ \]/.test(l))
  .filter((l) => {
    const m = /@due\((\d{4}-\d{2}-\d{2})\)/.exec(l);
    return m && m[1] <= today;
  })
  .map((l) => l.replace(/^\s*-\s*\[ \]\s*/, "").trim());

const section = (title, items) =>
  items.length
    ? `<h3 style="margin:16px 0 4px">${title}</h3><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`
    : "";

const goalsHtml = Object.entries(goals)
  .filter(([, list]) => list.length)
  .map(([person, list]) =>
    section(
      `${person}'s goals`,
      list.map((g) => (g.done ? `<s>${g.text}</s>` : g.text))
    )
  )
  .join("");

const html = [
  `<h2 style="margin:0 0 8px">HomeRun - ${today}</h2>`,
  goalsHtml || "<p>No goals written for today yet.</p>",
  dinner ? `<h3 style="margin:16px 0 4px">Tonight</h3><p>${dinner}</p>` : "",
  section("Due around the house", due),
].join("\n");

const { RESEND_API_KEY, MORNING_EMAIL_TO, MORNING_EMAIL_FROM } = process.env;
if (!RESEND_API_KEY || !MORNING_EMAIL_TO || !MORNING_EMAIL_FROM) {
  console.log("Resend not configured (RESEND_API_KEY / MORNING_EMAIL_TO / MORNING_EMAIL_FROM).");
  console.log("Would have sent:\n");
  console.log(html);
  process.exit(0);
}

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: MORNING_EMAIL_FROM,
    to: MORNING_EMAIL_TO.split(",").map((s) => s.trim()),
    subject: `HomeRun - ${today}`,
    html,
  }),
});
if (!res.ok) {
  console.error(`Resend said ${res.status}: ${await res.text()}`);
  process.exit(1);
}
console.log("morning email sent");
