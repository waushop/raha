import type { Category } from "@/types/expense";
import { CATEGORY_META } from "@/types/expense";

const fmt = (n: number) =>
  n.toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type ChangeItem = {
  name: string;
  category: Category;
  current: number;
  previous: number;
};

type Props = {
  changes: ChangeItem[];
};

export default function ChangedExpenses({ changes }: Props) {
  if (changes.length === 0) return null;

  // Sort by absolute change descending
  const sorted = [...changes]
    .map(c => ({ ...c, diff: c.current - c.previous, pctChange: c.previous > 0 ? ((c.current - c.previous) / c.previous) * 100 : 100 }))
    .filter(c => Math.abs(c.diff) > 1)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 5);

  if (sorted.length === 0) return null;

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center shadow-lg shadow-rose-500/20">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 6l-9.5 9.5-5-5L1 18" />
            <path d="M17 6h6v6" />
          </svg>
        </span>
        <h2 className="text-sm font-bold text-white">Suurimad muutused</h2>
        <span className="text-[10px] text-[#4a5568] ml-auto">vs eelmine kuu</span>
      </div>

      <div className="space-y-2.5">
        {sorted.map(({ name, category, current, previous, diff, pctChange }) => {
          const meta = CATEGORY_META[category];
          const isUp = diff > 0;
          const isNew = previous === 0;
          const isGone = current === 0;

          return (
            <div key={`${name}-${category}`} className="flex items-center gap-3">
              <span className="text-xs shrink-0">{meta.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/80 font-medium truncate">{name}</span>
                  <div className="flex items-center gap-2 ml-2 shrink-0">
                    <span className="text-[10px] font-mono text-[#4a5568] tabular-nums line-through">{fmt(previous)}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-[#4a5568]">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                    <span className="text-xs font-mono font-semibold text-white/70 tabular-nums">{fmt(current)} €</span>
                  </div>
                </div>
              </div>
              <span className={`text-[10px] font-bold shrink-0 ${
                isNew ? "text-blue-400" : isGone ? "text-gray-400" : isUp ? "text-red-400/70" : "text-teal-400/70"
              }`}>
                {isNew ? "UUS" : isGone ? "EEMALDATUD" : `${isUp ? "+" : ""}${pctChange.toFixed(0)}%`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
