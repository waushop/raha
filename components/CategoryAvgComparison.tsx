import type { Category } from "@/types/expense";
import { CATEGORY_META } from "@/types/expense";

const fmt = (n: number) =>
  n.toLocaleString("et-EE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

type CatAvgData = {
  category: Category;
  current: number;
  avg: number;
};

type Props = {
  data: CatAvgData[];
};

export default function CategoryAvgComparison({ data }: Props) {
  if (data.length === 0) return null;

  // Only show categories with meaningful data
  const filtered = data.filter(d => d.current > 0 || d.avg > 0);
  if (filtered.length === 0) return null;

  const maxVal = Math.max(...filtered.flatMap(d => [d.current, d.avg]));

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 20V10M12 20V4M6 20v-6" />
          </svg>
        </span>
        <h2 className="text-sm font-bold text-white">vs Keskmine</h2>
      </div>

      <div className="space-y-3">
        {filtered.slice(0, 6).map(({ category, current, avg }) => {
          const meta = CATEGORY_META[category];
          const diff = avg > 0 ? ((current - avg) / avg) * 100 : 0;
          const currentW = maxVal > 0 ? (current / maxVal) * 100 : 0;
          const avgW = maxVal > 0 ? (avg / maxVal) * 100 : 0;

          return (
            <div key={category}>
              <div className="flex items-center justify-between mb-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-xs">{meta.emoji}</span>
                  <span className={`text-[11px] font-semibold ${meta.color}`}>{meta.label}</span>
                </span>
                {Math.abs(diff) > 2 && (
                  <span className={`text-[10px] font-bold ${diff > 0 ? "text-red-400/60" : "text-teal-400/60"}`}>
                    {diff > 0 ? "+" : ""}{diff.toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="space-y-0.5">
                {/* Current month bar */}
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[#4a5568] w-8 shrink-0">Kuu</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                      style={{ width: `${currentW}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-white/50 w-12 text-right tabular-nums">{fmt(current)}</span>
                </div>
                {/* Average bar */}
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[#4a5568] w-8 shrink-0">Avg</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/5">
                    <div
                      className="h-full rounded-full bg-teal-500/40 transition-all duration-500"
                      style={{ width: `${avgW}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-[#4a5568] w-12 text-right tabular-nums">{fmt(avg)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-white/5">
        <span className="inline-flex items-center gap-1.5 text-[9px] text-[#4a5568]">
          <span className="w-2 h-1.5 rounded-full bg-gradient-to-r from-purple-500 to-pink-500" /> See kuu
        </span>
        <span className="inline-flex items-center gap-1.5 text-[9px] text-[#4a5568]">
          <span className="w-2 h-1.5 rounded-full bg-teal-500/40" /> 6-kuu keskmine
        </span>
      </div>
    </div>
  );
}
