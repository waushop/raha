import { connection } from "next/server";
import db from "@/lib/db";
import type { Expense, ExpenseGroup, CategoryKey } from "@/types/expense";
import { getGroups } from "@/app/actions";
import MonthNav from "@/components/MonthNav";
import ExpenseTable from "@/components/ExpenseTable";
import TrendChart from "@/components/TrendChart";
import SwipeContainer from "@/components/SwipeContainer";
import QuickAddBar from "@/components/QuickAddBar";

function previousMonth() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(month: string, range: number): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const startDate = new Date(y, m - 1 - range, 1);
  const start = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}`;
  return { start, end: month };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await connection();
  const { month: monthParam } = await searchParams;
  const month = monthParam ?? previousMonth();

  // Fetch expenses with group info
  const [rows] = await db.execute(
    `SELECT e.ID, e.CATEGORY, CAST(e.AMOUNT AS REAL) AS AMOUNT, e.MONTH, e.NAME,
            e.NOTES, e.IS_RECURRING, e.TAGS, e.GROUP_ID, e.CREATED_AT,
            g.NAME AS GROUP_NAME, g.EMOJI AS GROUP_EMOJI, g.COLOR AS GROUP_COLOR
     FROM EXPENSE e
     LEFT JOIN EXPENSE_GROUP g ON e.GROUP_ID = g.ID AND g.DELETED_AT IS NULL
     WHERE e.MONTH = ? AND e.DELETED_AT IS NULL
     ORDER BY g.SORT_ORDER, g.NAME, e.CREATED_AT`,
    [month]
  );
  const expenses = rows as Expense[];

  // Fetch groups
  const groups = await getGroups();

  // Fetch 6-month trend data
  const { start } = getMonthRange(month, 5);
  const [trendRows] = await db.execute(
    "SELECT MONTH, CAST(SUM(AMOUNT) AS REAL) AS TOTAL FROM EXPENSE WHERE DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ? GROUP BY MONTH ORDER BY MONTH",
    [start, month]
  );
  const trendData = trendRows as { MONTH: string; TOTAL: number }[];

  // Quick-add presets
  const existingNames = new Set(expenses.map(e => e.NAME));
  const [presetRows] = await db.execute(
    `SELECT NAME, CATEGORY, GROUP_ID, CAST(AMOUNT AS REAL) AS AMOUNT,
            COUNT(DISTINCT MONTH) AS MONTHS
     FROM EXPENSE WHERE DELETED_AT IS NULL
     GROUP BY NAME, CATEGORY, GROUP_ID, AMOUNT
     HAVING MONTHS >= 3
     ORDER BY MONTHS DESC
     LIMIT 20`
  );
  const quickPresets = (presetRows as Array<{ NAME: string; CATEGORY: CategoryKey; GROUP_ID: string | null; AMOUNT: number }>)
    .filter(p => !existingNames.has(p.NAME))
    .slice(0, 10);

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 sm:py-10 pb-20">
      <SwipeContainer month={month}>
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 flex items-center justify-between animate-fade-up sticky top-3 z-30">
          <div>
            <h1 className="text-4xl sm:text-5xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight" style={{ fontFamily: "'Caveat', cursive", fontWeight: 700 }}>
              Empty Wallet
            </h1>
            {expenses.length > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm font-mono font-bold text-white/80 tabular-nums">
                  {expenses.reduce((s, e) => s + e.AMOUNT, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} €
                </span>
                <span className="text-[9px] text-[#5a6380] bg-white/5 rounded-full px-1.5 py-0.5">
                  {expenses.length} expenses
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
