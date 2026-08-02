"use client";

import { useState } from "react";

import type { BudgetSnapshot } from "@/lib/budget";
import { PageHeader } from "@/components/PageHeader";
import { Card, Empty, SectionTitle } from "@/components/ui";

/**
 * The family money dashboard. Actual (tailnet, :5006) is the engine of
 * record; the nightly sync categorizes with Claude and precomputes trends, so
 * this screen is pure presentation. Four views: Overview (pace, categories,
 * months, subscriptions), Activity, Envelopes, Accounts.
 */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString([], { month: "short" });
}

/** Horizontal bar with a label and amount, scaled to `max`. */
function Bar({
  label,
  value,
  max,
  faded,
}: {
  label: string;
  value: number;
  max: number;
  faded?: boolean;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <li className="py-1">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className={`truncate ${faded ? "text-ink-faint" : ""}`}>{label}</span>
        <span className="shrink-0 font-medium tabular-nums">{usd.format(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-line/60">
        <div
          className={`h-2 rounded-full ${faded ? "bg-ink-faint/40" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}

export function BudgetScreen({ snapshot }: { snapshot: BudgetSnapshot | null }) {
  const [tab, setTab] = useState<
    "overview" | "activity" | "envelopes" | "accounts"
  >("overview");

  if (!snapshot) {
    return (
      <>
        <PageHeader title="Budget" />
        <Empty>
          No budget data yet. The nightly sync has not run - check budget-sync
          on the Mac Studio.
        </Empty>
      </>
    );
  }

  const cash = snapshot.balances
    .filter((b) => b.balance >= 0)
    .reduce((s, b) => s + b.balance, 0);
  const owed = snapshot.balances
    .filter((b) => b.balance < 0)
    .reduce((s, b) => s + b.balance, 0);

  const trends = snapshot.trends;
  const thisMonth = trends?.monthly[snapshot.month];
  const catEntries = Object.entries(thisMonth?.byCategory ?? {}).sort(
    (a, b) => b[1] - a[1]
  );
  const maxCat = catEntries[0]?.[1] ?? 0;
  const months = Object.keys(trends?.monthly ?? {}).sort().slice(-6);
  const maxMonth = Math.max(...months.map((m) => trends!.monthly[m].total), 1);

  const pace = trends?.pace;
  const paceDelta =
    pace && pace.typicalByNow != null && pace.typicalByNow > 0
      ? (pace.spentThisMonth - pace.typicalByNow) / pace.typicalByNow
      : null;

  const envelopeGroups =
    snapshot.budget?.categoryGroups?.filter((g) => g.name !== "Income") ?? [];
  const anyBudgeted = envelopeGroups.some((g) =>
    g.categories?.some((c) => c.budgeted !== 0)
  );

  return (
    <>
      <PageHeader
        title="Budget"
        subtitle={`Updated ${new Date(snapshot.generatedAt).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}`}
      />

      <div className="mb-4 flex gap-1 rounded-xl border border-line bg-surface p-1">
        {(["overview", "activity", "envelopes", "accounts"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-1.5 text-[0.8rem] font-medium capitalize ${
              tab === t ? "bg-accent-soft text-accent" : "text-ink-faint"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="space-y-4">
          <Card>
            <p className="text-xs text-ink-faint">
              Spent in {monthLabel(snapshot.month)}
            </p>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-3xl font-semibold tabular-nums">
                {usd.format(pace?.spentThisMonth ?? thisMonth?.total ?? 0)}
              </p>
              {paceDelta != null ? (
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    paceDelta > 0.05
                      ? "bg-red-100 text-red-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {paceDelta >= 0 ? "+" : ""}
                  {Math.round(paceDelta * 100)}% vs typical
                </span>
              ) : null}
            </div>
            {pace?.typicalByNow != null ? (
              <p className="mt-1 text-xs text-ink-faint">
                Typical by day {pace.dayOfMonth}: {usd.format(pace.typicalByNow)}
              </p>
            ) : null}
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <Card>
              <p className="text-xs text-ink-faint">In the bank</p>
              <p className="text-lg font-semibold tabular-nums">{usd.format(cash)}</p>
            </Card>
            <Card>
              <p className="text-xs text-ink-faint">On the cards</p>
              <p className="text-lg font-semibold tabular-nums">{usd.format(owed)}</p>
            </Card>
          </div>

          {months.length > 1 ? (
            <Card>
              <SectionTitle>By month</SectionTitle>
              <div className="mt-2 flex items-end gap-2" style={{ height: 96 }}>
                {months.map((m) => {
                  const v = trends!.monthly[m].total;
                  const current = m === snapshot.month;
                  return (
                    <div key={m} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-[0.65rem] tabular-nums text-ink-faint">
                        {usd.format(v)}
                      </span>
                      <div
                        className={`w-full rounded-t-md ${
                          current ? "bg-accent" : "bg-accent/30"
                        }`}
                        style={{ height: `${Math.max(4, (v / maxMonth) * 64)}px` }}
                      />
                      <span
                        className={`text-[0.7rem] ${
                          current ? "font-semibold text-accent" : "text-ink-faint"
                        }`}
                      >
                        {monthLabel(m)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {catEntries.length ? (
            <Card>
              <SectionTitle>Where it went this month</SectionTitle>
              <ul className="mt-1">
                {catEntries.slice(0, 8).map(([name, value]) => (
                  <Bar
                    key={name}
                    label={name}
                    value={value}
                    max={maxCat}
                    faded={name === "Uncategorized"}
                  />
                ))}
              </ul>
            </Card>
          ) : null}

          {trends?.topPayees.length ? (
            <Card>
              <SectionTitle>Top merchants this month</SectionTitle>
              <ul className="mt-1 space-y-1.5">
                {trends.topPayees.slice(0, 5).map((p) => (
                  <li
                    key={p.payee}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="truncate">{p.payee}</span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {usd.format(p.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {trends?.recurring.length ? (
            <Card>
              <SectionTitle>Subscriptions & recurring</SectionTitle>
              <ul className="mt-1 space-y-1.5">
                {trends.recurring.map((r) => (
                  <li
                    key={r.payee}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="truncate">{r.payee}</span>
                    <span className="shrink-0 tabular-nums text-ink-soft">
                      {usdCents.format(r.avg)}/mo
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-faint">
                {usd.format(trends.recurring.reduce((s, r) => s + r.avg, 0))}
                /month total
              </p>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "activity" ? (
        <ul className="space-y-1">
          {snapshot.transactions
            .filter((t) => !t.transfer)
            .slice(0, 100)
            .map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.payee ?? t.notes ?? "—"}
                  </p>
                  <p className="truncate text-xs text-ink-faint">
                    {t.date} · {t.category ?? "uncategorized"} · {t.account}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    t.amount > 0 ? "text-green-700" : ""
                  }`}
                >
                  {usdCents.format(t.amount)}
                </p>
              </li>
            ))}
        </ul>
      ) : null}

      {tab === "envelopes" ? (
        <>
          {!anyBudgeted ? (
            <Empty>
              Envelopes are set up but no amounts are assigned yet. The budget
              conversation with Claude will fill these in.
            </Empty>
          ) : null}
          {envelopeGroups.map((g) => (
            <section key={g.id} className="mb-4">
              <SectionTitle>{g.name}</SectionTitle>
              <ul className="rounded-xl border border-line bg-surface px-3 py-1">
                {(g.categories ?? []).map((c) => {
                  const spent = Math.abs(c.spent) / 100;
                  const budgeted = c.budgeted / 100;
                  const over = budgeted > 0 && spent > budgeted;
                  return (
                    <li key={c.id} className="py-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate">{c.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                          {usd.format(spent)}
                          {budgeted ? ` of ${usd.format(budgeted)}` : ""}
                        </span>
                      </div>
                      {budgeted ? (
                        <div className="mt-1 h-1.5 rounded-full bg-line/60">
                          <div
                            className={`h-1.5 rounded-full ${
                              over ? "bg-red-500" : "bg-accent"
                            }`}
                            style={{
                              width: `${Math.min(100, (spent / budgeted) * 100)}%`,
                            }}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      ) : null}

      {tab === "accounts" ? (
        <ul className="space-y-1">
          {snapshot.balances.map((b) => (
            <li
              key={b.accountId}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2"
            >
              <span className="truncate text-sm">{b.name}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {usdCents.format(b.balance)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
