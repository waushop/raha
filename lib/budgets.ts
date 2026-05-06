import type { CategoryKey } from "@/types/expense";

// Monthly budget targets per category (in EUR)
export const CATEGORY_BUDGETS: Partial<Record<CategoryKey, number>> = {
  housing: 1500,
  fuel: 300,
  kids: 500,
  subscriptions: 30,
  personal: 250,
};

export const TOTAL_BUDGET = 2800;
