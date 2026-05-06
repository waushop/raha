import { connection } from "next/server";
import db from "@/lib/db";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES, GROUP_COLOR_CLASSES } from "@/types/expense";
import Link from "next/link";
import MonthSelector from "@/components/MonthSelector";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
}

type GroupRow = { GROUP_NAME: string | null; GROUP_EMOJI: string | null; GROUP_COLOR: string | null; MONTH: string; TOTAL: number };

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ m1?: string; m2?: string }>;
}) {
  await connection();
  const params = await searchParams;
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  const m1 = params.m1 ?? prevMonth;
  const m2 = params.m2 ?? thisMonth;

  // Group totals for both months
  const [groupRows] = await db.execute(
    `SELECT g.NAME AS GROUP_NAME, g.EMOJI AS GROUP_EMOJI, g.COLOR AS GROUP_COLOR, e.MONTH, CAST(SUM(e.AMOUNT) AS REAL) AS TOTAL
     FROM EXPENSE e
     LEFT JOIN EXPENSE_GROUP g ON e.GROUP_ID = g.ID AND g.DELETED_AT IS NULL
     WHERE e.DELETED_AT IS NULL AND e.MONTH IN (?, ?)
     GROUP BY g.NAME, g.EMOJI, g.COLOR, e.MONTH
     ORDER BY TOTAL DESC`,
    [m1, m2]
  );
  const groupData = groupRows as GroupRow[];

  // Category totals
  const [catRows] = await db.execute(
    `SELECT CATEGORY, MONTH, CAST(SUM(AMOUNT) AS REAL) AS TOTAL
     FROM EXPENSE WHERE DELETED_AT IS NULL AND MONTH IN (?, ?)
     GROUP BY CATEGORY, MONTH ORDER BY TOTAL DESC`,
    [m1, m2]
  );
  const catData = catRows as { CATEGORY: CategoryKey; MONTH: string; TOTAL: number }[];

  // Month totals
  const [totalRows] = await db.execute(
    "SELECT MONTH, CAST(SUM(AMOUNT) AS REAL) AS TOTAL, COUNT(*) AS CNT FROM EXPENSE WHERE DELETED_AT IS NULL AND MONTH IN (?, ?) GROUP BY MONTH",
    [m1, m2]
  );
  const totals = totalRows as { MONTH: string; TOTAL: number; CNT: number }[];
  const t1 = totals.find(r => r.MONTH === m1);
  const t2 = totals.find(r => r.MONTH === m2);

  // Unique group names
  const groupNames = [...new Set(groupData.map(r => r.GROUP_NAME ?? "Ungrouped"))];

  // Unique categories
  const catKeys = [...new Set(catData.map(r => r.CATEGORY))];
  const maxCat = Math.max(...catData.map(r => r.TOTAL), 1);

  // Available months for selectors
  const [monthsRows] = await db.execute(
    "SELECT DISTINCT MONTH FROM EXPENSE WHERE DELETED_AT IS NULL ORDER BY MONTH DESC"
  );
  const availableMonths = (monthsRows as { MONTH: string }[]).map(r => r.MONTH);

  const diff = (t1?.TOTAL ?? 0) - (t2?.TOTAL ?? 0);

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 sm:py-10 pb-20">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1
            className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1"
            style={{ fontFamily: "'Caveat', cursive", fontWeight: 700 }}
          >
            Compare
          </h1>
          <div className="mt-2">
            <MonthSelector m1={m1} m2={m2} availableMonths={availableMonths} />
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <div className="card rounded-2xl p-4 text-center">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">{monthLabel(m1)}</p>
            <p className="text-lg font-bold text-purple-400 font-mono tabular-nums">{fmt(t1?.TOTAL ?? 0)} €</p>
            <p className="text-[9px] text-[#5a6380]">{t1?.CNT ?? 0} expenses</p>
          </div>
          <div className="card rounded-2xl p-4 text-center">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Difference</p>
            <p className={`text-lg font-bold font-mono tabular-nums ${diff > 0 ? "text-red-400" : diff < 0 ? "text-teal-400" : "text-white"}`}>
              {diff > 0 ? "+" : ""}{fmt(diff)} €
            </p>
          </div>
          <div className="card rounded-2xl p-4 text-center">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">{monthLabel(m2)}</p>
            <p className="text-lg font-bold text-pink-400 font-mono tabular-nums">{fmt(t2?.TOTAL ?? 0)} €</p>
            <p className="text-[9px] text-[#5a6380]">{t2?.CNT ?? 0} expenses</p>
          </div>
        </div>

        {/* Category comparison bars */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.08s" }}>
          <h2 className="text-sm font-bold text-white mb-4">By category</h2>
          <div className="space-y-3">
            {catKeys.map(key => {
              const cat = CATEGORIES[key] ?? CATEGORIES.other;
              const v1 = catData.find(r => r.CATEGORY === key && r.MONTH === m1)?.TOTAL ?? 0;
              const v2 = catData.find(r => r.CATEGORY === key && r.MONTH === m2)?.TOTAL ?? 0;
              const w1 = (v1 / maxCat) * 100;
              const w2 = (v2 / maxCat) * 100;

              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-sm">{cat.icon}</span>
                      <span className="text-xs font-semibold text-white/70">{cat.label}</span>
                    </span>
                    <div className="flex items-center gap-3 text-[10px] font-mono tabular-nums">
                      <span className="text-purple-400">{fmt(v1)}</span>
                      <span className="text-[#5a6380]">vs</span>
                      <span className="text-pink-400">{fmt(v2)}</span>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="h-1.5 rounded-full overflow-hidden bg-white/5">
                      <div className="h-full rounded-full bg-purple-500/50" style={{ width: `${w1}%` }} />
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden bg-white/5">
                      <div className="h-full rounded-full bg-pink-500/50" style={{ width: `${w2}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-6 mt-4 pt-3 border-t border-white/[0.06]">
            <span className="inline-flex items-center gap-1.5 text-[10px] text-[#9ca3c0]">
              <span className="w-3 h-1.5 rounded-full bg-purple-500/50" /> {monthLabel(m1)}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] text-[#9ca3c0]">
              <span className="w-3 h-1.5 rounded-full bg-pink-500/50" /> {monthLabel(m2)}
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
