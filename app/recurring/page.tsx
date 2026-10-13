import { connection } from "next/server";
import db from "@/lib/db";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES, GROUP_COLOR_CLASSES } from "@/types/expense";
import Link from "next/link";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function RecurringPage() {
  await connection();
  // Get all unique recurring expenses with their latest values
  const [rows] = await db.execute(
    `SELECT e.NAME, e.CATEGORY, CAST(e.AMOUNT AS REAL) AS AMOUNT,
            e.GROUP_ID, g.NAME AS GROUP_NAME, g.EMOJI AS GROUP_EMOJI, g.COLOR AS GROUP_COLOR,
            COUNT(DISTINCT e.MONTH) AS MONTHS,
            MIN(e.MONTH) AS FIRST_MONTH, MAX(e.MONTH) AS LAST_MONTH,
            CAST(SUM(e.AMOUNT) AS REAL) AS TOTAL_SPENT
     FROM LEDGER e
     LEFT JOIN CATEGORY_GROUP g ON e.GROUP_ID = g.ID AND g.DELETED_AT IS NULL
     WHERE e.IS_RECURRING = 1 AND e.KIND = 'expense' AND e.DELETED_AT IS NULL
     GROUP BY e.NAME, e.CATEGORY, e.AMOUNT, e.GROUP_ID, g.NAME, g.EMOJI, g.COLOR
     ORDER BY e.AMOUNT DESC`
  );
  const recurring = rows as Array<{
    NAME: string; CATEGORY: CategoryKey; AMOUNT: number;
    GROUP_ID: string | null; GROUP_NAME: string | null; GROUP_EMOJI: string | null; GROUP_COLOR: string | null;
    MONTHS: number; FIRST_MONTH: string; LAST_MONTH: string; TOTAL_SPENT: number;
  }>;

  const monthlyTotal = recurring.reduce((s, r) => s + r.AMOUNT, 0);
  const yearlyEstimate = monthlyTotal * 12;

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 sm:py-10 pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1
            className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1"
            style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}
          >
            Recurring
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">
            {recurring.length} recurring expense{recurring.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Monthly</p>
            <p className="text-xl font-bold text-white font-mono tabular-nums">{fmt(monthlyTotal)} €</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Yearly estimate</p>
            <p className="text-xl font-bold text-amber-400 font-mono tabular-nums">{fmt(yearlyEstimate)} €</p>
          </div>
        </div>

        {/* List */}
        <div className="animate-fade-up" style={{ animationDelay: "0.08s" }}>
          {recurring.length > 0 ? (
            <div className="card rounded-2xl overflow-hidden">
              <div className="divide-y divide-white/[0.04]">
                {recurring.map((r, i) => {
                  const cat = CATEGORIES[r.CATEGORY] ?? CATEGORIES.other;
                  const groupColors = r.GROUP_COLOR ? (GROUP_COLOR_CLASSES[r.GROUP_COLOR] ?? GROUP_COLOR_CLASSES.blue) : null;
                  return (
                    <div key={`${r.NAME}-${i}`} className="px-4 py-3 flex items-center gap-3 row-hover">
                      <span className="text-lg shrink-0">{cat.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-white/90 font-medium truncate">{r.NAME}</span>
                          <span className="text-sm font-mono font-bold text-white/80 ml-2 shrink-0 tabular-nums">{fmt(r.AMOUNT)} €</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#5a6380]">
                          {r.GROUP_NAME && (
                            <span className={`${groupColors?.text ?? ""}`}>
                              {r.GROUP_EMOJI} {r.GROUP_NAME}
                            </span>
                          )}
                          <span>{r.MONTHS} months</span>
                          <span>Total: {fmt(r.TOTAL_SPENT)} €</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="card rounded-2xl p-8 text-center">
              <p className="text-sm text-[#9ca3c0]">No recurring expenses</p>
              <p className="text-xs text-[#5a6380] mt-1">Mark expenses as recurring to see them here</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
