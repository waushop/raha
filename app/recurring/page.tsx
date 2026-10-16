import { connection } from "next/server";
import db from "@/lib/db";
import { currentContext } from "@/lib/auth";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES, GROUP_COLOR_CLASSES } from "@/types/expense";
import Link from "next/link";
import { addMonths, currentMonth, monthLabel } from "@/lib/months";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = {
  NAME: string; CATEGORY: CategoryKey; GROUP_ID: string | null; AMOUNT: number; MONTH: string; DAY: number | null;
  GROUP_NAME: string | null; GROUP_EMOJI: string | null; GROUP_COLOR: string | null;
};

type Subscription = {
  key: string; name: string; category: CategoryKey; group: { name: string; emoji: string | null; color: string } | null;
  amount: number; day: number | null; months: number; firstMonth: string; lastMonth: string; totalSpent: number;
  previousAmount: number | null; changedIn: string | null; active: boolean;
};

export default async function RecurringPage() {
  await connection();
  const { workspaceId: ws } = await currentContext();
  // All recurring expense rows; grouped in JS so we can read the latest price,
  // the charge day and the previous price without a tangle of window functions.
  const [rows] = await db.execute(
    `SELECT e.NAME, e.CATEGORY, e.GROUP_ID, CAST(e.AMOUNT AS REAL) AS AMOUNT, e.MONTH, e.DAY,
            g.NAME AS GROUP_NAME, g.EMOJI AS GROUP_EMOJI, g.COLOR AS GROUP_COLOR
     FROM LEDGER e
     LEFT JOIN CATEGORY_GROUP g ON e.GROUP_ID = g.ID AND g.DELETED_AT IS NULL
     WHERE e.WORKSPACE_ID = ? AND e.IS_RECURRING = 1 AND e.KIND = 'expense' AND e.DELETED_AT IS NULL
     ORDER BY e.MONTH DESC, e.CREATED_AT DESC`,
    [ws],
  );
  const activeSince = addMonths(currentMonth(), -2);
  const byKey = new Map<string, Row[]>();
  for (const r of rows as Row[]) {
    const key = `${r.NAME}\u0000${r.CATEGORY}\u0000${r.GROUP_ID ?? ""}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  const subs: Subscription[] = [...byKey.entries()].map(([key, list]) => {
    const latest = list[0]; // sorted newest first
    const months = new Set(list.map((r) => r.MONTH));
    const changed = list.find((r) => Math.abs(r.AMOUNT - latest.AMOUNT) > 0.004);
    return {
      key,
      name: latest.NAME,
      category: latest.CATEGORY,
      group: latest.GROUP_NAME ? { name: latest.GROUP_NAME, emoji: latest.GROUP_EMOJI, color: latest.GROUP_COLOR ?? "blue" } : null,
      amount: latest.AMOUNT,
      day: latest.DAY,
      months: months.size,
      firstMonth: list[list.length - 1].MONTH,
      lastMonth: latest.MONTH,
      totalSpent: list.reduce((s, r) => s + r.AMOUNT, 0),
      previousAmount: changed?.AMOUNT ?? null,
      // the month the current price first applied = the newest row after the last different one
      changedIn: changed ? list[list.indexOf(changed) - 1]?.MONTH ?? latest.MONTH : null,
      active: latest.MONTH >= activeSince,
    };
  }).sort((a, b) => Number(b.active) - Number(a.active) || b.amount - a.amount);

  const active = subs.filter((s) => s.active);
  const monthlyTotal = active.reduce((s, r) => s + r.amount, 0);
  const yearlyEstimate = monthlyTotal * 12;
  const today = new Date().getDate();
  const upcoming = active.filter((s) => s.day !== null && s.day > today).sort((a, b) => a.day! - b.day!);
  const dueTotal = upcoming.reduce((s, r) => s + r.amount, 0);

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
            Recurring
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">
            {active.length} active subscription{active.length !== 1 ? "s" : ""}
            {subs.length > active.length && `, ${subs.length - active.length} inactive`}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Monthly</p>
            <p className="text-lg sm:text-xl font-bold text-white font-mono tabular-nums whitespace-nowrap">{fmt(monthlyTotal)} €</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Yearly</p>
            <p className="text-lg sm:text-xl font-bold text-amber-400 font-mono tabular-nums whitespace-nowrap">{fmt(yearlyEstimate)} €</p>
          </div>
          <div className="card rounded-2xl p-4 col-span-2 sm:col-span-1" title={upcoming.map((u) => `${u.day}: ${u.name}`).join(", ")}>
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Still due this month</p>
            <p className="text-lg sm:text-xl font-bold text-pink-400 font-mono tabular-nums whitespace-nowrap">{fmt(dueTotal)} €</p>
            <p className="text-[9px] text-[#5a6380]">{upcoming.length} charge{upcoming.length !== 1 ? "s" : ""} after today</p>
          </div>
        </div>

        {/* List */}
        <div className="animate-fade-up" style={{ animationDelay: "0.08s" }}>
          {subs.length > 0 ? (
            <div className="card rounded-2xl overflow-hidden">
              <div className="divide-y divide-white/[0.04]">
                {subs.map((s) => {
                  const cat = CATEGORIES[s.category] ?? CATEGORIES.other;
                  const groupColors = s.group ? (GROUP_COLOR_CLASSES[s.group.color] ?? GROUP_COLOR_CLASSES.blue) : null;
                  const delta = s.previousAmount !== null ? s.amount - s.previousAmount : 0;
                  return (
                    <div key={s.key} className={`px-4 py-3 flex items-center gap-3 row-hover ${s.active ? "" : "opacity-50"}`}>
                      <span className="text-lg shrink-0">{cat.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-white/90 font-medium truncate">{s.name}</span>
                          <span className="text-right shrink-0">
                            <span className="text-sm font-mono font-bold text-white/80 tabular-nums">{fmt(s.amount)} €</span>
                            <span className="block text-[9px] font-mono text-[#5a6380] tabular-nums">{fmt(s.amount * 12)} €/yr</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#5a6380] flex-wrap">
                          {s.group && <span className={groupColors?.text ?? ""}>{s.group.emoji} {s.group.name}</span>}
                          {s.day !== null && <span>{s.active && s.day > today ? "due" : "charged"} on the {s.day}{s.day === 1 || s.day === 21 || s.day === 31 ? "st" : s.day === 2 || s.day === 22 ? "nd" : s.day === 3 || s.day === 23 ? "rd" : "th"}</span>}
                          <span>{s.months} month{s.months !== 1 ? "s" : ""} · {fmt(s.totalSpent)} € total</span>
                          {s.previousAmount !== null && (
                            <span className={delta > 0 ? "text-red-400/80" : "text-teal-400/80"}>
                              {delta > 0 ? "▲" : "▼"} {fmt(Math.abs(delta))} € since {s.changedIn ? monthLabel(s.changedIn, "short") : "?"} (was {fmt(s.previousAmount)})
                            </span>
                          )}
                          {!s.active && <span className="text-amber-400/70">last seen {monthLabel(s.lastMonth, "short")}</span>}
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
