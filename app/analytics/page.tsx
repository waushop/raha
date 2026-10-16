import { connection } from "next/server";
import db from "@/lib/db";
import { currentContext } from "@/lib/auth";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES } from "@/types/expense";
import Link from "next/link";
import Stats from "@/components/Stats";
import { getBudgets, getBudgetHistory, resolveBudgetsFor } from "@/lib/budgets";
import { monthlyTotals as monthlyTotalsQuery, type MonthTotal } from "@/lib/queries";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtShort = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);

type CatMonth = { CATEGORY: CategoryKey; MONTH: string; TOTAL: number };

export default async function AnalyticsPage() {
  await connection();
  const { workspaceId: ws } = await currentContext();
  // Last 12 months of data
  const now = new Date();
  const endMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const startMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}`;

  // Monthly totals
  const monthlyTotals = await monthlyTotalsQuery(ws, "expense", startMonth, endMonth);

  // Category per month
  const [catMonthRows] = await db.execute(
    `SELECT CATEGORY, MONTH, CAST(SUM(AMOUNT) AS REAL) AS TOTAL
     FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?
     GROUP BY CATEGORY, MONTH ORDER BY CATEGORY, MONTH`,
    [ws, startMonth, endMonth]
  );
  const catMonthData = catMonthRows as CatMonth[];

  // Category totals (12 months)
  const [catTotalRows] = await db.execute(
    `SELECT CATEGORY, CAST(SUM(AMOUNT) AS REAL) AS TOTAL, COUNT(*) AS CNT
     FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?
     GROUP BY CATEGORY ORDER BY TOTAL DESC`,
    [ws, startMonth, endMonth]
  );
  const categoryTotals = catTotalRows as { CATEGORY: CategoryKey; TOTAL: number; CNT: number }[];

  // Top 10 most expensive individual items
  const [topItems] = await db.execute(
    `SELECT ID, NAME, CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH
     FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?
     ORDER BY AMOUNT DESC LIMIT 10`,
    [ws, startMonth, endMonth]
  );
  const topExpenses = topItems as { ID: string; NAME: string; CATEGORY: CategoryKey; AMOUNT: number; MONTH: string }[];

  // Recurring expenses summary
  const [recurringRows] = await db.execute(
    `SELECT NAME, CATEGORY, CAST(AVG(AMOUNT) AS REAL) AS AVG_AMOUNT,
            COUNT(DISTINCT MONTH) AS MONTHS, CAST(SUM(AMOUNT) AS REAL) AS TOTAL
     FROM LEDGER WHERE WORKSPACE_ID = ? AND IS_RECURRING = 1 AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?
     GROUP BY NAME, CATEGORY ORDER BY TOTAL DESC LIMIT 15`,
    [ws, startMonth, endMonth]
  );
  const recurringExpenses = recurringRows as { NAME: string; CATEGORY: CategoryKey; AVG_AMOUNT: number; MONTHS: number; TOTAL: number }[];

  // Income per month (12 months) → savings rate
  const monthlyIncome = await monthlyTotalsQuery(ws, "income", startMonth, endMonth);
  const incomeTotal = monthlyIncome.reduce((s, m) => s + m.TOTAL, 0);

  // Tags (12 months, expenses)
  const [tagRows] = await db.execute(
    `SELECT t.TAG, COUNT(*) AS CNT, CAST(SUM(e.AMOUNT) AS REAL) AS TOTAL
     FROM LEDGER_TAG t JOIN LEDGER e ON e.ID = t.LEDGER_ID
     WHERE e.WORKSPACE_ID = ? AND e.KIND = 'expense' AND e.DELETED_AT IS NULL AND e.MONTH >= ? AND e.MONTH <= ?
     GROUP BY t.TAG ORDER BY TOTAL DESC LIMIT 12`,
    [ws, startMonth, endMonth]
  );
  const tagTotals = tagRows as { TAG: string; CNT: number; TOTAL: number }[];

  const grandTotal = monthlyTotals.reduce((s, m) => s + m.TOTAL, 0);
  const saved = incomeTotal - grandTotal;
  const savingsRate = incomeTotal > 0 ? (saved / incomeTotal) * 100 : null;
  const avgMonthly = monthlyTotals.length > 0 ? grandTotal / monthlyTotals.length : 0;
  const maxMonth = monthlyTotals.reduce((max, m) => m.TOTAL > max.TOTAL ? m : max, { MONTH: "", TOTAL: 0 });
  const minMonth = monthlyTotals.reduce((min, m) => m.TOTAL < min.TOTAL ? m : min, monthlyTotals[0] ?? { MONTH: "", TOTAL: Infinity });

  // Build category sparklines
  const allMonths: string[] = [];
  let d = new Date(startDate);
  while (d <= now) {
    allMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }

  // Budget vs actual per month, using the budget that was in force then.
  const [currentBudgets, budgetHistory] = await Promise.all([getBudgets(ws), getBudgetHistory(ws)]);
  const budgetByMonth = new Map(allMonths.map((m) => [m, resolveBudgetsFor(m, budgetHistory, currentBudgets)]));
  const spentByMonth = new Map(monthlyTotals.map((m) => [m.MONTH, m.TOTAL]));
  const budgetedCategories = [...new Set(allMonths.flatMap((m) => Object.keys(budgetByMonth.get(m)!.categories)))] as CategoryKey[];
  const adherence = (budget: number, spent: number): "none" | "ok" | "near" | "over" =>
    budget <= 0 ? "none" : spent <= budget ? "ok" : spent <= budget * 1.2 ? "near" : "over";
  const cellClass = { none: "bg-white/[0.03]", ok: "bg-teal-500/50", near: "bg-amber-500/60", over: "bg-red-500/60" } as const;
  const totalCells = allMonths.map((m) => ({ month: m, budget: budgetByMonth.get(m)!.total, spent: spentByMonth.get(m) ?? 0 }));
  const monthsWithData = totalCells.filter((c) => c.spent > 0);
  const totalWithin = monthsWithData.filter((c) => adherence(c.budget, c.spent) === "ok").length;

  // All-time stats
  const [allTimeRows] = await db.execute(
    "SELECT COUNT(*) AS CNT, CAST(SUM(AMOUNT) AS REAL) AS TOTAL, COUNT(DISTINCT MONTH) AS MONTHS FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL", [ws]
  );
  const allTime = (allTimeRows as Array<{ CNT: number; TOTAL: number | null; MONTHS: number }>)[0];
  const allTimeTotal = allTime?.TOTAL ?? 0;
  const allTimeCount = allTime?.CNT ?? 0;
  const allTimeMonths = allTime?.MONTHS ?? 0;
  const avgPerExpense = allTimeCount > 0 ? allTimeTotal / allTimeCount : 0;

  // Max/min over every month, not just the 12 shown above.
  const allMonthTotals: MonthTotal[] = await monthlyTotalsQuery(ws, "expense");
  const mostExpensive = allMonthTotals.length > 0 ? allMonthTotals.reduce((max, m) => m.TOTAL > max.TOTAL ? m : max) : null;
  const cheapest = allMonthTotals.length > 0 ? allMonthTotals.reduce((min, m) => m.TOTAL < min.TOTAL ? m : min) : null;

  function shortMonth(month: string): string {
    const [, m] = month.split("-").map(Number);
    return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];
  }

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-28 lg:pb-20">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <div className="flex items-center justify-between">
            <div>
              <Link href="/" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
              <h1
                className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1"
                style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}
              >
                Analytics
              </h1>
              <p className="text-[10px] text-[#5a6380] mt-1">Last 12 months</p>
            </div>
            <a
              href={`/api/export?year=${now.getFullYear()}`}
              className="px-4 py-2 rounded-xl border border-white/10 text-[#9ca3c0] text-xs font-medium hover:bg-white/5 hover:text-white transition-all btn-press inline-flex items-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
            </a>
          </div>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">12-mo total</p>
            <p className="text-lg font-bold text-white font-mono tabular-nums">{fmt(grandTotal)} €</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Monthly avg</p>
            <p className="text-lg font-bold text-white font-mono tabular-nums">{fmt(avgMonthly)} €</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Highest month</p>
            <p className="text-lg font-bold text-red-400 font-mono tabular-nums">{fmtShort(maxMonth.TOTAL)} €</p>
            <p className="text-[9px] text-[#5a6380] capitalize">{maxMonth.MONTH && shortMonth(maxMonth.MONTH)}</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Lowest month</p>
            <p className="text-lg font-bold text-teal-400 font-mono tabular-nums">{fmtShort(minMonth?.TOTAL ?? 0)} €</p>
            <p className="text-[9px] text-[#5a6380] capitalize">{minMonth?.MONTH && shortMonth(minMonth.MONTH)}</p>
          </div>
        </div>

        {/* Income + savings (only when income is tracked) */}
        {incomeTotal > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 animate-fade-up" style={{ animationDelay: "0.06s" }}>
            <div className="card rounded-2xl p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">12-mo income</p>
              <p className="text-lg font-bold text-teal-400 font-mono tabular-nums whitespace-nowrap">{fmt(incomeTotal)} €</p>
            </div>
            <div className="card rounded-2xl p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Saved</p>
              <p className={`text-lg font-bold font-mono tabular-nums whitespace-nowrap ${saved >= 0 ? "text-teal-400" : "text-red-400"}`}>{saved >= 0 ? "+" : ""}{fmt(saved)} €</p>
            </div>
            <div className="card rounded-2xl p-4 col-span-2 sm:col-span-1">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Savings rate</p>
              <p className={`text-lg font-bold font-mono tabular-nums ${(savingsRate ?? 0) >= 0 ? "text-teal-400" : "text-red-400"}`}>{savingsRate?.toFixed(0)}%</p>
              <p className="text-[9px] text-[#5a6380]">of income kept</p>
            </div>
          </div>
        )}

        {/* Monthly trend bar chart */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.08s" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white">Monthly overview</h2>
            {incomeTotal > 0 && (
              <span className="flex items-center gap-3 text-[9px] text-[#5a6380]">
                <span className="inline-flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-pink-500/60" /> spent</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-1.5 rounded-full bg-teal-500/50" /> income</span>
              </span>
            )}
          </div>
          <div className="grid gap-2">
            {allMonths.map((m) => {
              const total = monthlyTotals.find(r => r.MONTH === m)?.TOTAL ?? 0;
              const income = monthlyIncome.find(r => r.MONTH === m)?.TOTAL ?? 0;
              const scale = Math.max(maxMonth.TOTAL, ...monthlyIncome.map((r) => r.TOTAL), 1);
              const pct = (total / scale) * 100;
              const incomePct = (income / scale) * 100;
              return (
                <div key={m} className="flex items-center gap-3">
                  <span className="text-[10px] text-[#9ca3c0] font-medium w-8 shrink-0 capitalize">{shortMonth(m)}</span>
                  <div className="flex-1 space-y-0.5">
                    <div className="h-5 rounded-lg overflow-hidden bg-white/5 relative">
                      <div
                        className="h-full rounded-lg bg-gradient-to-r from-purple-500/60 to-pink-500/60 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                      {total > 0 && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono text-white/50 tabular-nums">{fmtShort(total)}</span>
                      )}
                    </div>
                    {incomeTotal > 0 && (
                      <div className="h-1.5 rounded-full overflow-hidden bg-white/[0.03]">
                        <div className="h-full rounded-full bg-teal-500/50" style={{ width: `${incomePct}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Budget vs actual */}
        {monthsWithData.length > 0 && (currentBudgets.total > 0 || budgetedCategories.length > 0) && (
          <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.09s" }}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-bold text-white">Budget vs actual</h2>
              <span className="text-[10px] text-[#5a6380]">{totalWithin}/{monthsWithData.length} months within total budget</span>
            </div>
            <p className="text-[10px] text-[#5a6380] mb-4">Each cell compares a month&rsquo;s spending with the budget that applied then. Edit budgets in Settings.</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white w-28 shrink-0 truncate">Total</span>
                <div className="flex-1 grid grid-cols-12 gap-1">
                  {totalCells.map((c) => (
                    <div key={c.month} title={`${shortMonth(c.month)}: ${fmt(c.spent)} / ${fmt(c.budget)} €`}
                      className={`h-5 rounded ${c.spent > 0 ? cellClass[adherence(c.budget, c.spent)] : "bg-white/[0.03]"}`} />
                  ))}
                </div>
              </div>
              {budgetedCategories.map((cat) => {
                const meta = CATEGORIES[cat];
                return (
                  <div key={cat} className="flex items-center gap-2">
                    <span className="text-xs text-white/70 w-28 shrink-0 truncate inline-flex items-center gap-1.5"><span>{meta.icon}</span>{meta.label}</span>
                    <div className="flex-1 grid grid-cols-12 gap-1">
                      {allMonths.map((m) => {
                        const budget = budgetByMonth.get(m)!.categories[cat] ?? 0;
                        const spent = catMonthData.find((r) => r.CATEGORY === cat && r.MONTH === m)?.TOTAL ?? 0;
                        return (
                          <div key={m} title={`${shortMonth(m)}: ${fmt(spent)} / ${fmt(budget)} €`}
                            className={`h-4 rounded ${spent > 0 ? cellClass[adherence(budget, spent)] : "bg-white/[0.03]"}`} />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3 mt-3 justify-end text-[9px] text-[#5a6380]">
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-teal-500/50" /> within</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/60" /> up to 20% over</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/60" /> over</span>
            </div>
          </div>
        )}

        {/* Category breakdown with sparklines */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.1s" }}>
          <h2 className="text-sm font-bold text-white mb-4">Categories (12 months)</h2>
          <div className="space-y-4">
            {categoryTotals.map(({ CATEGORY, TOTAL, CNT }) => {
              const meta = CATEGORIES[CATEGORY];
              const pct = grandTotal > 0 ? (TOTAL / grandTotal) * 100 : 0;
              const avg = monthlyTotals.length > 0 ? TOTAL / monthlyTotals.length : 0;

              // Mini sparkline data
              const catData = allMonths.map(m => {
                const found = catMonthData.find(r => r.CATEGORY === CATEGORY && r.MONTH === m);
                return found?.TOTAL ?? 0;
              });
              const catMax = Math.max(...catData, 1);

              return (
                <div key={CATEGORY}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="inline-flex items-center gap-2">
                      <span className="text-sm">{meta.icon}</span>
                      <span className={`text-xs font-bold ${"text-white/70"}`}>{meta.label}</span>
                      <span className="hidden sm:inline text-[9px] text-[#5a6380]">{CNT} expenses</span>
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-[#5a6380] font-mono tabular-nums">~{fmtShort(avg)}/mo</span>
                      <span className="text-xs font-mono font-semibold text-white/60 tabular-nums whitespace-nowrap">{fmt(TOTAL)} €</span>
                      <span className="text-[10px] text-[#5a6380] tabular-nums">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  {/* Mini sparkline */}
                  <div className="flex items-end gap-px h-6">
                    {catData.map((val, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-sm bg-gradient-to-t from-purple-500/40 to-pink-500/40 transition-all duration-300"
                        style={{ height: `${catMax > 0 ? (val / catMax) * 100 : 0}%`, minHeight: val > 0 ? 2 : 0 }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Top 10 expenses */}
          <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.12s" }}>
            <h2 className="text-sm font-bold text-white mb-4">Top 10 largest</h2>
            <div className="space-y-2">
              {topExpenses.map((item, i) => {
                const meta = CATEGORIES[item.CATEGORY];
                return (
                  <Link key={item.ID} href={`/?month=${item.MONTH}#e-${item.ID}`} className="flex items-center gap-2 rounded-lg -mx-1 px-1 hover:bg-white/5 transition-colors">
                    <span className="text-[10px] font-bold text-[#5a6380] w-4 text-right">{i + 1}</span>
                    <span className="text-xs">{meta.icon}</span>
                    <span className="text-xs text-white/80 truncate flex-1">{item.NAME}</span>
                    <span className="text-[9px] text-[#5a6380] shrink-0">{item.MONTH}</span>
                    <span className="text-xs font-mono text-white/60 tabular-nums shrink-0">{fmt(item.AMOUNT)} €</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Recurring expenses */}
          <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.14s" }}>
            <h2 className="text-sm font-bold text-white mb-4">Recurring expenses</h2>
            {recurringExpenses.length === 0 ? (
              <p className="text-xs text-[#5a6380]">No recurring expenses marked</p>
            ) : (
              <div className="space-y-2">
                {recurringExpenses.map((item, i) => {
                  const meta = CATEGORIES[item.CATEGORY];
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs">{meta.icon}</span>
                      <span className="text-xs text-white/80 truncate flex-1">{item.NAME}</span>
                      <span className="text-[10px] text-[#5a6380] tabular-nums shrink-0">{item.MONTHS}x</span>
                      <span className="text-xs font-mono text-teal-400/70 tabular-nums shrink-0">~{fmt(item.AVG_AMOUNT)} €</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Tags */}
        {tagTotals.length > 0 && (
          <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.15s" }}>
            <h2 className="text-sm font-bold text-white mb-4">Tags (12 months)</h2>
            <div className="space-y-2">
              {tagTotals.map((t) => {
                const pct = grandTotal > 0 ? (t.TOTAL / grandTotal) * 100 : 0;
                return (
                  <Link key={t.TAG} href={`/search?tag=${encodeURIComponent(t.TAG)}`} className="flex items-center gap-3 rounded-lg -mx-1 px-1 hover:bg-white/5 transition-colors">
                    <span className="text-xs font-semibold text-purple-300 w-28 shrink-0 truncate">#{t.TAG}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/5">
                      <div className="h-full rounded-full bg-purple-500/50" style={{ width: `${Math.min(pct * 4, 100)}%` }} />
                    </div>
                    <span className="text-[10px] text-[#5a6380] tabular-nums shrink-0">{t.CNT}×</span>
                    <span className="text-xs font-mono text-white/60 tabular-nums shrink-0 w-20 text-right">{fmt(t.TOTAL)} €</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* All-time stats */}
        <div className="animate-fade-up" style={{ animationDelay: "0.16s" }}>
          <Stats
            totalExpenses={allTimeCount}
            totalMonths={allTimeMonths}
            totalAmount={allTimeTotal}
            avgPerExpense={avgPerExpense}
            mostExpensiveMonth={mostExpensive ? { month: mostExpensive.MONTH, total: mostExpensive.TOTAL } : null}
            cheapestMonth={cheapest ? { month: cheapest.MONTH, total: cheapest.TOTAL } : null}
          />
        </div>
      </div>
    </main>
  );
}
