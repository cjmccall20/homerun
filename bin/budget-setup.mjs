// One-time: create the Family budget file on the Actual server, mirror every
// SimpleFIN account into it, seed envelope category groups (no amounts yet),
// and write the SimpleFIN->Actual account map. Safe to re-run: refuses to
// clobber an existing map.
import fs from "node:fs";
import api from "@actual-app/api";
import { loadEnv, simplefinAccounts, initActual, MAP_FILE, writeJson } from "./budget-lib.mjs";

const BUDGET_NAME = "Family";
const CATEGORY_GROUPS = {
  Fixed: ["Rent/Mortgage", "Utilities", "Insurance", "Phone/Internet", "Subscriptions"],
  Living: ["Groceries", "Household", "Gas & Auto", "Medical", "Kids"],
  Flexible: ["Dining Out", "Amazon", "Shopping", "Fun & Entertainment", "Travel"],
  Goals: ["Savings", "Giving", "Misc"],
};

if (fs.existsSync(MAP_FILE)) {
  console.error(`refusing: ${MAP_FILE} already exists (budget already set up)`);
  process.exit(1);
}

const env = loadEnv();
console.log("fetching SimpleFIN accounts...");
const sfAccounts = await simplefinAccounts(env.SIMPLEFIN_ACCESS_URL);
for (const a of sfAccounts) console.log(`  ${a.org?.name ?? "?"} - ${a.name} (${a.id})`);

await initActual(env);
console.log(`creating budget "${BUDGET_NAME}" on server...`);
await api.runImport(BUDGET_NAME, async () => {
  for (const [group, cats] of Object.entries(CATEGORY_GROUPS)) {
    const gid = await api.createCategoryGroup({ name: group });
    for (const name of cats) await api.createCategory({ name, group_id: gid });
  }
});

const budgets = await api.internal.send("get-budgets");
const budget = budgets.find((b) => b.name === BUDGET_NAME);
if (!budget) throw new Error("budget not found after import");
await api.loadBudget(budget.id);

const map = { budgetId: budget.id, groupId: budget.groupId ?? null, accounts: {} };
for (const a of sfAccounts) {
  const label = `${a.org?.name ?? "Bank"}: ${a.name}`;
  const offBudget = false;
  const id = await api.createAccount({ name: label, offbudget: offBudget }, 0);
  map.accounts[a.id] = { actualId: id, name: label };
  console.log(`  created Actual account "${label}"`);
}
await api.sync();
writeJson(MAP_FILE, map);
console.log(`wrote ${MAP_FILE}`);
await api.shutdown();
console.log("setup complete");
