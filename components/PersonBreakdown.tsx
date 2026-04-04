import type { Expense, Category } from "@/types/expense";
import { CATEGORY_META } from "@/types/expense";

const fmt = (n: number) =>
  n.toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
  expenses: Expense[];
};

export default function PersonBreakdown({ expenses }: Props) {
  if (expenses.length === 0) return null;

  const total = expenses.reduce((s, e) => s + e.AMOUNT, 0);
  const siimShare = expenses.reduce((s, e) => s + (e.AMOUNT * e.SIIM_PCT) / 100, 0);
  const janneShare = total - siimShare;

  // Per-category share for each person
  const catData: { category: Category; siim: number; janne: number }[] = [];
  const catMap = new Map<Category, { siim: number; janne: number }>();
  for (const e of expenses) {
    const existing = catMap.get(e.CATEGORY) ?? { siim: 0, janne: 0 };
    existing.siim += (e.AMOUNT * e.SIIM_PCT) / 100;
    existing.janne += e.AMOUNT - (e.AMOUNT * e.SIIM_PCT) / 100;
    catMap.set(e.CATEGORY, existing);
  }
  for (const [category, vals] of catMap) {
    catData.push({ category, ...vals });
  }
  catData.sort((a, b) => (b.siim + b.janne) - (a.siim + a.janne));

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
        </span>
        <h2 className="text-sm font-bold text-white">Isiklik jaotus</h2>
      </div>

      {/* Overall split bar */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-bold text-purple-400 tabular-nums w-20 text-right">{fmt(siimShare)} €</span>
        <div className="flex-1 h-3 rounded-full overflow-hidden flex bg-white/5">
          <div
            className="h-full rounded-l-full"
            style={{ width: `${total > 0 ? (siimShare / total) * 100 : 50}%`, background: "linear-gradient(90deg, #8b5cf6, #a78bfa)" }}
          />
          <div
            className="h-full rounded-r-full"
            style={{ width: `${total > 0 ? (janneShare / total) * 100 : 50}%`, background: "linear-gradient(90deg, #f472b6, #ec4899)" }}
          />
        </div>
        <span className="text-xs font-bold text-pink-400 tabular-nums w-20">{fmt(janneShare)} €</span>
      </div>

      {/* Per-category breakdown */}
      <div className="space-y-2">
        {catData.slice(0, 6).map(({ category, siim, janne }) => {
          const meta = CATEGORY_META[category];
          const catTotal = siim + janne;
          return (
            <div key={category}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="inline-flex items-center gap-1">
                  <span className="text-[10px]">{meta.emoji}</span>
                  <span className={`text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
                </span>
                <span className="text-[10px] font-mono text-[#4a5568] tabular-nums">{fmt(catTotal)} €</span>
              </div>
              <div className="flex h-1.5 rounded-full overflow-hidden bg-white/5">
                <div className="h-full" style={{ width: `${catTotal > 0 ? (siim / catTotal) * 100 : 50}%`, background: "rgba(139, 92, 246, 0.5)" }} />
                <div className="h-full" style={{ width: `${catTotal > 0 ? (janne / catTotal) * 100 : 50}%`, background: "rgba(236, 72, 153, 0.5)" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-3 pt-2 border-t border-white/5">
        <span className="inline-flex items-center gap-1.5 text-[10px] text-[#8892b0]">
          <span className="w-2.5 h-2.5 rounded-full gradient-purple" /> Siim
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] text-[#8892b0]">
          <span className="w-2.5 h-2.5 rounded-full gradient-pink" /> Janne
        </span>
      </div>
    </div>
  );
}
