// Savings goals. Contributions are ordinary ledger rows (usually category
// "savings") tagged with a GOAL_ID, plus an optional starting balance for
// money already set aside before the goal was created.
import db from "./db";
import { addMonths, currentMonth } from "./months";

export type Goal = {
  ID: string;
  NAME: string;
  EMOJI: string | null;
  TARGET_AMOUNT: number;
  TARGET_MONTH: string | null;
  STARTING_AMOUNT: number;
  CREATED_AT: string;
};

export type GoalProgress = Goal & {
  saved: number;
  remaining: number;
  pct: number;
  monthsLeft: number | null;
  neededPerMonth: number | null;
  recentPerMonth: number;
  projectedMonth: string | null;
  status: "done" | "on-track" | "behind" | "no-deadline";
};

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export async function listGoals(ws: string): Promise<GoalProgress[]> {
  const [goalRows] = await db.execute(
    `SELECT ID, NAME, EMOJI, CAST(TARGET_AMOUNT AS REAL) AS TARGET_AMOUNT, TARGET_MONTH,
            CAST(STARTING_AMOUNT AS REAL) AS STARTING_AMOUNT, CREATED_AT
     FROM SAVINGS_GOAL WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT`,
    [ws],
  );
  const goals = goalRows as Goal[];
  if (goals.length === 0) return [];

  const now = currentMonth();
  const recentStart = addMonths(now, -2); // this month + two before = 3-month pace
  const [sumRows] = await db.execute(
    `SELECT GOAL_ID, CAST(SUM(AMOUNT) AS REAL) AS TOTAL,
            CAST(SUM(CASE WHEN MONTH >= ? THEN AMOUNT ELSE 0 END) AS REAL) AS RECENT
     FROM LEDGER WHERE WORKSPACE_ID = ? AND GOAL_ID IS NOT NULL AND DELETED_AT IS NULL GROUP BY GOAL_ID`,
    [recentStart, ws],
  );
  const sums = new Map((sumRows as Array<{ GOAL_ID: string; TOTAL: number; RECENT: number }>).map((r) => [r.GOAL_ID, r]));

  return goals.map((g) => {
    const s = sums.get(g.ID);
    const saved = g.STARTING_AMOUNT + (s?.TOTAL ?? 0);
    const remaining = Math.max(0, g.TARGET_AMOUNT - saved);
    const pct = g.TARGET_AMOUNT > 0 ? Math.min(100, (saved / g.TARGET_AMOUNT) * 100) : 0;
    const recentPerMonth = (s?.RECENT ?? 0) / 3;
    const monthsLeft = g.TARGET_MONTH ? Math.max(0, monthsBetween(now, g.TARGET_MONTH)) : null;
    const neededPerMonth = monthsLeft === null ? null : monthsLeft === 0 ? remaining : remaining / monthsLeft;
    const projectedMonth = remaining === 0 ? now : recentPerMonth > 0 ? addMonths(now, Math.ceil(remaining / recentPerMonth)) : null;
    const status: GoalProgress["status"] =
      remaining === 0 ? "done"
        : monthsLeft === null ? "no-deadline"
          : projectedMonth !== null && projectedMonth <= g.TARGET_MONTH! ? "on-track"
            : "behind";
    return { ...g, saved, remaining, pct, monthsLeft, neededPerMonth, recentPerMonth, projectedMonth, status };
  });
}
