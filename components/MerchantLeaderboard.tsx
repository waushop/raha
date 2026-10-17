import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import CategoryIcon from "@/components/CategoryIcon";
import type { MerchantEntry, MerchantLeaderboard as Leaderboard } from "@/lib/reports";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = { board: Leaderboard };

function DeltaChip({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-white/5 text-[#5a6380] shrink-0 w-14 text-center">new</span>;
  }
  const up = pct > 0.5;
  const down = pct < -0.5;
  const cls = up ? "bg-red-500/10 text-red-400" : down ? "bg-teal-500/10 text-teal-400" : "bg-white/5 text-[#9ca3c0]";
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : null;
  return (
    <span className={`inline-flex items-center justify-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 w-14 tabular-nums ${cls}`}>
      {Icon && <Icon size={10} strokeWidth={2.5} />}
      {pct > 0 ? "+" : ""}{Math.round(pct)}%
    </span>
  );
}

function Row({ e, i, mode }: { e: MerchantEntry; i: number; mode: "spend" | "count" }) {
  const delta = mode === "spend" ? e.deltaPct : e.countDeltaPct;
  const titleBase = mode === "spend"
    ? `${fmt(e.amount)} € in the last 3 months vs ${fmt(e.prevAmount)} € in the 3 before`
    : `${e.count} purchases in the last 3 months vs ${e.prevCount} in the 3 before`;
  return (
    <Link
      href={`/search?q=${encodeURIComponent(e.name)}`}
      title={titleBase}
      className="flex items-center gap-2 rounded-lg -mx-1 px-1 py-0.5 hover:bg-white/5 transition-colors"
    >
      <span className="text-[10px] font-bold text-[#5a6380] w-4 text-right shrink-0">{i + 1}</span>
      <CategoryIcon category={e.category} size={14} className="text-[#9ca3c0]" />
      <span className="text-xs text-white/80 truncate flex-1 min-w-0">{e.name}</span>
      <span className="text-[10px] text-[#5a6380] tabular-nums shrink-0">{e.count}×</span>
      <span className="text-xs font-mono text-white/60 tabular-nums shrink-0">{fmt(e.amount)} €</span>
      <DeltaChip pct={delta} />
    </Link>
  );
}

/** Top merchants over the last three full months, ranked two ways. */
export default function MerchantLeaderboard({ board }: Props) {
  if (board.bySpend.length === 0) {
    return <p className="text-xs text-[#5a6380]">No expenses in the last three full months.</p>;
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div>
        <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-2">By spend</p>
        <div className="space-y-1">
          {board.bySpend.map((e, i) => <Row key={e.name} e={e} i={i} mode="spend" />)}
        </div>
      </div>
      <div>
        <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-2">By visits</p>
        <div className="space-y-1">
          {board.byCount.map((e, i) => <Row key={e.name} e={e} i={i} mode="count" />)}
        </div>
      </div>
    </div>
  );
}
