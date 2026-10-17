import { ArrowRight, Users } from "lucide-react";
import type { Settlement } from "@/lib/settle";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Month view card for households: paid vs equal share per member and the
// transfers that square it.
export default function SettleUpCard({ settlement, monthLabel }: { settlement: Settlement; monthLabel: string }) {
  const name = (id: string) => settlement.members.find((m) => m.userId === id)?.name ?? "?";
  if (settlement.members.length < 2) return null;
  return (
    <div className="card rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Users size={14} className="text-pink-400" />
        <h2 className="text-sm font-bold text-white">Settle up · {monthLabel}</h2>
        <span className="ml-auto text-[10px] text-[#5a6380]">{fmt(settlement.total)} € split {settlement.members.length} ways</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
        {settlement.members.map((m) => (
          <div key={m.userId} className="surface rounded-xl p-3">
            <p className="text-xs font-semibold text-white/90 truncate">{m.name}</p>
            <p className="text-[10px] text-[#5a6380]">paid <span className="font-mono text-white/80">{fmt(m.paid)} €</span> · share {fmt(m.share)} €</p>
            <p className={`text-sm font-mono font-bold tabular-nums ${m.net > 0.005 ? "text-teal-400" : m.net < -0.005 ? "text-red-400" : "text-[#9ca3c0]"}`}>{m.net > 0 ? "+" : ""}{fmt(m.net)} €</p>
          </div>
        ))}
      </div>
      {settlement.transfers.length === 0 ? (
        <p className="text-xs text-teal-400">All square — nobody owes anything.</p>
      ) : (
        <ul className="space-y-1">
          {settlement.transfers.map((t, i) => (
            <li key={i} className="text-xs text-white/90 inline-flex items-center gap-1.5">
              <span className="font-semibold">{name(t.from)}</span> owes <span className="font-semibold">{name(t.to)}</span>
              <ArrowRight size={11} className="text-[#5a6380]" />
              <span className="font-mono font-bold text-pink-400">{fmt(t.amount)} €</span>
            </li>
          ))}
        </ul>
      )}
      {settlement.unassigned > 0 && <p className="text-[10px] text-[#5a6380] mt-2">{fmt(settlement.unassigned)} € has no payer recorded and is left out of the split.</p>}
    </div>
  );
}
