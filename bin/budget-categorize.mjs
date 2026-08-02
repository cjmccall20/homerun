// Categorize uncategorized transactions in Actual. Two passes:
//   1. budget-rules.json - substring rules (cheap, deterministic, grows over time)
//   2. Claude (haiku) for payees no rule matches; its verdicts are appended to
//      the rules file so each payee is only ever asked about once.
// Runs standalone (node bin/budget-categorize.mjs) or from budget-sync via
// categorizeAll(api, map). Unknowns that Claude can't place stay uncategorized;
// a human or the budget conversation sorts them in Actual.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DATA_DIR } from "./budget-lib.mjs";

const RULES_FILE = path.join(DATA_DIR, "budget-rules.json");

function loadRules() {
  try {
    return JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
  } catch {
    return { rules: [] };
  }
}

function saveRules(rules) {
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2) + "\n");
}

/** Returns a category name, null for "leave alone" (transfers etc.), or undefined for no rule. */
function ruleMatch(rules, payee) {
  const hay = payee.toUpperCase();
  for (const r of rules.rules) {
    if (hay.includes(r.match.toUpperCase())) return r.category;
  }
  return undefined;
}

/** Ask Claude to map unknown payee strings to categories. Returns {payee: category|null}. */
function askClaude(payees, categoryNames) {
  const prompt = [
    "Categorize these bank-transaction payee strings for a family budget.",
    `Valid categories (use EXACTLY these strings): ${categoryNames.join(", ")}`,
    "Reply with ONLY a JSON object mapping each payee string to a category,",
    'or null if genuinely ambiguous. Transfers between own accounts, credit',
    'card payments, and loan payments should be null.',
    "",
    JSON.stringify(payees),
  ].join("\n");
  const out = execFileSync("claude", ["-p", "--model", "claude-haiku-4-5"], {
    input: prompt,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` },
  });
  const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
  return JSON.parse(json);
}

/**
 * Categorize every uncategorized on-budget transaction. `api` must have a
 * budget loaded. Returns counts for the log.
 */
export async function categorizeAll(api, map) {
  const categories = await api.getCategories();
  const byName = new Map(
    categories.filter((c) => !c.is_income).map((c) => [c.name, c.id])
  );
  const rules = loadRules();

  // Collect uncategorized transactions across all mapped accounts.
  const since = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
  const todo = [];
  for (const m of Object.values(map.accounts)) {
    const txns = await api.getTransactions(m.actualId, since, undefined);
    for (const t of txns) {
      if (t.category || t.is_parent || t.transfer_id) continue;
      const payee = (t.imported_payee || t.notes || "").trim();
      if (payee) todo.push({ id: t.id, payee });
    }
  }
  if (!todo.length) return { ruled: 0, claude: 0, unknown: 0 };

  let ruled = 0;
  const unmatched = new Map(); // payee -> txn ids
  for (const t of todo) {
    const cat = ruleMatch(rules, t.payee);
    if (cat === null) continue; // explicit skip rule (transfer, CC payment)
    if (cat && byName.has(cat)) {
      await api.updateTransaction(t.id, { category: byName.get(cat) });
      ruled++;
    } else {
      if (!unmatched.has(t.payee)) unmatched.set(t.payee, []);
      unmatched.get(t.payee).push(t.id);
    }
  }

  let claudeCount = 0;
  let unknown = 0;
  const payeeList = [...unmatched.keys()];
  // Batches of 40 payees keep the prompt small and the JSON parseable.
  for (let i = 0; i < payeeList.length; i += 40) {
    const batch = payeeList.slice(i, i + 40);
    let verdicts = {};
    try {
      verdicts = askClaude(batch, [...byName.keys()]);
    } catch (err) {
      console.error("claude categorization failed:", err.message);
      unknown += batch.length;
      continue;
    }
    for (const payee of batch) {
      const cat = verdicts[payee];
      if (cat && byName.has(cat)) {
        for (const id of unmatched.get(payee)) {
          await api.updateTransaction(id, { category: byName.get(cat) });
          claudeCount++;
        }
        rules.rules.push({ match: payee, category: cat, source: "claude" });
      } else {
        // Remember the null so this payee is never asked about again.
        rules.rules.push({ match: payee, category: null, source: "claude" });
        unknown++;
      }
    }
    saveRules(rules);
  }
  return { ruled, claude: claudeCount, unknown };
}

// Standalone entry point.
if (process.argv[1] && process.argv[1].endsWith("budget-categorize.mjs")) {
  const { loadEnv, initActual, readMap } = await import("./budget-lib.mjs");
  const api = (await import("@actual-app/api")).default;
  const env = loadEnv();
  const map = readMap();
  await initActual(env);
  await api.loadBudget(map.budgetId);
  await api.sync();
  const res = await categorizeAll(api, map);
  await api.sync();
  console.log(
    `categorized: ${res.ruled} by rule, ${res.claude} by Claude, ${res.unknown} left unknown`
  );
  await api.shutdown();
}
