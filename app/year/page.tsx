import { connection } from "next/server";
import db from "@/lib/db";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES } from "@/types/expense";
import Link from "next/link";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtShort = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "Mai", "Jun",
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
  const { year: yearParam } = await searchParams;
  const year = yearParam ?? String(new Date().getFullYear());

  // Monthly totals
  const [monthRows] = await db.execute(
    `SELECT MONTH,
            CAST(SUM(AMOUNT) AS REAL) AS TOTAL,
            COUNT(*) AS COUNT
     FROM LEDGER
     WHERE DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?
     GROUP BY MONTH ORDER BY MONTH`,
    [`${year}-01`, `${year}-12`]
  );
  const months = monthRows as MonthRow[];

  // Category totals for the year
  const [catRows] = await db.execute(
    `SELECT CATEGORY, CAST(SUM(AMOUNT) AS REAL) AS TOTAL
     FROM LEDGER
     WHERE DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?
     GROUP BY CATEGORY ORDER BY TOTAL DESC`,
    [`${year}-01`, `${year}-12`]
  );
  const categories = catRows as CatRow[];

  const yearTotal = months.reduce((s, m) => s + m.TOTAL, 0);
  const avgMonth = months.length > 0 ? yearTotal / months.length : 0;
  const maxMonth = Math.max(...months.map(m => m.TOTAL), 0);

  const prevYear = String(Number(year) - 1);
  const nextYear = String(Number(year) + 1);

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 sm:py-10 pb-20">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 flex items-center justify-between animate-fade-up">
          <div>
            <Link href="/" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">
              ← Back
            </Link>
            <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "'Caveat', cursive", fontWeight: 700 }}>
              Year overview
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/year?year=${prevYear}`}
              className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-pink-500/30 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
            <span className="font-bold text-lg text-white w-16 text-center tabular-nums">{year}</span>
            <Link
              href={`/year?year=${nextYear}`}
              className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-pink-500/30 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>
        </div>

        {/* Year stats */}
        <div className="grid grid-cols-2 gap-3 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <div className="card rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Year total</p>
            <p className="text-lg font-bold text-white font-mono tabular-nums">{fmt(yearTotal)} €</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Monthly avg</p>
            <p className="text-lg font-bold text-white font-mono tabular-nums">{fmt(avgMonth)} €</p>
          </div>
        </div>

        {/* Monthly bar chart */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.08s" }}>
          <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 20V10M12 20V4M6 20v-6" />
              </svg>
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
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.21 15.89A10 10 0 118 2.83" />
                  <path d="M22 12A10 10 0 0012 2v10z" />
                </svg>
              </span>
              Categories ({year})
            </h2>
            <div className="space-y-2.5">
              {categories.map(({ CATEGORY, TOTAL }) => {
                const meta = CATEGORIES[CATEGORY];
                const pct = yearTotal > 0 ? (TOTAL / yearTotal) * 100 : 0;
                return (
                  <div key={CATEGORY} className="flex items-center gap-3">
                    <span className="text-sm shrink-0">{meta.icon}</span>
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
            <h2 className="text-sm font-bold text-white">Monthse detail</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Month</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Total</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Expenses</th>
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
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-white/80 tabular-nums">{fmt(m.TOTAL)} €</td>
                      <td className="px-4 py-2.5 text-right text-[#9ca3c0] tabular-nums">{m.COUNT}</td>
                    </tr>
                  );
                })}
              </tbody>
              {months.length > 0 && (
                <tfoot>
                  <tr className="border-t border-white/10 font-semibold">
                    <td className="px-5 py-3 text-[#9ca3c0] text-xs uppercase tracking-wider">Total</td>
                    <td className="px-4 py-3 text-right font-mono text-white tabular-nums">{fmt(yearTotal)} €</td>
                    <td className="px-4 py-3 text-right text-[#9ca3c0] tabular-nums">{months.reduce((s, m) => s + m.COUNT, 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {months.length === 0 && (
          <div className="card rounded-2xl p-12 text-center">
            <p className="text-sm text-[#5a6380]">Aastal {year} has no data</p>
          </div>
        )}

        <footer className="text-center pt-4 pb-2">
          <Link href="/" className="text-[10px] text-[#5a6380]/50 hover:text-pink-400/50 transition-colors tracking-wider font-medium">
            ← Back kuuvaatesse
          </Link>
        </footer>
      </div>
    </main>
  );
}
