import { connection } from "next/server";
import db from "@/lib/db";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES, GROUP_COLOR_CLASSES } from "@/types/expense";
import Link from "next/link";
import { addMonths, currentMonth, monthLabel } from "@/lib/months";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function RecurringPage() {
  await connection();
  // One row per recurring item (name + category + group). AMOUNT is the most
  // recent price, so a subscription that got more expensive is still one row.
  const [rows] = await db.execute(
    `WITH live AS (
       SELECT NAME, CATEGORY, GROUP_ID, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, CREATED_AT
       FROM LEDGER WHERE IS_RECURRING = 1 AND KIND = 'expense' AND DELETED_AT IS NULL
     ),
     agg AS (
       SELECT NAME, CATEGORY, GROUP_ID, COUNT(DISTINCT MONTH) AS MONTHS,
              MIN(MONTH) AS FIRST_MONTH, MAX(MONTH) AS LAST_MONTH, CAST(SUM(AMOUNT) AS REAL) AS TOTAL_SPENT
       FROM live GROUP BY NAME, CATEGORY, GROUP_ID
     ),
     latest AS (
       SELECT NAME, CATEGORY, GROUP_ID, AMOUNT,
              ROW_NUMBER() OVER (PARTITION BY NAME, CATEGORY, GROUP_ID ORDER BY MONTH DESC, CREATED_AT DESC) AS RN
       FROM live
     )
     SELECT a.NAME, a.CATEGORY, a.GROUP_ID, a.MONTHS, a.FIRST_MONTH, a.LAST_MONTH, a.TOTAL_SPENT, l.AMOUNT,
            g.NAME AS GROUP_NAME, g.EMOJI AS GROUP_EMOJI, g.COLOR AS GROUP_COLOR
     FROM agg a
     JOIN latest l ON l.NAME = a.NAME AND l.CATEGORY = a.CATEGORY AND l.GROUP_ID IS a.GROUP_ID AND l.RN = 1
     LEFT JOIN CATEGORY_GROUP g ON a.GROUP_ID = g.ID AND g.DELETED_AT IS NULL
     ORDER BY a.LAST_MONTH DESC, l.AMOUNT DESC`
  );
  const recurring = rows as Array<{
    NAME: string; CATEGORY: CategoryKey; AMOUNT: number;
    GROUP_ID: string | null; GROUP_NAME: string | null; GROUP_EMOJI: string | null; GROUP_COLOR: string | null;
    MONTHS: number; FIRST_MONTH: string; LAST_MONTH: string; TOTAL_SPENT: number;
  }>;

  // Not seen in the last two months → probably cancelled; keep it listed but
  // out of the monthly total.
  const activeSince = addMonths(currentMonth(), -2);
  const isActive = (r: { LAST_MONTH: string }) => r.LAST_MONTH >= activeSince;
  const active = recurring.filter(isActive);
  const monthlyTotal = active.reduce((s, r) => s + r.AMOUNT, 0);
  const yearlyEstimate = monthlyTotal * 12;

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-20">
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
            {active.length} active recurring expense{active.length !== 1 ? "s" : ""}
            {recurring.length > active.length && `, ${recurring.length - active.length} inactive`}
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
                  const stale = !isActive(r);
                  return (
                    <div key={`${r.NAME}-${i}`} className={`px-4 py-3 flex items-center gap-3 row-hover ${stale ? "opacity-50" : ""}`}>
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
                          <span>{r.MONTHS} month{r.MONTHS !== 1 ? "s" : ""}</span>
                          <span>Total: {fmt(r.TOTAL_SPENT)} €</span>
                          {stale && <span className="text-amber-400/70">Last seen {monthLabel(r.LAST_MONTH, "short")}</span>}
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
