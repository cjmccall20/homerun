import fs from "node:fs/promises";

/**
 * The budget surface reads a snapshot JSON written by bin/budget-sync.mjs
 * (nightly launchd job). Actual Budget is the engine of record; this file is
 * deliberately read-only - edits (categorizing, envelope amounts) happen in
 * Actual or through the sync scripts, never from the phone UI directly.
 */

const SNAPSHOT_FILE =
  process.env.HOMERUN_BUDGET_SNAPSHOT ?? "";

export interface BudgetTxn {
  id: string;
  account: string;
  date: string;
  amount: number;
  payee: string | null;
  category: string | null;
  notes: string | null;
  cleared: boolean;
  transfer: boolean;
  income: boolean;
}

export interface BudgetTrends {
  monthly: Record<string, { total: number; byCategory: Record<string, number> }>;
  pace: {
    dayOfMonth: number;
    spentThisMonth: number;
    typicalByNow: number | null;
  };
  topPayees: { payee: string; total: number }[];
  recurring: { payee: string; avg: number; months: number }[];
}

export interface BudgetBalance {
  accountId: string;
  name: string;
  balance: number;
  balanceDate: number | null;
}

export interface BudgetEnvelope {
  categoryId: string;
  budgeted: number;
  spent: number;
  balance: number;
}

export interface BudgetSnapshot {
  generatedAt: string;
  month: string;
  balances: BudgetBalance[];
  budget: {
    month: string;
    categoryGroups?: {
      id: string;
      name: string;
      categories?: {
        id: string;
        name: string;
        budgeted: number;
        spent: number;
        balance: number;
      }[];
    }[];
  } | null;
  categoryGroups: {
    id: string;
    name: string;
    categories: { id: string; name: string }[];
  }[];
  transactions: BudgetTxn[];
  trends?: BudgetTrends;
}

export async function readBudgetSnapshot(): Promise<BudgetSnapshot | null> {
  try {
    return JSON.parse(await fs.readFile(SNAPSHOT_FILE, "utf8"));
  } catch {
    return null;
  }
}
