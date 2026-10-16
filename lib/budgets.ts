import db from "./db";
import type { CategoryKey } from "@/types/expense";
import { currentMonth } from "./months";

// Defaults used when no DB rows exist. Edit these for the cold-start values
// for new installs; live values are stored in the BUDGET table and edited
// from the Settings UI.
export const DEFAULT_CATEGORY_BUDGETS: Partial<Record<CategoryKey, number>> = {
  housing: 1500,
  fuel: 300,
  kids: 500,
  subscriptions: 30,
  personal: 250,
};

export const DEFAULT_TOTAL_BUDGET = 2800;

const TOTAL_KEY = "_total";

export type BudgetMap = Partial<Record<CategoryKey, number>>;

export async function getBudgets(ws: string): Promise<{ total: number; categories: BudgetMap }> {
  const [rows] = await db.execute("SELECT CATEGORY, AMOUNT FROM BUDGET WHERE WORKSPACE_ID = ?", [ws]);
  const stored = new Map<string, number>();
  for (const r of rows as Array<{ CATEGORY: string; AMOUNT: number }>) {
    stored.set(r.CATEGORY, r.AMOUNT);
  }
  const total = stored.get(TOTAL_KEY) ?? DEFAULT_TOTAL_BUDGET;
  const categories: BudgetMap = { ...DEFAULT_CATEGORY_BUDGETS };
  for (const [k, v] of stored) {
    if (k !== TOTAL_KEY) (categories as Record<string, number>)[k] = v;
  }
  return { total, categories };
}

export async function setBudgetAmount(ws: string, category: string, amount: number | null): Promise<void> {
  if (amount === null || amount === 0 || Number.isNaN(amount)) {
    await db.execute("DELETE FROM BUDGET WHERE WORKSPACE_ID = ? AND CATEGORY = ?", [ws, category]);
  } else {
    await db.execute(
      `INSERT INTO BUDGET (WORKSPACE_ID, CATEGORY, AMOUNT) VALUES (?, ?, ?)
       ON CONFLICT(WORKSPACE_ID, CATEGORY) DO UPDATE SET AMOUNT = excluded.AMOUNT`,
      [ws, category, amount],
    );
  }
  await snapshotBudgets(ws, currentMonth());
}

export async function resetBudgets(ws: string): Promise<void> {
  await db.execute("DELETE FROM BUDGET WHERE WORKSPACE_ID = ?", [ws]);
  await snapshotBudgets(ws, currentMonth());
}

// ============================================
// HISTORY — budgets as they stood each month
// ============================================

export type Budgets = { total: number; categories: BudgetMap };

/** Records the resolved budgets (defaults included) as `month`'s snapshot, replacing any previous one. */
export async function snapshotBudgets(ws: string, month: string): Promise<void> {
  const { total, categories } = await getBudgets(ws);
  db.transaction((tx) => {
    tx.run("DELETE FROM BUDGET_HISTORY WHERE WORKSPACE_ID = ? AND MONTH = ?", [ws, month]);
    tx.run("INSERT INTO BUDGET_HISTORY (WORKSPACE_ID, MONTH, CATEGORY, AMOUNT) VALUES (?, ?, ?, ?)", [ws, month, TOTAL_KEY, total]);
    for (const [cat, amt] of Object.entries(categories)) {
      if (amt && amt > 0) tx.run("INSERT INTO BUDGET_HISTORY (WORKSPACE_ID, MONTH, CATEGORY, AMOUNT) VALUES (?, ?, ?, ?)", [ws, month, cat, amt]);
    }
  });
}

/** Takes a snapshot for `month` only if none exists yet. Called when the dashboard renders. */
export async function ensureBudgetSnapshot(ws: string, month: string): Promise<void> {
  const [rows] = await db.execute("SELECT 1 FROM BUDGET_HISTORY WHERE WORKSPACE_ID = ? AND MONTH = ? LIMIT 1", [ws, month]);
  if ((rows as unknown[]).length === 0) await snapshotBudgets(ws, month);
}

/** Every snapshot, keyed by month. */
export async function getBudgetHistory(ws: string): Promise<Map<string, Budgets>> {
  const [rows] = await db.execute("SELECT MONTH, CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT FROM BUDGET_HISTORY WHERE WORKSPACE_ID = ? ORDER BY MONTH", [ws]);
  const out = new Map<string, Budgets>();
  for (const r of rows as Array<{ MONTH: string; CATEGORY: string; AMOUNT: number }>) {
    let b = out.get(r.MONTH);
    if (!b) { b = { total: 0, categories: {} }; out.set(r.MONTH, b); }
    if (r.CATEGORY === TOTAL_KEY) b.total = r.AMOUNT;
    else (b.categories as Record<string, number>)[r.CATEGORY] = r.AMOUNT;
  }
  return out;
}

/**
 * Budgets in force for `month`: its own snapshot, else the latest earlier
 * one, else the current budgets (for months before any snapshot existed).
 */
export function resolveBudgetsFor(month: string, history: Map<string, Budgets>, current: Budgets): Budgets {
  let best: string | null = null;
  for (const m of history.keys()) if (m <= month && (best === null || m > best)) best = m;
  return best ? history.get(best)! : current;
}

