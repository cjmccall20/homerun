// Nightly: pull transactions from SimpleFIN, import into Actual (deduped by
// imported_id), then write budget-snapshot.json for the HomeRun UI.
// First run pulls 90 days; after that, 10 days back to catch stragglers.
import fs from "node:fs";
import api from "@actual-app/api";
import {
  loadEnv, simplefinAccounts, initActual, readMap,
  SNAPSHOT_FILE, writeJson,
} from "./budget-lib.mjs";
import { categorizeAll } from "./budget-categorize.mjs";

const env = loadEnv();
const map = readMap();
const firstRun = !fs.existsSync(SNAPSHOT_FILE);
const lookbackDays = firstRun ? 90 : 10;
const startDate = Math.floor(Date.now() / 1000) - lookbackDays * 86400;

console.log(`pulling SimpleFIN since ${new Date(startDate * 1000).toISOString().slice(0, 10)}...`);
const sfAccounts = await simplefinAccounts(env.SIMPLEFIN_ACCESS_URL, startDate);

await initActual(env);
await api.downloadBudget(map.groupId ?? undefined).catch(() => {});
await api.loadBudget(map.budgetId);
await api.sync();

let imported = 0;
const balances = [];
for (const a of sfAccounts) {
  const m = map.accounts[a.id];
  if (!m) { console.error(`unmapped SimpleFIN account ${a.id} (${a.name}) - run setup for it`); continue; }
  const txns = (a.transactions ?? []).map((t) => ({
    account: m.actualId,
    date: new Date((t.posted || t.transacted_at) * 1000).toISOString().slice(0, 10),
    amount: api.utils.amountToInteger(parseFloat(t.amount)),
    payee_name: t.payee || t.description,
    notes: t.description,
    imported_id: t.id,
    cleared: !t.pending,
  }));
  if (txns.length) {
    const res = await api.importTransactions(m.actualId, txns);
    imported += res.added?.length ?? 0;
  }
  balances.push({
    accountId: m.actualId, name: m.name,
    balance: parseFloat(a.balance),
    balanceDate: a["balance-date"] ?? null,
  });
}
await api.sync();
console.log(`imported ${imported} new transactions`);

const cat = await categorizeAll(api, map);
await api.sync();
console.log(`categorized: ${cat.ruled} by rule, ${cat.claude} by Claude, ${cat.unknown} unknown`);

// ---- snapshot for HomeRun ----
const month = new Date().toISOString().slice(0, 7);
const budgetMonth = await api.getBudgetMonth(month).catch(() => null);
const categories = await api.getCategories();
const groups = await api.getCategoryGroups();
const incomeIds = new Set(categories.filter((c) => c.is_income).map((c) => c.id));
const since = new Date(Date.now() - 185 * 86400_000).toISOString().slice(0, 10);
const all = [];
for (const m of Object.values(map.accounts)) {
  const txns = await api.getTransactions(m.actualId, since, undefined);
  for (const t of txns) {
    if (t.is_parent) continue;
    all.push({
      id: t.id, account: m.name, date: t.date,
      amount: api.utils.integerToAmount(t.amount),
      payee: t.imported_payee ?? null,
      category: t.category ? categories.find((c) => c.id === t.category)?.name ?? null : null,
      notes: t.notes ?? null, cleared: t.cleared,
      transfer: Boolean(t.transfer_id),
      income: t.category ? incomeIds.has(t.category) : false,
    });
  }
}
all.sort((a, b) => b.date.localeCompare(a.date));

// ---- trends ----
// "Spend" = negative, non-transfer, non-income transactions. Payees with an
// explicit null rule (transfers between our own accounts, CC/loan payments)
// are money moving, not money spent - keep them out of every trend number.
let skipPayees = [];
try {
  const rules = JSON.parse(
    fs.readFileSync(`${process.env.HOMERUN_BUDGET_DATA ?? process.env.HOME + "/homerun-budget-data"}/budget-rules.json`, "utf8")
  ).rules;
  skipPayees = rules.filter((r) => r.category === null).map((r) => r.match.toUpperCase());
} catch {}
const isMoneyMovement = (t) =>
  skipPayees.some((p) => (t.payee ?? "").toUpperCase().includes(p));
const spendTxns = all.filter(
  (t) => t.amount < 0 && !t.transfer && !t.income && !isMoneyMovement(t)
);
const monthly = {}; // month -> { total, byCategory: {name: amount} }
for (const t of spendTxns) {
  const m = t.date.slice(0, 7);
  monthly[m] ??= { total: 0, byCategory: {} };
  const c = t.category ?? "Uncategorized";
  monthly[m].total += -t.amount;
  monthly[m].byCategory[c] = (monthly[m].byCategory[c] ?? 0) + -t.amount;
}

const dayOfMonth = new Date().getDate();
// Only months fully covered by the data window count toward "typical".
const firstDataMonth = all.length ? all[all.length - 1].date.slice(0, 7) : month;
const priorMonths = Object.keys(monthly)
  .filter((m) => m < month && m > firstDataMonth)
  .sort()
  .slice(-3);
const paceSamples = priorMonths.map((m) =>
  spendTxns
    .filter((t) => t.date.slice(0, 7) === m && Number(t.date.slice(8)) <= dayOfMonth)
    .reduce((s, t) => s + -t.amount, 0)
);
const typicalByNow = paceSamples.length
  ? paceSamples.reduce((a, b) => a + b, 0) / paceSamples.length
  : null;

const payeeAgg = {};
for (const t of spendTxns.filter((t) => t.date.slice(0, 7) === month)) {
  const p = t.payee ?? "?";
  payeeAgg[p] = (payeeAgg[p] ?? 0) + -t.amount;
}
const topPayees = Object.entries(payeeAgg)
  .sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([payee, total]) => ({ payee, total }));

// Recurring candidates: same payee in 3+ distinct months, amounts within 15%.
const byPayee = {};
for (const t of spendTxns) {
  const p = t.payee ?? "?";
  (byPayee[p] ??= []).push(t);
}
const recurring = [];
for (const [payee, txns] of Object.entries(byPayee)) {
  const months = new Set(txns.map((t) => t.date.slice(0, 7)));
  if (months.size < 3) continue;
  const amts = txns.map((t) => -t.amount);
  const avg = amts.reduce((a, b) => a + b, 0) / amts.length;
  const spread = Math.max(...amts) - Math.min(...amts);
  if (avg > 0 && spread / avg <= 0.15) {
    recurring.push({ payee, avg: Math.round(avg * 100) / 100, months: months.size });
  }
}
recurring.sort((a, b) => b.avg - a.avg);

writeJson(SNAPSHOT_FILE, {
  generatedAt: new Date().toISOString(),
  month,
  balances,
  budget: budgetMonth, // envelope amounts once set; zeros until then
  categoryGroups: groups.map((g) => ({
    id: g.id, name: g.name,
    categories: g.categories?.map((c) => ({ id: c.id, name: c.name })) ?? [],
  })),
  transactions: all.slice(0, 500),
  trends: {
    monthly,
    pace: { dayOfMonth, spentThisMonth: monthly[month]?.total ?? 0, typicalByNow },
    topPayees,
    recurring: recurring.slice(0, 20),
  },
});
console.log(`wrote ${SNAPSHOT_FILE}`);
await api.shutdown();
