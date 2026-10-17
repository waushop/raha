import Link from "next/link";
import type { WeekdaySplit } from "@/lib/reports";
import { weekdayOrder, type WeekStart } from "@/lib/preferences";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = { split: WeekdaySplit; weekStart?: WeekStart };

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** Weekday vs weekend spending and the single most expensive day. */
export default function WeekdaySplitCard({ split, weekStart = "mon" }: Props) {
  const { weekday, weekend, dated, skipped, topDay, byDow } = split;
  if (dated === 0) {
    return (
      <p className="text-xs text-[#5a6380]">
        No expenses with a day of the month yet
        {skipped > 0 ? ` (${skipped} without a day were skipped)` : ""}. Add the day when entering expenses to see this.
      </p>
    );
  }
  const total = weekday.total + weekend.total;
  const weekendPct = total > 0 ? (weekend.total / total) * 100 : 0;
  const maxDow = Math.max(...byDow, 1);
  const perDayLeader = weekend.perDay > weekday.perDay ? "weekend" : "weekday";
  const ratio = Math.min(weekend.perDay, weekday.perDay) > 0
    ? Math.max(weekend.perDay, weekday.perDay) / Math.min(weekend.perDay, weekday.perDay)
    : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="surface p-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-0.5">Weekdays</p>
          <p className="text-lg font-bold text-white font-mono tabular-nums">{fmt(weekday.total)} €</p>
          <p className="text-[10px] text-[#5a6380]">{fmt(weekday.perDay)} €/day · {weekday.count} purchases</p>
        </div>
        <div className="surface p-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-0.5">Weekends</p>
          <p className="text-lg font-bold text-white font-mono tabular-nums">{fmt(weekend.total)} €</p>
          <p className="text-[10px] text-[#5a6380]">{fmt(weekend.perDay)} €/day · {weekend.count} purchases</p>
        </div>
        <div className="surface p-3 col-span-2 sm:col-span-1">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-0.5">Most expensive day</p>
          {topDay ? (
            <>
              <p className="text-lg font-bold text-red-400 font-mono tabular-nums">{fmt(topDay.total)} €</p>
              <Link href={`/?month=${topDay.month}`} className="text-[10px] text-[#5a6380] hover:text-pink-400 transition-colors">
                {topDay.weekday}, {dayLabel(topDay.month, topDay.day)} · {topDay.count} purchase{topDay.count === 1 ? "" : "s"}
              </Link>
            </>
          ) : (
            <p className="text-lg font-bold text-white">–</p>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-[10px] text-[#5a6380] mb-1">
          <span>Share of dated spending</span>
          <span className="tabular-nums">{(100 - weekendPct).toFixed(0)}% weekday · {weekendPct.toFixed(0)}% weekend</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden bg-white/5 flex gap-px">
          <div className="h-full bg-purple-500/60" style={{ width: `${100 - weekendPct}%` }} title={`Weekdays: ${fmt(weekday.total)} €`} />
          <div className="h-full bg-pink-500/60" style={{ width: `${weekendPct}%` }} title={`Weekends: ${fmt(weekend.total)} €`} />
        </div>
      </div>

      <div>
        <p className="text-[10px] text-[#5a6380] mb-1.5">By day of the week</p>
        <div className="grid grid-cols-7 gap-1.5 items-end">
          {weekdayOrder(weekStart).map((d) => (
            <div key={d} className="flex flex-col items-center gap-1" title={`${DOW_SHORT[d]}: ${fmt(byDow[d])} €`}>
              <div className="w-full h-12 flex items-end">
                <div
                  className={`w-full rounded-t-sm ${d === 0 || d === 6 ? "bg-pink-500/50" : "bg-purple-500/50"}`}
                  style={{ height: `${(byDow[d] / maxDow) * 100}%`, minHeight: byDow[d] > 0 ? 2 : 0 }}
                />
              </div>
              <span className="text-[9px] text-[#5a6380]">{DOW_SHORT[d]}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-[#5a6380]">
        {ratio !== null && ratio >= 1.05
          ? `A ${perDayLeader} day costs ${ratio.toFixed(1)}× ${perDayLeader === "weekend" ? "a weekday" : "a weekend day"}. `
          : "Weekdays and weekends cost about the same per day. "}
        Based on {dated} dated expense{dated === 1 ? "" : "s"}
        {skipped > 0 ? `; ${skipped} without a day ${skipped === 1 ? "was" : "were"} skipped` : ""}.
      </p>
    </div>
  );
}
