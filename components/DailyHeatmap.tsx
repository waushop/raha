import { Calendar } from "lucide-react";
import { daysInMonth, monthLabel } from "@/lib/months";
import { leadingBlanks, weekdayOrder, type WeekStart } from "@/lib/preferences";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  month: string;
  days: { day: number; total: number }[];
  undated: number;
  weekStart?: WeekStart;
};

// Calendar view of one month's spending by day. Rows without a DAY are
// summed into the "undated" footer so the totals still reconcile.
export default function DailyHeatmap({ month, days, undated, weekStart = "mon" }: Props) {
  const totals = new Map(days.map((d) => [d.day, d.total]));
  const max = Math.max(...days.map((d) => d.total), 1);
  const [y, m] = month.split("-").map(Number);
  const leading = leadingBlanks(new Date(y, m - 1, 1).getDay(), weekStart);
  const count = daysInMonth(month);

  function intensity(total: number): string {
    if (total === 0) return "bg-white/[0.02]";
    const pct = total / max;
    if (pct < 0.25) return "bg-pink-500/15";
    if (pct < 0.5) return "bg-pink-500/30";
    if (pct < 0.75) return "bg-pink-500/50";
    return "bg-pink-500/70";
  }

  return (
    <div className="card rounded-2xl p-5">
      <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
        <Calendar size={14} className="text-pink-400" />
        Daily spending · {monthLabel(month)}
      </h2>
      <div className="grid grid-cols-7 gap-1">
        {weekdayOrder(weekStart).map((d) => DOW_SHORT[d]).map((w) => (
          <span key={w} className="text-[8px] text-[#5a6380] text-center font-bold uppercase tracking-wider">{w}</span>
        ))}
        {Array.from({ length: leading }, (_, i) => <div key={`pad-${i}`} />)}
        {Array.from({ length: count }, (_, i) => {
          const day = i + 1;
          const total = totals.get(day) ?? 0;
          return (
            <div key={day} title={`${day}: ${fmt(total)} €`} className={`aspect-square rounded-md ${intensity(total)} flex items-center justify-center transition-colors`}>
              <span className={`text-[9px] tabular-nums ${total > 0 ? "text-white/80" : "text-[#5a6380]/60"}`}>{day}</span>
            </div>
          );
        })}
      </div>
      {undated > 0 && (
        <p className="text-[10px] text-[#5a6380] mt-3 font-mono tabular-nums">+ {fmt(undated)} € without a day</p>
      )}
    </div>
  );
}
