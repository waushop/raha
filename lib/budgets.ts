import db from "./db";
import type { CategoryKey } from "@/types/expense";

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

export async function getBudgets(): Promise<{ total: number; categories: BudgetMap }> {
  const [rows] = await db.execute("SELECT CATEGORY, AMOUNT FROM BUDGET");
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

export async function setBudgetAmount(category: string, amount: number | null): Promise<void> {
  if (amount === null || amount === 0 || Number.isNaN(amount)) {
    await db.execute("DELETE FROM BUDGET WHERE CATEGORY = ?", [category]);
    return;
  }
  await db.execute(
    `INSERT INTO BUDGET (CATEGORY, AMOUNT) VALUES (?, ?)
     ON CONFLICT(CATEGORY) DO UPDATE SET AMOUNT = excluded.AMOUNT`,
    [category, amount],
  );
}

export async function resetBudgets(): Promise<void> {
  await db.execute("DELETE FROM BUDGET");
}

export const TOTAL_BUDGET_KEY = TOTAL_KEY;
