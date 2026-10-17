import { connection } from "next/server";
import db from "@/lib/db";
import { currentContext } from "@/lib/auth";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES } from "@/types/expense";
import Link from "next/link";
import CategoryIcon from "@/components/CategoryIcon";
import SaveAsImage, { type ReviewStat } from "@/components/SaveAsImage";
import { listGoals } from "@/lib/goals";
import { currentMonth } from "@/lib/months";
import { yearlyCost, type Cadence } from "@/lib/subscriptions";
import { ChartNoAxesColumn, ChartPie, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtShort = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type MonthRow = {
  MONTH: string;
  TOTAL: number;
  COUNT: number;
};

type CatRow = {
  CATEGORY: CategoryKey;
  TOTAL: number;
};

export default async function YearPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const { year: yearParam } = await searchParams;
  const year = yearParam ?? String(new Date().getFullYear());

  // Monthly totals
  const [monthRows] = await db.execute(
    `SELECT MONTH,
            CAST(SUM(AMOUNT) AS REAL) AS TOTAL,
            COUNT(*) AS COUNT
     FROM LEDGER
     WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?
     GROUP BY MONTH ORDER BY MONTH`,
    [ws, `${year}-01`, `${year}-12`]
  );
  const months = monthRows as MonthRow[];

  // Category totals for the year
  const [catRows] = await db.execute(
    `SELECT CATEGORY, CAST(SUM(AMOUNT) AS REAL) AS TOTAL
     FROM LEDGER
     WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?
     GROUP BY CATEGORY ORDER BY TOTAL DESC`,
    [ws, `${year}-01`, `${year}-12`]
  );
  const categories = catRows as CatRow[];

  // Income per month → net + savings rate for the year
  const [incomeRows] = await db.execute(
    `SELECT MONTH, CAST(SUM(AMOUNT) AS REAL) AS TOTAL FROM LEDGER
     WHERE WORKSPACE_ID = ? AND KIND = 'income' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ? GROUP BY MONTH`,
    [ws, `${year}-01`, `${year}-12`]
  );
  const incomeByMonth = new Map((incomeRows as { MONTH: string; TOTAL: number }[]).map((r) => [r.MONTH, r.TOTAL]));
  const yearIncome = [...incomeByMonth.values()].reduce((s, v) => s + v, 0);
  const hasIncome = yearIncome > 0;

  const yearTotal = months.reduce((s, m) => s + m.TOTAL, 0);
  const yearNet = yearIncome - yearTotal;
  const savingsRate = hasIncome ? (yearNet / yearIncome) * 100 : null;
  const avgMonth = months.length > 0 ? yearTotal / months.length : 0;
  const maxMonth = Math.max(...months.map(m => m.TOTAL), 0);

  // Year in review
  const [merchantRows] = await db.execute(
    `SELECT NAME, COUNT(*) AS N, CAST(SUM(AMOUNT) AS REAL) AS TOTAL FROM LEDGER
     WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?
     GROUP BY NAME ORDER BY N DESC, TOTAL DESC LIMIT 1`,
    [ws, `${year}-01`, `${year}-12`]
  );
  const topMerchant = (merchantRows as { NAME: string; N: number; TOTAL: number }[])[0] ?? null;
  const [biggestRows] = await db.execute(
    `SELECT NAME, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH FROM LEDGER
     WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?
     ORDER BY AMOUNT DESC, CREATED_AT LIMIT 1`,
    [ws, `${year}-01`, `${year}-12`]
  );
  const biggestExpense = (biggestRows as { NAME: string; AMOUNT: number; MONTH: string }[])[0] ?? null;
  const [subRows] = await db.execute(
    `SELECT CAST(AMOUNT AS REAL) AS AMOUNT, CADENCE, STATUS, substr(CREATED_AT, 1, 4) AS CREATED_YEAR, substr(STATUS_CHANGED_AT, 1, 4) AS CHANGED_YEAR
     FROM SUBSCRIPTION WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL`,
    [ws]
  );
  const subs = subRows as { AMOUNT: number; CADENCE: Cadence; STATUS: string; CREATED_YEAR: string; CHANGED_YEAR: string | null }[];
  const subsAdded = subs.filter((s) => s.CREATED_YEAR === year).length;
  const subsCancelled = subs.filter((s) => s.STATUS === "cancelled" && s.CHANGED_YEAR === year);
  const savedByCancelling = subsCancelled.reduce((s, r) => s + yearlyCost(r.AMOUNT, r.CADENCE), 0);
  const goalsReached = (await listGoals(ws)).filter((g) => g.status === "done");
  const sortedMonths = [...months].sort((a, b) => b.TOTAL - a.TOTAL);
  const biggestMonth = sortedMonths[0] ?? null;
  // The month still in progress is not "cheapest" just because it is unfinished.
  const finished = sortedMonths.filter((m) => m.MONTH !== currentMonth());
  const cheapestMonth = finished.length > 1 ? finished[finished.length - 1] : null;
  const monthName = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];
  const reviewStats: ReviewStat[] = [];
  if (biggestMonth) reviewStats.push({ label: "Biggest month", value: monthName(biggestMonth.MONTH), sub: `${fmt(biggestMonth.TOTAL)} € spent` });
  if (cheapestMonth) reviewStats.push({ label: "Cheapest month", value: monthName(cheapestMonth.MONTH), sub: `${fmt(cheapestMonth.TOTAL)} € spent` });
  if (topMerchant) reviewStats.push({ label: "Most frequent", value: topMerchant.NAME, sub: `${topMerchant.N} times · ${fmt(topMerchant.TOTAL)} €` });
  if (biggestExpense) reviewStats.push({ label: "Biggest expense", value: `${fmt(biggestExpense.AMOUNT)} €`, sub: `${biggestExpense.NAME} · ${monthName(biggestExpense.MONTH)}` });
  if (subsAdded > 0 || subsCancelled.length > 0) reviewStats.push({ label: "Subscriptions", value: `+${subsAdded} / −${subsCancelled.length}`, sub: "added / cancelled" });
  if (savedByCancelling > 0) reviewStats.push({ label: "Saved by cancelling", value: `${fmt(savedByCancelling)} €`, sub: "a year, from cancelled subscriptions" });
  if (goalsReached.length > 0) reviewStats.push({ label: "Goals reached", value: String(goalsReached.length), sub: goalsReached.map((g) => g.NAME).join(", ") });
  if (savingsRate !== null) reviewStats.push({ label: "Savings rate", value: `${savingsRate.toFixed(0)}%`, sub: `${yearNet >= 0 ? "+" : ""}${fmt(yearNet)} € of ${fmt(yearIncome)} € income` });

  const prevYear = String(Number(year) - 1);
  const nextYear = String(Number(year) + 1);

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 flex items-center justify-between animate-fade-up">
          <div>
            <Link href="/" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">
              ← Back
            </Link>
            <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
              Year overview
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/year?year=${prevYear}`}
              className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-pink-500/30 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press"
            >
              <ChevronLeft size={14} />
            </Link>
            <span className="font-bold text-lg text-white w-16 text-center tabular-nums">{year}</span>
            <Link
              href={`/year?year=${nextYear}`}
              className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-pink-500/30 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press"
            >
              <ChevronRight size={14} />
            </Link>
          </div>
        </div>

        {/* Year stats */}
        <div className={`grid grid-cols-2 ${hasIncome ? "sm:grid-cols-4" : ""} gap-3 animate-fade-up`} style={{ animationDelay: "0.05s" }}>
          <div className="card rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Year total</p>
            <p className="text-lg font-bold text-white font-mono tabular-nums">{fmt(yearTotal)} €</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Monthly avg</p>
            <p className="text-lg font-bold text-white font-mono tabular-nums">{fmt(avgMonth)} €</p>
          </div>
          {hasIncome && (
            <>
              <div className="card rounded-2xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Income</p>
                <p className="text-lg font-bold text-teal-400 font-mono tabular-nums">{fmt(yearIncome)} €</p>
              </div>
              <div className="card rounded-2xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Saved</p>
                <p className={`text-lg font-bold font-mono tabular-nums ${yearNet >= 0 ? "text-teal-400" : "text-red-400"}`}>{yearNet >= 0 ? "+" : ""}{fmt(yearNet)} €</p>
                <p className="text-[9px] text-[#5a6380]">{savingsRate?.toFixed(0)}% savings rate</p>
              </div>
            </>
          )}
        </div>

        {/* Year in review */}
        {reviewStats.length > 0 && (
          <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.07s" }}>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center shadow-lg shadow-pink-500/20">
                <Sparkles size={12} strokeWidth={2.5} className="text-white" />
              </span>
              <h2 className="text-sm font-bold text-white">Year in review</h2>
              <div className="ml-auto">
                <SaveAsImage year={year} stats={reviewStats} footer={`${fmt(yearTotal)} € spent across ${months.length} month${months.length === 1 ? "" : "s"}`} />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {reviewStats.map((s) => (
                <div key={s.label} className="surface rounded-xl p-3 min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">{s.label}</p>
                  <p className="text-base sm:text-lg font-bold text-white font-mono tabular-nums truncate" title={s.value}>{s.value}</p>
                  {s.sub && <p className="text-[10px] text-[#9ca3c0] truncate" title={s.sub}>{s.sub}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Monthly bar chart */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.08s" }}>
          <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <ChartNoAxesColumn size={12} strokeWidth={2.5} className="text-white" />
            </span>
            Months
          </h2>
          <div className="grid grid-cols-12 gap-1.5 sm:gap-2 items-end" style={{ height: 160 }}>
            {Array.from({ length: 12 }, (_, i) => {
              const m = `${year}-${String(i + 1).padStart(2, "0")}`;
              const monthData = months.find(r => r.MONTH === m);
              const total = monthData?.TOTAL ?? 0;
              const barH = maxMonth > 0 ? (total / maxMonth) * 100 : 0;
              const hasData = total > 0;

              return (
                <Link
                  key={i}
                  href={`/?month=${m}`}
                  className="flex flex-col items-center justify-end h-full group"
                >
                  {hasData && (
                    <span className="text-[8px] sm:text-[9px] font-mono text-[#5a6380] group-hover:text-white transition-colors mb-1 tabular-nums">
                      {fmtShort(total)}
                    </span>
                  )}
                  <div
                    className={`w-full rounded-t-md transition-all duration-300 ${
                      hasData
                        ? "bg-gradient-to-t from-purple-600 to-pink-500 group-hover:from-purple-500 group-hover:to-pink-400"
                        : "bg-white/5"
                    }`}
                    style={{ height: `${Math.max(barH, 3)}%`, minHeight: 4 }}
                  />
                  <span className={`text-[9px] sm:text-[10px] mt-1.5 font-medium ${hasData ? "text-[#9ca3c0]" : "text-[#5a6380]/50"}`}>
                    {MONTH_NAMES[i]}
                  </span>
                </Link>
              );
            })}
          </div>
          {/* Average line label */}
          {avgMonth > 0 && maxMonth > 0 && (
            <div className="relative mt-2">
              <div
                className="absolute w-full border-t border-dashed border-teal-500/20"
                style={{ bottom: `${(avgMonth / maxMonth) * 100}%` }}
              />
            </div>
          )}
        </div>

        {/* Category breakdown for the year */}
        {categories.length > 0 && (
          <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.1s" }}>
            <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <ChartPie size={12} strokeWidth={2.5} className="text-white" />
              </span>
              Categories ({year})
            </h2>
            <div className="space-y-2.5">
              {categories.map(({ CATEGORY, TOTAL }) => {
                const meta = CATEGORIES[CATEGORY];
                const pct = yearTotal > 0 ? (TOTAL / yearTotal) * 100 : 0;
                return (
                  <div key={CATEGORY} className="flex items-center gap-3">
                    <CategoryIcon category={CATEGORY} size={16} className="text-[#9ca3c0]" />
                    <span className={`text-xs font-semibold ${"text-white/70"} w-24 shrink-0`}>{meta.label}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-white/60 w-20 text-right tabular-nums shrink-0">{fmt(TOTAL)} €</span>
                    <span className="text-[10px] font-mono text-[#5a6380] w-10 text-right tabular-nums shrink-0">{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Monthly detail table */}
        <div className="card rounded-2xl overflow-hidden animate-fade-up" style={{ animationDelay: "0.12s" }}>
          <div className="px-5 py-4 border-b border-white/[0.06]">
            <h2 className="text-sm font-bold text-white">Monthly detail</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Month</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Total</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Expenses</th>
                  {hasIncome && <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Income</th>}
                  {hasIncome && <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Net</th>}
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const mi = parseInt(m.MONTH.split("-")[1]) - 1;
                  return (
                    <tr key={m.MONTH} className="border-b border-white/[0.03] row-hover">
                      <td className="px-5 py-2.5">
                        <Link href={`/?month=${m.MONTH}`} className="text-white/80 hover:text-pink-400 transition-colors font-medium">
                          {MONTH_NAMES[mi]}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap font-mono font-semibold text-white/80 tabular-nums">{fmt(m.TOTAL)} €</td>
                      <td className="px-4 py-2.5 text-right text-[#9ca3c0] tabular-nums">{m.COUNT}</td>
                      {hasIncome && <td className="px-4 py-2.5 text-right whitespace-nowrap font-mono text-teal-400/80 tabular-nums">{fmt(incomeByMonth.get(m.MONTH) ?? 0)} €</td>}
                      {hasIncome && (() => { const net = (incomeByMonth.get(m.MONTH) ?? 0) - m.TOTAL; return (
                        <td className={`px-4 py-2.5 text-right whitespace-nowrap font-mono tabular-nums ${net >= 0 ? "text-teal-400/80" : "text-red-400/80"}`}>{net >= 0 ? "+" : ""}{fmt(net)} €</td>
                      ); })()}
                    </tr>
                  );
                })}
              </tbody>
              {months.length > 0 && (
                <tfoot>
                  <tr className="border-t border-white/10 font-semibold">
                    <td className="px-5 py-3 text-[#9ca3c0] text-xs uppercase tracking-wider">Total</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-mono text-white tabular-nums">{fmt(yearTotal)} €</td>
                    <td className="px-4 py-3 text-right text-[#9ca3c0] tabular-nums">{months.reduce((s, m) => s + m.COUNT, 0)}</td>
                    {hasIncome && <td className="px-4 py-3 text-right whitespace-nowrap font-mono text-teal-400 tabular-nums">{fmt(yearIncome)} €</td>}
                    {hasIncome && <td className={`px-4 py-3 text-right whitespace-nowrap font-mono tabular-nums ${yearNet >= 0 ? "text-teal-400" : "text-red-400"}`}>{yearNet >= 0 ? "+" : ""}{fmt(yearNet)} €</td>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {months.length === 0 && (
          <div className="card rounded-2xl p-12 text-center">
            <p className="text-sm text-[#5a6380]">No data for {year}</p>
          </div>
        )}

        <footer className="text-center pt-4 pb-2">
          <Link href="/" className="text-[10px] text-[#5a6380]/50 hover:text-pink-400/50 transition-colors tracking-wider font-medium">
            ← Back to month view
          </Link>
        </footer>
      </div>
    </main>
  );
}
