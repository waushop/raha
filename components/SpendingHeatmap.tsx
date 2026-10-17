import { LayoutGrid } from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

type Props = {
  data: { month: string; total: number }[];
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function SpendingHeatmap({ data }: Props) {
  if (data.length === 0) return null;

  const maxTotal = Math.max(...data.map(d => d.total), 1);

  // Group by year
  const years = new Map<number, Map<number, number>>();
  for (const d of data) {
    const [y, m] = d.month.split("-").map(Number);
    if (!years.has(y)) years.set(y, new Map());
    years.get(y)!.set(m, d.total);
  }

  function intensity(total: number): string {
    if (total === 0) return "bg-white/[0.02]";
    const pct = total / maxTotal;
    if (pct < 0.25) return "bg-purple-500/15";
    if (pct < 0.5) return "bg-purple-500/30";
    if (pct < 0.75) return "bg-purple-500/50";
    return "bg-purple-500/70";
  }

  return (
    <div className="card rounded-2xl p-5">
      <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
        <LayoutGrid size={14} className="text-purple-400" />
        Spending heatmap
      </h2>

      {Array.from(years.entries()).sort((a, b) => b[0] - a[0]).map(([year, months]) => (
        <div key={year} className="mb-3 last:mb-0">
          <p className="text-[10px] text-[#5a6380] font-bold mb-1.5">{year}</p>
          <div className="grid grid-cols-12 gap-1">
            {Array.from({ length: 12 }, (_, i) => {
              const total = months.get(i + 1) ?? 0;
              return (
                <div key={i} className="flex flex-col items-center gap-0.5" title={`${MONTH_LABELS[i]} ${year}: ${fmt(total)} €`}>
                  <div className={`w-full aspect-square rounded-sm ${intensity(total)} transition-colors`} />
                  <span className="text-[7px] text-[#5a6380]">{MONTH_LABELS[i].charAt(0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-3 justify-end">
        <span className="text-[8px] text-[#5a6380]">Less</span>
        <div className="w-3 h-3 rounded-sm bg-white/[0.02]" />
        <div className="w-3 h-3 rounded-sm bg-purple-500/15" />
        <div className="w-3 h-3 rounded-sm bg-purple-500/30" />
        <div className="w-3 h-3 rounded-sm bg-purple-500/50" />
        <div className="w-3 h-3 rounded-sm bg-purple-500/70" />
        <span className="text-[8px] text-[#5a6380]">More</span>
      </div>
    </div>
  );
}
