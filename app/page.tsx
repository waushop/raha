import db from "@/lib/db";
import type { Expense, Category } from "@/types/expense";
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
  const { month: monthParam } = await searchParams;
  const month = monthParam ?? previousMonth();

  const [rows] = await db.execute(
    "SELECT ID, CATEGORY, CAST(AMOUNT AS DOUBLE) AS AMOUNT, PAID_BY, SIIM_PCT, MONTH, NAME, CREATED_AT FROM EXPENSES WHERE MONTH = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT",
    [month]
  );
  const expenses = rows as Expense[];

  // Fetch 6-month trend data
  const { start } = getMonthRange(month, 5);
  const [trendRows] = await db.execute(
    "SELECT MONTH, CAST(SUM(AMOUNT) AS DOUBLE) AS TOTAL FROM EXPENSES WHERE DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ? GROUP BY MONTH ORDER BY MONTH",
    [start, month]
  );
  const trendData = trendRows as { MONTH: string; TOTAL: number }[];

  // Recurring expense names (appeared in 3+ months)
  const [recurringRows] = await db.execute(
    "SELECT NAME FROM EXPENSES WHERE DELETED_AT IS NULL GROUP BY NAME HAVING COUNT(DISTINCT MONTH) >= 3"
  );
  const recurringNames = new Set((recurringRows as { NAME: string }[]).map(r => r.NAME));

  // Quick-add presets: recurring expenses NOT yet added this month
  const existingNames = new Set(expenses.map(e => e.NAME));
  const [presetRows] = await db.execute(
    `SELECT NAME, CATEGORY, CAST(AMOUNT AS DOUBLE) AS AMOUNT, PAID_BY, SIIM_PCT,
            COUNT(DISTINCT MONTH) AS MONTHS
     FROM EXPENSES WHERE DELETED_AT IS NULL
     GROUP BY NAME, CATEGORY, AMOUNT, PAID_BY, SIIM_PCT
     HAVING MONTHS >= 3
     ORDER BY MONTHS DESC
     LIMIT 20`
  );
  const quickPresets = (presetRows as Array<{ NAME: string; CATEGORY: Category; AMOUNT: number; PAID_BY: "siim" | "janne"; SIIM_PCT: number }>)
    .filter(p => !existingNames.has(p.NAME))
    .slice(0, 10);

  return (
    <main className="min-h-screen py-6 px-4 sm:py-10 pb-20">
      <SwipeContainer month={month}>
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 flex items-center justify-between animate-fade-up sticky top-3 z-30">
          <div>
            <h1 className="text-4xl sm:text-5xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight" style={{ fontFamily: "'Caveat', cursive", fontWeight: 700 }}>
              Tühi Rahakott
            </h1>
            {expenses.length > 0 && (
              <p className="text-[10px] sm:text-xs text-[#4a5568] mt-0.5">
                <span className="inline-flex items-center bg-white/5 rounded-full px-1.5 py-0.5 text-[9px] tracking-normal">
                  {expenses.length} kulu
                </span>
              </p>
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
          <ExpenseTable expenses={expenses} month={month} recurringNames={recurringNames} />
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-center gap-4 pt-6 pb-2 animate-fade-up" style={{ animationDelay: "0.14s" }}>
          <a href={`/year?year=${month.split("-")[0]}`} className="text-[10px] text-[#4a5568] hover:text-pink-400/70 transition-colors tracking-wider font-medium inline-flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Aasta ülevaade
          </a>
          <span className="text-[#4a5568]/20">|</span>
          <span className="text-[10px] text-[#4a5568]/30 tracking-wider font-medium">v2.0</span>
        </footer>
      </div>
      </SwipeContainer>
    </main>
  );
}
