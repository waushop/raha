import type { Category } from "@/types/expense";
import { CATEGORY_META } from "@/types/expense";

const fmt = (n: number) =>
  n.toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COLORS: Record<Category, string> = {
  kodu: "#3b82f6", auto: "#f97316", mootorratas: "#eab308",
  lapsed: "#22c55e", teenused: "#ef4444", siim: "#8b5cf6",
  janne: "#ec4899", muu: "#6b7280",
};

const DOT_CLASS: Record<Category, string> = {
  kodu: "bg-blue-500", auto: "bg-orange-500", mootorratas: "bg-yellow-500",
  lapsed: "bg-green-500", teenused: "bg-red-500", siim: "bg-purple-500",
  janne: "bg-pink-500", muu: "bg-gray-500",
};

type Props = {
  categoryTotals: { category: Category; total: number }[];
  total: number;
};

export default function CategoryBreakdown({ categoryTotals, total }: Props) {
  // Donut chart math
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let cumulativeOffset = 0;

  const segments = categoryTotals.map(({ category, total: catTotal }) => {
    const pct = total > 0 ? catTotal / total : 0;
    const length = pct * circumference;
    const offset = cumulativeOffset;
    cumulativeOffset += length;
    return { category, pct, length, offset, total: catTotal };
  });

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.21 15.89A10 10 0 118 2.83" />
            <path d="M22 12A10 10 0 0012 2v10z" />
          </svg>
        </span>
        <h2 className="text-sm font-bold text-white">Kategooriad</h2>
      </div>

      {/* Donut + Legend side by side */}
      <div className="flex items-start gap-5">
        {/* Donut chart */}
        <div className="relative shrink-0">
          <svg width="128" height="128" viewBox="0 0 128 128">
            {/* Background ring */}
            <circle cx="64" cy="64" r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="14" />
            {/* Segments */}
            {segments.map(({ category, length, offset }) => (
              <circle
                key={category}
                cx="64"
                cy="64"
                r={radius}
                fill="none"
                stroke={COLORS[category]}
                strokeWidth="14"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                transform="rotate(-90 64 64)"
                style={{ transition: "stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease" }}
              />
            ))}
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-white font-mono tabular-nums leading-none">
              {total > 999 ? `${(total / 1000).toFixed(1)}k` : fmt(total)}
            </span>
            <span className="text-[9px] text-[#4a5568] font-semibold uppercase tracking-wider mt-0.5">€ kokku</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-1.5 min-w-0">
          {segments.map(({ category, pct, total: catTotal }) => {
            const meta = CATEGORY_META[category];
            return (
              <div key={category} className="flex items-center gap-2">
                <span className="text-xs leading-none shrink-0">{meta.emoji}</span>
                <span className={`text-xs font-semibold ${meta.color} truncate flex-1`}>{meta.label}</span>
                <span className="text-[11px] font-mono text-white/50 tabular-nums shrink-0">{fmt(catTotal)}</span>
                <span className="text-[10px] font-mono text-[#4a5568] w-8 text-right tabular-nums shrink-0">{(pct * 100).toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
