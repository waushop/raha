import type { Expense } from "@/types/expense";
import ShareButton from "./ShareButton";
import CopyAmount from "./CopyAmount";
import Confetti from "./Confetti";

const fmt = (n: number) =>
  n.toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("et-EE", { month: "long", year: "numeric" });
}

export default function Summary({ expenses, month }: { expenses: Expense[]; month: string }) {
  if (expenses.length === 0) return null;

  const total = expenses.reduce((s, e) => s + e.AMOUNT, 0);

  // Shared expenses (50/50 split) - what Janne owes
  const sharedExpenses = expenses.filter(e => e.SIIM_PCT === 50);
  const sharedTotal = sharedExpenses.reduce((s, e) => s + e.AMOUNT, 0);
  const janneOwesFromShared = sharedTotal / 2;

  // Janne's personal expenses that Siim paid (SIIM_PCT = 0)
  const jannePersonalPaidBySiim = expenses.filter(e => e.SIIM_PCT === 0 && e.PAID_BY === "siim");
  const jannePersonalTotal = jannePersonalPaidBySiim.reduce((s, e) => s + e.AMOUNT, 0);

  // Total Janne owes Siim
  const janneOwesTotal = janneOwesFromShared + jannePersonalTotal;
  const isBalanced = janneOwesTotal < 0.005;

  // Siim's own expenses (not shared, not Janne's)
  const siimPersonal = total - sharedTotal - jannePersonalTotal;

  const monthLabel = formatMonthLabel(month);
  const shareText = [
    `Meie Raha - ${monthLabel}`,
    `Kokku: ${fmt(total)} €`,
    `Jagatud kulud (50/50): ${fmt(sharedTotal)} €`,
    `Siim isiklik: ${fmt(siimPersonal)} €`,
    jannePersonalTotal > 0 ? `Janne isiklik (Siim maksis): ${fmt(jannePersonalTotal)} €` : null,
    isBalanced
      ? "Arveldus puudub"
      : `Janne → Siim: ${fmt(janneOwesTotal)} €`,
  ].filter(Boolean).join("\n");

  return (
    <div className="card rounded-2xl p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg gradient-teal flex items-center justify-center shadow-lg shadow-teal-500/20">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
          </span>
          <h2 className="font-bold text-white">Arveldus</h2>
        </div>
        <ShareButton text={shareText} />
      </div>

      {/* Spending breakdown */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-3 bg-white/[0.03] border border-white/5 text-center">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#4a5568] mb-1">Jagatud</p>
          <p className="text-sm font-bold font-mono text-teal-400 tabular-nums">{fmt(sharedTotal)} €</p>
          <p className="text-[9px] text-[#4a5568] mt-0.5">{sharedExpenses.length} kulu</p>
        </div>
        <div className="rounded-xl p-3 bg-white/[0.03] border border-white/5 text-center">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#4a5568] mb-1">Siim</p>
          <p className="text-sm font-bold font-mono text-purple-400 tabular-nums">{fmt(siimPersonal)} €</p>
          <p className="text-[9px] text-[#4a5568] mt-0.5">isiklik</p>
        </div>
        <div className="rounded-xl p-3 bg-white/[0.03] border border-white/5 text-center">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#4a5568] mb-1">Janne</p>
          <p className="text-sm font-bold font-mono text-pink-400 tabular-nums">{fmt(jannePersonalTotal)} €</p>
          <p className="text-[9px] text-[#4a5568] mt-0.5">Siim maksis</p>
        </div>
      </div>

      {/* Settlement banner */}
      <Confetti trigger={isBalanced && sharedTotal > 0} />
      {isBalanced ? (
        sharedTotal > 0 ? (
          <div className="settlement-balanced rounded-xl px-5 py-3.5 text-sm font-bold text-center text-white shadow-lg shadow-teal-500/20">
            Arveldus on tasakaalus
          </div>
        ) : (
          <div className="rounded-xl px-5 py-3 text-sm text-center text-[#4a5568] bg-white/[0.02] border border-white/5">
            Jagatud kulusid sel kuul pole
          </div>
        )
      ) : (
        <div className="rounded-xl px-5 py-4 text-center bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/15 relative overflow-hidden">
          <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(circle at 50% 50%, rgba(245,158,11,0.15) 0%, transparent 70%)" }} />
          <div className="relative">
            <p className="text-[9px] text-amber-500/60 font-bold uppercase tracking-[0.2em] mb-2">Janne</p>
            <div className="flex items-center justify-center gap-3">
              <span className="text-sm font-bold text-pink-400">Janne</span>
              <div className="flex items-center">
                <div className="w-6 h-[2px] bg-amber-500/30 rounded-full" />
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500/50 -ml-1">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>
              <span className="text-sm font-bold text-purple-400">Siim</span>
            </div>
            <CopyAmount amount={janneOwesTotal} />
            {janneOwesFromShared > 0 && jannePersonalTotal > 0 && (
              <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-[#4a5568]">
                <span>50/50 osa: <span className="font-mono tabular-nums">{fmt(janneOwesFromShared)} €</span></span>
                <span>Janne isiklik: <span className="font-mono tabular-nums">{fmt(jannePersonalTotal)} €</span></span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
