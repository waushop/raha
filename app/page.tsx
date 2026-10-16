import { connection } from "next/server";
import db from "@/lib/db";
import { currentContext } from "@/lib/auth";
import type { Expense, CategoryKey } from "@/types/expense";
import { getGroups } from "@/app/actions";
import MonthNav from "@/components/MonthNav";
import ExpenseTable from "@/components/ExpenseTable";
import TrendChart from "@/components/TrendChart";
import SwipeContainer from "@/components/SwipeContainer";
import QuickAddBar from "@/components/QuickAddBar";
import { addMonths, currentMonth, isValidMonth } from "@/lib/months";
import { monthlyTotals } from "@/lib/queries";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const { month: monthParam } = await searchParams;
  const month = isValidMonth(monthParam) ? monthParam : currentMonth();

  // Fetch expenses with group info
  const [rows] = await db.execute(
    `SELECT e.ID, e.KIND, e.CATEGORY, CAST(e.AMOUNT AS REAL) AS AMOUNT, e.MONTH, e.DAY, e.GOAL_ID, e.NAME,
            e.NOTES, e.IS_RECURRING, e.TAGS, e.GROUP_ID, e.CREATED_AT,
            g.NAME AS GROUP_NAME, g.EMOJI AS GROUP_EMOJI, g.COLOR AS GROUP_COLOR
     FROM LEDGER e
     LEFT JOIN CATEGORY_GROUP g ON e.GROUP_ID = g.ID AND g.DELETED_AT IS NULL
     WHERE e.WORKSPACE_ID = ? AND e.MONTH = ? AND e.DELETED_AT IS NULL
     ORDER BY g.SORT_ORDER, g.NAME, e.CREATED_AT`,
    [ws, month]
  );
  const expenses = rows as Expense[];
  const spent = expenses.filter((e) => e.KIND === "expense");

  // Fetch groups
  const groups = await getGroups();

  // Fetch 6-month trend data
  const trendData = await monthlyTotals(ws, "expense", addMonths(month, -5), month);

  // Quick-add presets
  const existingNames = new Set(expenses.map(e => e.NAME));
  const [presetRows] = await db.execute(
    `SELECT NAME, CATEGORY, GROUP_ID, CAST(AMOUNT AS REAL) AS AMOUNT,
            COUNT(DISTINCT MONTH) AS MONTHS
     FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL
     GROUP BY NAME, CATEGORY, GROUP_ID, AMOUNT
     HAVING MONTHS >= 3
     ORDER BY MONTHS DESC
     LIMIT 20`,
    [ws]
  );
  const quickPresets = (presetRows as Array<{ NAME: string; CATEGORY: CategoryKey; GROUP_ID: string | null; AMOUNT: number }>)
    .filter(p => !existingNames.has(p.NAME))
    .slice(0, 10);

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-20">
      <SwipeContainer month={month}>
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 flex items-center justify-between animate-fade-up sticky top-3 z-30">
          <div>
            <h1 className="text-4xl sm:text-5xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
              Empty Wallet
            </h1>
            {spent.length > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm font-mono font-bold text-white/80 tabular-nums">
                  {spent.reduce((s, e) => s + e.AMOUNT, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} €
                </span>
                <span className="text-[9px] text-[#5a6380] bg-white/5 rounded-full px-1.5 py-0.5">
                  {spent.length} expense{spent.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>
          <MonthNav month={month} />
        </div>

        {/* Trend */}
        {trendData.length >= 2 && (
          <div className="animate-fade-up" style={{ animationDelay: "0.05s" }}>
            <TrendChart
              data={trendData.map(r => ({ month: r.MONTH, total: r.TOTAL }))}
              currentMonth={month}
            />
          </div>
        )}

        {/* Quick-add presets */}
        {quickPresets.length > 0 && (
          <div className="animate-fade-up" style={{ animationDelay: "0.08s" }}>
            <QuickAddBar presets={quickPresets} month={month} />
          </div>
        )}

        {/* Expense cards */}
        <div className="animate-fade-up" style={{ animationDelay: "0.1s" }}>
          <ExpenseTable expenses={expenses} month={month} groups={groups} />
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-center gap-3 pt-6 pb-2 animate-fade-up" style={{ animationDelay: "0.14s" }}>
          <a href="/dashboard" className="text-[10px] text-[#5a6380] hover:text-pink-400/70 transition-colors font-medium">Dashboard</a>
          <span className="text-[#5a6380]/20">·</span>
          <a href={`/year?year=${month.split("-")[0]}`} className="text-[10px] text-[#5a6380] hover:text-pink-400/70 transition-colors font-medium">Year</a>
          <span className="text-[#5a6380]/20">·</span>
          <a href="/analytics" className="text-[10px] text-[#5a6380] hover:text-pink-400/70 transition-colors font-medium">Analytics</a>
          <span className="text-[#5a6380]/20">·</span>
          <a href={`/api/export?month=${month}`} className="text-[10px] text-[#5a6380] hover:text-pink-400/70 transition-colors font-medium">CSV</a>
        </footer>
      </div>
      </SwipeContainer>
    </main>
  );
}
