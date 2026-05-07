import { connection } from "next/server";
import db from "@/lib/db";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES } from "@/types/expense";
import Link from "next/link";
import SpendingHeatmap from "@/components/SpendingHeatmap";
import Insights from "@/components/Insights";
import Welcome from "@/components/Welcome";
import { getBudgets } from "@/lib/budgets";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtShort = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

function daysLeftInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate();
}

export default async function DashboardPage() {
  await connection();
  const thisMonth = currentMonth();
  const prevMonth = previousMonth();
  const now = new Date();
  const dayOfMonth = now.getDate();
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysLeftInMonth();

  // This month totals
  const [thisRows] = await db.execute(
    `SELECT CAST(SUM(AMOUNT) AS REAL) AS TOTAL, COUNT(*) AS CNT
     FROM LEDGER WHERE MONTH = ? AND KIND = 'expense' AND DELETED_AT IS NULL`,
    [thisMonth]
  );
  const thisData = (thisRows as Array<{ TOTAL: number | null; CNT: number }>)[0];
  const thisTotal = thisData?.TOTAL ?? 0;
  const thisCount = thisData?.CNT ?? 0;

  // Previous month totals
  const [prevRows] = await db.execute(
    `SELECT CAST(SUM(AMOUNT) AS REAL) AS TOTAL, COUNT(*) AS CNT
     FROM LEDGER WHERE MONTH = ? AND KIND = 'expense' AND DELETED_AT IS NULL`,
    [prevMonth]
  );
  const prevData = (prevRows as Array<{ TOTAL: number | null; CNT: number }>)[0];
  const prevTotal = prevData?.TOTAL ?? 0;

  // 6-month average
  const startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const sixMonthStart = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}`;
  const [avgRows] = await db.execute(
    `SELECT CAST(SUM(AMOUNT) / COUNT(DISTINCT MONTH) AS REAL) AS AVG_MONTHLY
     FROM LEDGER WHERE KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH < ?`,
    [sixMonthStart, thisMonth]
  );

  // Income: this month + last month + net.
  const [thisIncomeRows] = await db.execute(
    "SELECT CAST(SUM(AMOUNT) AS REAL) AS TOTAL FROM LEDGER WHERE MONTH = ? AND KIND = 'income' AND DELETED_AT IS NULL",
    [thisMonth],
  );
  const thisIncome = (thisIncomeRows as Array<{ TOTAL: number | null }>)[0]?.TOTAL ?? 0;
  const [prevIncomeRows] = await db.execute(
    "SELECT CAST(SUM(AMOUNT) AS REAL) AS TOTAL FROM LEDGER WHERE MONTH = ? AND KIND = 'income' AND DELETED_AT IS NULL",
    [prevMonth],
  );
  const prevIncome = (prevIncomeRows as Array<{ TOTAL: number | null }>)[0]?.TOTAL ?? 0;
  const thisNet = thisIncome - thisTotal;
  const prevNet = prevIncome - prevTotal;
  const avgMonthly = (avgRows as Array<{ AVG_MONTHLY: number | null }>)[0]?.AVG_MONTHLY ?? 0;

  // This month categories
  const [catRows] = await db.execute(
    `SELECT CATEGORY, CAST(SUM(AMOUNT) AS REAL) AS TOTAL
     FROM LEDGER WHERE MONTH = ? AND KIND = 'expense' AND DELETED_AT IS NULL
     GROUP BY CATEGORY ORDER BY TOTAL DESC`,
    [thisMonth]
  );
  const categories = catRows as { CATEGORY: CategoryKey; TOTAL: number }[];

  // Previous month categories (for comparison)
  const [prevCatRows] = await db.execute(
    `SELECT CATEGORY, CAST(SUM(AMOUNT) AS REAL) AS TOTAL
     FROM LEDGER WHERE MONTH = ? AND KIND = 'expense' AND DELETED_AT IS NULL
     GROUP BY CATEGORY ORDER BY TOTAL DESC`,
    [prevMonth]
  );
  const prevCatMap = new Map<string, number>();
  for (const r of prevCatRows as { CATEGORY: string; TOTAL: number }[]) {
    prevCatMap.set(r.CATEGORY, r.TOTAL);
  }

  // Budgets + per-category pacing (this month).
  const budgets = await getBudgets();
  const budgetCatList = (Object.entries(budgets.categories) as Array<[CategoryKey, number]>)
    .filter(([, amt]) => amt > 0)
    .map(([cat, amt]) => {
      const spent = categories.find((r) => r.CATEGORY === cat)?.TOTAL ?? 0;
      const expected = amt * (dayOfMonth / totalDays);
      const pct = amt > 0 ? (spent / amt) * 100 : 0;
      const status: "ahead" | "ok" | "behind" | "over" =
        spent > amt
          ? "over"
          : spent > expected * 1.05
            ? "ahead"
            : spent < expected * 0.85
              ? "behind"
              : "ok";
      return { category: cat, budget: amt, spent, expected, pct, status };
    })
    .sort((a, b) => b.pct - a.pct);
  const totalExpected = budgets.total * (dayOfMonth / totalDays);
  const totalPct = budgets.total > 0 ? (thisTotal / budgets.total) * 100 : 0;
  const totalStatus: "ahead" | "ok" | "behind" | "over" =
    thisTotal > budgets.total
      ? "over"
      : thisTotal > totalExpected * 1.05
        ? "ahead"
        : thisTotal < totalExpected * 0.85
          ? "behind"
          : "ok";

  // Recurring expenses not yet added this month
  const [recurringRows] = await db.execute(
    `SELECT e.NAME, e.CATEGORY, CAST(e.AMOUNT AS REAL) AS AMOUNT
     FROM LEDGER e
     WHERE e.IS_RECURRING = 1 AND e.KIND = 'expense' AND e.DELETED_AT IS NULL
       AND e.MONTH = (SELECT MAX(MONTH) FROM LEDGER WHERE IS_RECURRING = 1 AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH < ?)
       AND e.NAME NOT IN (SELECT NAME FROM LEDGER WHERE MONTH = ? AND KIND = 'expense' AND DELETED_AT IS NULL)
     GROUP BY e.NAME, e.CATEGORY, e.AMOUNT`,
    [thisMonth, thisMonth]
  );
  const missingRecurring = recurringRows as { NAME: string; CATEGORY: CategoryKey; AMOUNT: number }[];

  // Recent entries (last 5, both kinds — visual indicator below)
  const [recentRows] = await db.execute(
    `SELECT NAME, CATEGORY, KIND, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, CREATED_AT
     FROM LEDGER WHERE DELETED_AT IS NULL
     ORDER BY CREATED_AT DESC LIMIT 5`
  );
  const recentExpenses = recentRows as { NAME: string; CATEGORY: CategoryKey; KIND: "expense" | "income"; AMOUNT: number; MONTH: string; CREATED_AT: string }[];

  // Spending pace
  const expectedSpend = avgMonthly * (dayOfMonth / totalDays);
  const pace = expectedSpend > 0 ? ((thisTotal - expectedSpend) / expectedSpend) * 100 : 0;
  const diffFromPrev = prevTotal > 0 ? ((thisTotal - prevTotal) / prevTotal) * 100 : 0;

  // Predicted end-of-month
  const dailyRate = dayOfMonth > 0 ? thisTotal / dayOfMonth : 0;
  const predicted = dailyRate * totalDays;

  const missingRecurringCount = missingRecurring.length;

  // Heatmap data (all months, expenses only)
  const [heatmapRows] = await db.execute(
    "SELECT MONTH, CAST(SUM(AMOUNT) AS REAL) AS TOTAL FROM LEDGER WHERE KIND = 'expense' AND DELETED_AT IS NULL GROUP BY MONTH ORDER BY MONTH"
  );
  const heatmapData = (heatmapRows as { MONTH: string; TOTAL: number }[]).map(r => ({ month: r.MONTH, total: r.TOTAL }));

  // Welcome screen is for *truly* fresh installs — no expenses AND no groups
  // yet. Once the user has any groups, drop the Welcome and render the regular
  // dashboard (zeros + 0-row cards) so they can navigate to / and start adding.
  const [groupCountRows] = await db.execute(
    "SELECT COUNT(*) AS CNT FROM CATEGORY_GROUP WHERE DELETED_AT IS NULL"
  );
  const groupCount = (groupCountRows as Array<{ CNT: number }>)[0]?.CNT ?? 0;
  const isNewUser =
    thisTotal === 0 && prevTotal === 0 && heatmapData.length === 0 && groupCount === 0;

  if (isNewUser) {
    return (
      <main className="min-h-screen flex items-center justify-center py-10 px-4 pl-16 sm:pl-20">
        <Welcome />
      </main>
    );
  }

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 sm:py-10 pb-20">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <h1
            className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight"
            style={{ fontFamily: "'Caveat', cursive", fontWeight: 700 }}
          >
            Empty Wallet
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">
            Today is day {dayOfMonth}, {daysLeft} days left.
          </p>
        </div>

        {/* Income + Net (only renders if user has any income tracked) */}
        {(thisIncome > 0 || prevIncome > 0) && (
          <div className="grid grid-cols-3 gap-3 animate-fade-up" style={{ animationDelay: "0.04s" }}>
            <div className="card rounded-2xl p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Income (this)</p>
              <p className="text-xl font-bold text-teal-400 font-mono tabular-nums">{fmt(thisIncome)} €</p>
              {prevIncome > 0 && (
                <p className="text-[9px] text-[#5a6380] mt-1 font-mono tabular-nums">prev: {fmt(prevIncome)}</p>
              )}
            </div>
            <div className="card rounded-2xl p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Spent (this)</p>
              <p className="text-xl font-bold text-pink-400 font-mono tabular-nums">{fmt(thisTotal)} €</p>
              {prevTotal > 0 && (
                <p className="text-[9px] text-[#5a6380] mt-1 font-mono tabular-nums">prev: {fmt(prevTotal)}</p>
              )}
            </div>
            <div className="card rounded-2xl p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Net (this)</p>
              <p className={`text-xl font-bold font-mono tabular-nums ${thisNet >= 0 ? "text-teal-400" : "text-red-400"}`}>
                {thisNet >= 0 ? "+" : ""}{fmt(thisNet)} €
              </p>
              {prevTotal > 0 && (
                <p className="text-[9px] text-[#5a6380] mt-1 font-mono tabular-nums">prev: {prevNet >= 0 ? "+" : ""}{fmt(prevNet)}</p>
              )}
            </div>
          </div>
        )}

        {/* Key metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <Link href={`/?month=${thisMonth}`} className="card rounded-2xl p-4 card-hover">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">This month</p>
            <p className="text-xl font-bold text-white font-mono tabular-nums">{fmt(thisTotal)} €</p>
            <p className="text-[9px] text-[#5a6380] mt-1">{thisCount} kulu</p>
          </Link>
          <Link href={`/?month=${prevMonth}`} className="card rounded-2xl p-4 card-hover">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Last month</p>
            <p className="text-xl font-bold text-white font-mono tabular-nums">{fmt(prevTotal)} €</p>
            {prevTotal > 0 && (
              <p className={`text-[9px] font-bold mt-1 ${diffFromPrev > 0 ? "text-red-400/60" : "text-teal-400/60"}`}>
                {diffFromPrev > 0 ? "+" : ""}{diffFromPrev.toFixed(0)}%
              </p>
            )}
          </Link>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">6-mo average</p>
            <p className="text-xl font-bold text-white font-mono tabular-nums">{fmt(avgMonthly)} €</p>
            <p className="text-[9px] text-[#5a6380] mt-1">monthly</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Forecast</p>
            <p className="text-xl font-bold text-amber-400 font-mono tabular-nums">{fmt(predicted)} €</p>
            <p className={`text-[9px] font-bold mt-1 ${Math.abs(pace) < 5 ? "text-teal-400/60" : pace > 0 ? "text-red-400/60" : "text-teal-400/60"}`}>
              {Math.abs(pace) < 5 ? "On pace" : pace > 0 ? "Ahead" : "Behind"}
            </p>
          </div>
        </div>

        {/* Insights */}
        <div className="animate-fade-up" style={{ animationDelay: "0.06s" }}>
          <Insights
            thisTotal={thisTotal}
            prevTotal={prevTotal}
            avgMonthly={avgMonthly}
            recurringCount={missingRecurringCount}
            thisCount={thisCount}
            daysLeft={daysLeft}
            predicted={predicted}
          />
        </div>

        {/* Spending progress bar */}
        {thisTotal > 0 && (
          <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.07s" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-white">Month progress</span>
              <span className="text-[10px] text-[#5a6380]">Day {dayOfMonth}/{totalDays}</span>
            </div>
            <div className="relative h-3 w-full rounded-full overflow-hidden bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-700"
                style={{ width: `${Math.min((thisTotal / (avgMonthly || thisTotal)) * 100, 100)}%` }}
              />
              {/* Time marker */}
              <div
                className="absolute top-0 h-full w-0.5 bg-white/40 rounded-full"
                style={{ left: `${(dayOfMonth / totalDays) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] text-[#5a6380]">
              <span className="font-mono tabular-nums">{fmt(thisTotal)} €</span>
              <span className="font-mono tabular-nums">average: {fmt(avgMonthly)} €</span>
            </div>
          </div>
        )}

        {/* Budget pacing */}
        {budgets.total > 0 && (
          <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.075s" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
                Budget
              </h2>
              <Link href="/settings" className="text-[10px] text-[#5a6380] hover:text-pink-400 transition-colors">Edit →</Link>
            </div>

            {/* Total */}
            <div className="mb-4 pb-4 border-b border-white/[0.06]">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-xs font-bold text-white">Total</span>
                <span className="text-xs font-mono tabular-nums">
                  <span className={
                    totalStatus === "over" ? "text-red-400" :
                    totalStatus === "ahead" ? "text-amber-400" :
                    totalStatus === "behind" ? "text-teal-400" : "text-white/80"
                  }>
                    {fmt(thisTotal)}
                  </span>
                  <span className="text-[#5a6380]"> / {fmt(budgets.total)} €</span>
                </span>
              </div>
              <div className="relative h-2 rounded-full overflow-hidden bg-white/5">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    totalStatus === "over"
                      ? "bg-gradient-to-r from-red-500 to-pink-500"
                      : totalStatus === "ahead"
                        ? "bg-gradient-to-r from-amber-500 to-pink-500"
                        : "bg-gradient-to-r from-purple-500 to-pink-500"
                  }`}
                  style={{ width: `${Math.min(totalPct, 100)}%` }}
                />
                {/* Day-of-month marker */}
                <div
                  className="absolute top-0 h-full w-0.5 bg-white/40 rounded-full"
                  style={{ left: `${(dayOfMonth / totalDays) * 100}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-[10px]">
                <span className={
                  totalStatus === "over" ? "text-red-400 font-bold" :
                  totalStatus === "ahead" ? "text-amber-400 font-bold" :
                  totalStatus === "behind" ? "text-teal-400 font-bold" : "text-[#5a6380]"
                }>
                  {totalStatus === "over" ? "Over budget" :
                   totalStatus === "ahead" ? "Ahead of pace" :
                   totalStatus === "behind" ? "Under pace" : "On pace"}
                </span>
                <span className="text-[#5a6380] font-mono tabular-nums">
                  expected: {fmt(totalExpected)} €
                </span>
              </div>
            </div>

            {/* Per-category */}
            {budgetCatList.length > 0 && (
              <div className="space-y-2.5">
                {budgetCatList.map((b) => {
                  const meta = CATEGORIES[b.category];
                  return (
                    <div key={b.category}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs">{meta.icon}</span>
                        <span className="text-xs font-semibold text-white/70 flex-1 truncate">{meta.label}</span>
                        <span className="text-[10px] font-mono tabular-nums">
                          <span className={
                            b.status === "over" ? "text-red-400" :
                            b.status === "ahead" ? "text-amber-400" :
                            b.status === "behind" ? "text-teal-400" : "text-white/60"
                          }>
                            {fmt(b.spent)}
                          </span>
                          <span className="text-[#5a6380]"> / {fmt(b.budget)}</span>
                        </span>
                      </div>
                      <div className="relative h-1.5 rounded-full overflow-hidden bg-white/5">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            b.status === "over"
                              ? "bg-red-500/70"
                              : b.status === "ahead"
                                ? "bg-amber-500/70"
                                : b.status === "behind"
                                  ? "bg-teal-500/50"
                                  : "bg-purple-500/60"
                          }`}
                          style={{ width: `${Math.min(b.pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Missing recurring */}
          {missingRecurring.length > 0 && (
            <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.09s" }}>
              <div className="flex items-center gap-2 mb-4">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
                  <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
                </svg>
                <h2 className="text-sm font-bold text-white">Missing recurring</h2>
                <span className="text-[10px] bg-amber-500/20 text-amber-400 font-bold rounded-full px-2 py-0.5">{missingRecurring.length}</span>
              </div>
              <div className="space-y-2">
                {missingRecurring.map((item, i) => {
                  const meta = CATEGORIES[item.CATEGORY];
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs">{meta.icon}</span>
                      <span className="text-xs text-white/80 flex-1 truncate">{item.NAME}</span>
                      <span className="text-xs font-mono text-white/50 tabular-nums">{fmt(item.AMOUNT)} €</span>
                    </div>
                  );
                })}
              </div>
              <Link
                href={`/?month=${thisMonth}`}
                className="block mt-4 text-center text-xs font-semibold text-teal-400 hover:text-teal-300 transition-colors"
              >
                Open this month →
              </Link>
            </div>
          )}

          {/* Category comparison */}
          <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.11s" }}>
            <h2 className="text-sm font-bold text-white mb-4">Categories (this month)</h2>
            {categories.length === 0 ? (
              <p className="text-xs text-[#5a6380]">No expenses this month</p>
            ) : (
              <div className="space-y-2.5">
                {categories.map(({ CATEGORY, TOTAL }) => {
                  const meta = CATEGORIES[CATEGORY];
                  const prevCat = prevCatMap.get(CATEGORY) ?? 0;
                  const diff = prevCat > 0 ? ((TOTAL - prevCat) / prevCat) * 100 : 0;
                  return (
                    <div key={CATEGORY} className="flex items-center gap-2">
                      <span className="text-xs">{meta.icon}</span>
                      <span className={`text-xs font-semibold ${"text-white/70"} w-20 shrink-0`}>{meta.label}</span>
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/5">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-purple-500/50 to-pink-500/50"
                          style={{ width: `${thisTotal > 0 ? (TOTAL / thisTotal) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-white/60 tabular-nums shrink-0 w-16 text-right">{fmt(TOTAL)}</span>
                      {Math.abs(diff) > 3 && (
                        <span className={`text-[9px] font-bold w-10 text-right shrink-0 ${diff > 0 ? "text-red-400/50" : "text-teal-400/50"}`}>
                          {diff > 0 ? "+" : ""}{diff.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.13s" }}>
            <h2 className="text-sm font-bold text-white mb-4">Recently added</h2>
            <div className="space-y-2.5">
              {recentExpenses.map((item, i) => {
                const meta = CATEGORIES[item.CATEGORY];
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-white/80 truncate block">{item.NAME}</span>
                      <span className="text-[9px] text-[#5a6380]">{item.MONTH}</span>
                    </div>
                    <span className="text-xs font-mono text-white/60 tabular-nums shrink-0">{fmt(item.AMOUNT)} €</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Heatmap */}
        {heatmapData.length > 0 && (
          <div className="animate-fade-up" style={{ animationDelay: "0.15s" }}>
            <SpendingHeatmap data={heatmapData} />
          </div>
        )}

        {/* Quick links */}
        <div className="grid grid-cols-3 gap-3 animate-fade-up" style={{ animationDelay: "0.17s" }}>
          <Link href={`/?month=${thisMonth}`} className="card rounded-2xl p-4 text-center card-hover">
            <span className="text-2xl block mb-1">📝</span>
            <span className="text-xs font-semibold text-[#9ca3c0]">This month</span>
          </Link>
          <Link href={`/?month=${prevMonth}`} className="card rounded-2xl p-4 text-center card-hover">
            <span className="text-2xl block mb-1">📅</span>
            <span className="text-xs font-semibold text-[#9ca3c0]">Last month</span>
          </Link>
          <Link href="/analytics" className="card rounded-2xl p-4 text-center card-hover">
            <span className="text-2xl block mb-1">📊</span>
            <span className="text-xs font-semibold text-[#9ca3c0]">Analytics</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
