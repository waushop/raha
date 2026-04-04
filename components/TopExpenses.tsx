import type { Expense } from "@/types/expense";
import { CATEGORY_META } from "@/types/expense";

const fmt = (n: number) =>
  n.toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
  expenses: Expense[];
  total: number;
};

export default function TopExpenses({ expenses, total }: Props) {
  if (expenses.length < 3) return null;

  const top5 = [...expenses].sort((a, b) => b.AMOUNT - a.AMOUNT).slice(0, 5);
  const topTotal = top5.reduce((s, e) => s + e.AMOUNT, 0);
  const topPct = total > 0 ? (topTotal / total) * 100 : 0;

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </span>
          <h2 className="text-sm font-bold text-white">Top 5 kulud</h2>
        </div>
        <span className="text-[10px] text-[#4a5568] font-medium">
          {topPct.toFixed(0)}% kogukulust
        </span>
      </div>

      <div className="space-y-2">
        {top5.map((e, i) => {
          const pct = total > 0 ? (e.AMOUNT / total) * 100 : 0;
          const meta = CATEGORY_META[e.CATEGORY];
          return (
            <div key={e.ID} className="flex items-center gap-3">
              <span className="text-xs font-bold text-[#4a5568] w-4 text-right tabular-nums">{i + 1}</span>
              <span className="text-xs shrink-0">{meta.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/80 truncate font-medium">{e.NAME}</span>
                  <span className="text-xs font-mono font-semibold text-white/60 tabular-nums ml-2 shrink-0">{fmt(e.AMOUNT)} €</span>
                </div>
                <div className="mt-1 h-1 w-full rounded-full overflow-hidden bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500/60 to-orange-500/60 transition-all duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
