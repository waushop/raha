import { connection } from "next/server";
import Link from "next/link";
import db from "@/lib/db";
import { currentContext } from "@/lib/auth";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES } from "@/types/expense";
import { addMonths, currentMonth, isValidMonth, monthLabel, daysInMonth } from "@/lib/months";
import { getBudgets, getBudgetHistory, resolveBudgetsFor } from "@/lib/budgets";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
const Delta = ({ value, invert = false }: { value: number | null; invert?: boolean }) => {
  if (value === null || Math.abs(value) < 1) return <span className="text-[#5a6380]">about the same</span>;
  const good = invert ? value < 0 : value > 0;
  return <span className={good ? "text-teal-400" : "text-red-400"}>{value > 0 ? "+" : ""}{value.toFixed(0)}%</span>;
};

type Cat = { CATEGORY: CategoryKey; TOTAL: number };

async function sum(ws: string, kind: "expense" | "income", month: string): Promise<number> {
  const [r] = await db.execute("SELECT CAST(SUM(AMOUNT) AS REAL) AS T FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = ? AND MONTH = ? AND DELETED_AT IS NULL", [ws, kind, month]);
  return (r as Array<{ T: number | null }>)[0]?.T ?? 0;
}
async function categories(ws: string, month: string): Promise<Cat[]> {
  const [r] = await db.execute("SELECT CATEGORY, CAST(SUM(AMOUNT) AS REAL) AS TOTAL FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND MONTH = ? AND DELETED_AT IS NULL GROUP BY CATEGORY ORDER BY TOTAL DESC", [ws, month]);
  return r as Cat[];
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const { month: param } = await searchParams;
  // A review is of a finished month, so default to last month.
  const month = isValidMonth(param) ? param : addMonths(currentMonth(), -1);
  const prev = addMonths(month, -1);
  const sixStart = addMonths(month, -6);

  const [spent, income, prevSpent, prevIncome, cats, prevCats] = await Promise.all([
    sum(ws, "expense", month), sum(ws, "income", month), sum(ws, "expense", prev), sum(ws, "income", prev), categories(ws, month), categories(ws, prev),
  ]);
  const [avgRows] = await db.execute(
    "SELECT CAST(SUM(AMOUNT) / NULLIF(COUNT(DISTINCT MONTH), 0) AS REAL) AS A FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND MONTH >= ? AND MONTH < ?",
    [ws, sixStart, month],
  );
  const avg6 = (avgRows as Array<{ A: number | null }>)[0]?.A ?? 0;
  const net = income - spent;
  const savingsRate = income > 0 ? (net / income) * 100 : null;

  // Budget as it stood that month
  const [current, history] = await Promise.all([getBudgets(ws), getBudgetHistory(ws)]);
  const budget = resolveBudgetsFor(month, history, current);
  const overCats = cats
    .map((c) => ({ ...c, budget: budget.categories[c.CATEGORY] ?? 0 }))
    .filter((c) => c.budget > 0 && c.TOTAL > c.budget)
    .sort((a, b) => b.TOTAL / b.budget - a.TOTAL / a.budget);
  const budgetedCount = cats.filter((c) => (budget.categories[c.CATEGORY] ?? 0) > 0).length;

  // Largest expenses, new names, busiest day, tags, goals, recurring changes
  const [bigRows] = await db.execute(
    "SELECT ID, NAME, CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND MONTH = ? AND DELETED_AT IS NULL ORDER BY AMOUNT DESC LIMIT 5", [ws, month]);
  const biggest = bigRows as Array<{ ID: string; NAME: string; CATEGORY: CategoryKey; AMOUNT: number }>;
  const [newRows] = await db.execute(
    `SELECT NAME, CATEGORY, CAST(SUM(AMOUNT) AS REAL) AS AMOUNT FROM LEDGER e
     WHERE e.WORKSPACE_ID = ? AND KIND = 'expense' AND MONTH = ? AND DELETED_AT IS NULL
       AND NOT EXISTS (SELECT 1 FROM LEDGER p WHERE p.WORKSPACE_ID = ? AND p.NAME = e.NAME AND p.DELETED_AT IS NULL AND p.MONTH >= ? AND p.MONTH < ?)
     GROUP BY NAME ORDER BY AMOUNT DESC LIMIT 5`, [ws, month, ws, sixStart, month]);
  const newNames = newRows as Array<{ NAME: string; CATEGORY: CategoryKey; AMOUNT: number }>;
  const [dayRows] = await db.execute(
    "SELECT DAY, CAST(SUM(AMOUNT) AS REAL) AS TOTAL, COUNT(*) AS N FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND MONTH = ? AND DELETED_AT IS NULL AND DAY IS NOT NULL GROUP BY DAY ORDER BY TOTAL DESC LIMIT 1", [ws, month]);
  const busiest = (dayRows as Array<{ DAY: number; TOTAL: number; N: number }>)[0];
  const [tagRows] = await db.execute(
    `SELECT t.TAG, CAST(SUM(e.AMOUNT) AS REAL) AS TOTAL FROM LEDGER_TAG t JOIN LEDGER e ON e.ID = t.LEDGER_ID
     WHERE e.WORKSPACE_ID = ? AND e.KIND = 'expense' AND e.MONTH = ? AND e.DELETED_AT IS NULL GROUP BY t.TAG ORDER BY TOTAL DESC LIMIT 5`, [ws, month]);
  const tags = tagRows as Array<{ TAG: string; TOTAL: number }>;
  const [goalRows] = await db.execute(
    `SELECT g.NAME, g.EMOJI, CAST(SUM(e.AMOUNT) AS REAL) AS AMOUNT FROM LEDGER e JOIN SAVINGS_GOAL g ON g.ID = e.GOAL_ID AND g.DELETED_AT IS NULL
     WHERE e.WORKSPACE_ID = ? AND e.MONTH = ? AND e.DELETED_AT IS NULL GROUP BY g.ID ORDER BY AMOUNT DESC`, [ws, month]);
  const goalContribs = goalRows as Array<{ NAME: string; EMOJI: string | null; AMOUNT: number }>;
  const [recRows] = await db.execute(
    `SELECT a.NAME, CAST(a.AMOUNT AS REAL) AS NOW_AMOUNT, CAST(b.AMOUNT AS REAL) AS PREV_AMOUNT FROM LEDGER a
     JOIN LEDGER b ON b.WORKSPACE_ID = a.WORKSPACE_ID AND b.NAME = a.NAME AND b.MONTH = ? AND b.IS_RECURRING = 1 AND b.DELETED_AT IS NULL AND b.KIND = 'expense'
     WHERE a.WORKSPACE_ID = ? AND a.MONTH = ? AND a.IS_RECURRING = 1 AND a.DELETED_AT IS NULL AND a.KIND = 'expense' AND ABS(a.AMOUNT - b.AMOUNT) > 0.01
     GROUP BY a.NAME ORDER BY ABS(a.AMOUNT - b.AMOUNT) DESC LIMIT 5`, [prev, ws, month]);
  const priceChanges = recRows as Array<{ NAME: string; NOW_AMOUNT: number; PREV_AMOUNT: number }>;
  const [missingRows] = await db.execute(
    `SELECT NAME, CAST(AMOUNT AS REAL) AS AMOUNT FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND IS_RECURRING = 1 AND KIND = 'expense' AND DELETED_AT IS NULL
       AND NAME NOT IN (SELECT NAME FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL) GROUP BY NAME`, [ws, prev, ws, month]);
  const missing = missingRows as Array<{ NAME: string; AMOUNT: number }>;

  const prevCatMap = new Map(prevCats.map((c) => [c.CATEGORY, c.TOTAL]));
  const topCats = cats.slice(0, 5);
  const hasData = spent > 0 || income > 0;

  const card = "card rounded-2xl p-5 animate-fade-up";
  const h2 = "text-sm font-bold text-white mb-3";

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 flex items-center justify-between animate-fade-up">
          <div>
            <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
            <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
              {monthLabel(month)} in review
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/review?month=${prev}`} aria-label="Previous month" className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <Link href={`/review?month=${addMonths(month, 1)}`} aria-label="Next month" className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
          </div>
        </div>

        {!hasData ? (
          <div className="card rounded-2xl p-12 text-center"><p className="text-sm text-[#5a6380]">Nothing recorded in {monthLabel(month)}</p></div>
        ) : (
          <>
            {/* Headline */}
            <div className={card} style={{ animationDelay: "0.04s" }}>
              <p className="text-sm text-white/90 leading-relaxed">
                You spent <span className="font-mono font-bold text-pink-400 tabular-nums">{fmt(spent)} €</span>
                {prevSpent > 0 && <>, <Delta value={pct(spent, prevSpent)} invert /> compared with {monthLabel(prev, "short")}</>}
                {avg6 > 0 && <> and <Delta value={pct(spent, avg6)} invert /> against your six-month average of {fmt(avg6)} €</>}.
                {income > 0 && (
                  <> Income was <span className="font-mono font-bold text-teal-400 tabular-nums">{fmt(income)} €</span>
                    {prevIncome > 0 && <> (<Delta value={pct(income, prevIncome)} /> vs {monthLabel(prev, "short")})</>}, leaving{" "}
                    <span className={`font-mono font-bold tabular-nums ${net >= 0 ? "text-teal-400" : "text-red-400"}`}>{net >= 0 ? "+" : ""}{fmt(net)} €</span>
                    {savingsRate !== null && <>, a savings rate of <span className="font-bold">{savingsRate.toFixed(0)}%</span></>}.
                  </>
                )}
              </p>
              {budget.total > 0 && (
                <p className="text-xs text-[#9ca3c0] mt-3">
                  Total budget was {fmt(budget.total)} €: {spent <= budget.total
                    ? <span className="text-teal-400">within budget with {fmt(budget.total - spent)} € to spare</span>
                    : <span className="text-red-400">over by {fmt(spent - budget.total)} €</span>}.
                  {budgetedCount > 0 && <> {budgetedCount - overCats.length} of {budgetedCount} budgeted categories stayed within their limit.</>}
                </p>
              )}
            </div>

            {overCats.length > 0 && (
              <div className={card} style={{ animationDelay: "0.06s" }}>
                <h2 className={h2}>Over budget</h2>
                <div className="space-y-2">
                  {overCats.map((c) => {
                    const meta = CATEGORIES[c.CATEGORY];
                    return (
                      <div key={c.CATEGORY} className="flex items-center gap-2 text-xs">
                        <span>{meta.icon}</span><span className="text-white/80 flex-1">{meta.label}</span>
                        <span className="font-mono tabular-nums text-red-400">{fmt(c.TOTAL)}</span>
                        <span className="font-mono tabular-nums text-[#5a6380]">/ {fmt(c.budget)} € · {((c.TOTAL / c.budget) * 100).toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={card} style={{ animationDelay: "0.08s" }}>
                <h2 className={h2}>Where it went</h2>
                <div className="space-y-2">
                  {topCats.map((c) => {
                    const meta = CATEGORIES[c.CATEGORY];
                    const d = pct(c.TOTAL, prevCatMap.get(c.CATEGORY) ?? 0);
                    return (
                      <div key={c.CATEGORY} className="flex items-center gap-2 text-xs">
                        <span>{meta.icon}</span><span className="text-white/80 flex-1 truncate">{meta.label}</span>
                        <span className="text-[10px]"><Delta value={d} invert /></span>
                        <span className="font-mono tabular-nums text-white/60 w-20 text-right">{fmt(c.TOTAL)} €</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className={card} style={{ animationDelay: "0.1s" }}>
                <h2 className={h2}>Biggest single expenses</h2>
                <div className="space-y-2">
                  {biggest.map((b) => (
                    <Link key={b.ID} href={`/?month=${month}#e-${b.ID}`} className="flex items-center gap-2 text-xs rounded-lg -mx-1 px-1 hover:bg-white/5 transition-colors">
                      <span>{CATEGORIES[b.CATEGORY]?.icon}</span><span className="text-white/80 flex-1 truncate">{b.NAME}</span>
                      <span className="font-mono tabular-nums text-white/60">{fmt(b.AMOUNT)} €</span>
                    </Link>
                  ))}
                </div>
              </div>

              {(priceChanges.length > 0 || missing.length > 0) && (
                <div className={card} style={{ animationDelay: "0.12s" }}>
                  <h2 className={h2}>Recurring</h2>
                  <div className="space-y-2 text-xs">
                    {priceChanges.map((p) => (
                      <div key={p.NAME} className="flex items-center gap-2">
                        <span className="text-white/80 flex-1 truncate">{p.NAME}</span>
                        <span className={`font-mono tabular-nums ${p.NOW_AMOUNT > p.PREV_AMOUNT ? "text-red-400" : "text-teal-400"}`}>{fmt(p.PREV_AMOUNT)} → {fmt(p.NOW_AMOUNT)} €</span>
                      </div>
                    ))}
                    {missing.map((m) => (
                      <div key={m.NAME} className="flex items-center gap-2">
                        <span className="text-white/60 flex-1 truncate">{m.NAME}</span>
                        <span className="text-amber-400/80">not recorded this month ({fmt(m.AMOUNT)} €)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {newNames.length > 0 && (
                <div className={card} style={{ animationDelay: "0.14s" }}>
                  <h2 className={h2}>New this month</h2>
                  <p className="text-[10px] text-[#5a6380] mb-2">Not seen in the previous six months</p>
                  <div className="space-y-2">
                    {newNames.map((n) => (
                      <div key={n.NAME} className="flex items-center gap-2 text-xs">
                        <span>{CATEGORIES[n.CATEGORY]?.icon}</span><span className="text-white/80 flex-1 truncate">{n.NAME}</span>
                        <span className="font-mono tabular-nums text-white/60">{fmt(n.AMOUNT)} €</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(goalContribs.length > 0 || tags.length > 0 || busiest) && (
                <div className={card} style={{ animationDelay: "0.16s" }}>
                  <h2 className={h2}>Also</h2>
                  <div className="space-y-2 text-xs">
                    {goalContribs.map((g) => (
                      <div key={g.NAME} className="flex items-center gap-2"><span>{g.EMOJI ?? "🎯"}</span><span className="text-white/80 flex-1 truncate">{g.NAME}</span><span className="font-mono tabular-nums text-teal-400/80">+{fmt(g.AMOUNT)} €</span></div>
                    ))}
                    {busiest && (
                      <div className="flex items-center gap-2"><span>📅</span><span className="text-white/80 flex-1">Busiest day was the {busiest.DAY}{busiest.DAY === 1 ? "st" : busiest.DAY === 2 ? "nd" : busiest.DAY === 3 ? "rd" : "th"} of {daysInMonth(month)}</span><span className="font-mono tabular-nums text-white/60">{fmt(busiest.TOTAL)} €</span></div>
                    )}
                    {tags.map((t) => (
                      <div key={t.TAG} className="flex items-center gap-2"><span className="text-purple-300">#{t.TAG}</span><span className="flex-1" /><span className="font-mono tabular-nums text-white/60">{fmt(t.TOTAL)} €</span></div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <footer className="flex items-center justify-center gap-3 pt-2 text-[10px] text-[#5a6380]">
          <Link href={`/?month=${month}`} className="hover:text-pink-400 transition-colors">Open {monthLabel(month, "short")}</Link>
          <span>·</span>
          <Link href={`/compare?m1=${prev}&m2=${month}`} className="hover:text-pink-400 transition-colors">Compare with {monthLabel(prev, "short")}</Link>
        </footer>
      </div>
    </main>
  );
}
