import { connection } from "next/server";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Target } from "lucide-react";
import { currentContext } from "@/lib/auth";
import { getGroups } from "@/app/actions";
import { getPlan, planMonths } from "@/lib/plan-db";
import { addMonths, currentMonth, isValidMonth, monthLabel } from "@/lib/months";
import PlanEditor from "@/components/PlanEditor";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const { month: monthParam } = await searchParams;
  const month = isValidMonth(monthParam) ? monthParam : currentMonth();
  const [summary, groups, months] = await Promise.all([getPlan(ws, month), getGroups(), planMonths(ws)]);
  const hasPrevious = months.some((m) => m < month);
  const left = summary.leftToPlan;
  const empty = summary.lines.length === 0;
  const tone = empty ? "text-[#9ca3c0]" : Math.abs(left) < 0.005 ? "text-teal-400" : left > 0 ? "text-amber-400" : "text-red-400";
  const planned = summary.plannedSpending;
  const pct = planned > 0 ? Math.min(100, (summary.actualSpending / planned) * 100) : 0;

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
              <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
                Plan
              </h1>
              <p className="text-xs text-[#5a6380] mt-1">Give every euro a job. Income minus plan should land on zero.</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Link href={`/plan?month=${addMonths(month, -1)}`} aria-label="Previous month" className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[#9ca3c0] hover:text-white hover:bg-white/10"><ChevronLeft size={14} /></Link>
              <span className="text-sm font-semibold text-white/90 w-32 text-center">{monthLabel(month)}</span>
              <Link href={`/plan?month=${addMonths(month, 1)}`} aria-label="Next month" className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[#9ca3c0] hover:text-white hover:bg-white/10"><ChevronRight size={14} /></Link>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Planned income</p>
            <p className="text-base sm:text-xl font-bold text-teal-400 font-mono tabular-nums whitespace-nowrap">{fmt(summary.plannedIncome)} €</p>
            <p className="text-[9px] text-[#5a6380]">{fmt(summary.actualIncome)} € received</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Planned spending</p>
            <p className="text-base sm:text-xl font-bold text-white font-mono tabular-nums whitespace-nowrap">{fmt(planned)} €</p>
            <p className="text-[9px] text-[#5a6380]">{fmt(summary.actualSpending)} € spent</p>
            <div className="h-1 rounded-full bg-white/5 mt-2 overflow-hidden"><div className={`h-full rounded-full ${summary.actualSpending > planned && planned > 0 ? "bg-red-500" : "bg-gradient-to-r from-pink-500 to-purple-500"}`} style={{ width: `${pct}%` }} /></div>
          </div>
          <div className={`card rounded-2xl p-4 border ${empty ? "border-white/[0.08]" : Math.abs(left) < 0.005 ? "border-teal-500/30" : left > 0 ? "border-amber-500/30" : "border-red-500/30"}`}>
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1 flex items-center gap-1"><Target size={10} /> Left to plan</p>
            <p className={`text-base sm:text-xl font-bold font-mono tabular-nums whitespace-nowrap ${tone}`}>{left > 0 ? "+" : ""}{fmt(left)} €</p>
            <p className="text-[9px] text-[#5a6380]">{empty ? "no plan yet" : Math.abs(left) < 0.005 ? "every euro has a job" : left > 0 ? "still unassigned" : "planned more than income"}</p>
          </div>
        </div>

        <div className="animate-fade-up" style={{ animationDelay: "0.07s" }}>
          <PlanEditor month={month} summary={summary} groups={groups} hasPrevious={hasPrevious} isCurrentOrFuture={month >= currentMonth()} />
        </div>
      </div>
    </main>
  );
}
