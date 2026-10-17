"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { useToast } from "./Toast";
import CategoryIcon from "./CategoryIcon";
import { markSubscriptionPaid } from "@/app/subscriptions/actions";
import { monthLabel } from "@/lib/months";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type UpcomingItem = { id: string; name: string; category: string; date: string; amount: number };

function relative(iso: string, today: string): string {
  const days = Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  const d = new Date(iso + "T00:00:00Z");
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()}`;
}

export default function UpcomingBills({ items, today }: { items: UpcomingItem[]; today: string }) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function pay(item: UpcomingItem) {
    startTransition(async () => {
      const res = await markSubscriptionPaid(item.id, item.date);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(`${item.name} recorded in ${monthLabel(res.month, "short")}`);
      navigator.vibrate?.(10);
    });
  }

  if (items.length === 0) {
    return <p className="text-xs text-[#5a6380] px-4 py-3">Nothing due in the next 30 days.</p>;
  }
  return (
    <div className="divide-y divide-white/[0.04]">
      {items.map((it, i) => {
        const month = it.date.slice(0, 7);
        const header = month !== today.slice(0, 7) && (i === 0 || items[i - 1].date.slice(0, 7) !== month);
        return (
          <div key={`${it.id}-${it.date}`}>
            {header && <div className="px-4 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-[#5a6380]">{monthLabel(month, "long")}</div>}
            <div className="px-4 py-2.5 flex items-center gap-3 row-hover">
              <span className="w-14 shrink-0 text-[11px] font-mono text-[#9ca3c0] tabular-nums">{relative(it.date, today)}</span>
              <CategoryIcon category={it.category} size={14} className="text-[#5a6380]" />
              <span className="flex-1 min-w-0 text-sm text-white/90 truncate">{it.name}</span>
              <span className="text-sm font-mono font-bold text-white/80 tabular-nums">{fmt(it.amount)} €</span>
              <button
                onClick={() => pay(it)}
                disabled={isPending}
                title="Record this charge"
                className="inline-flex items-center gap-1 text-[10px] font-bold rounded-lg px-2 py-1 bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 transition-colors disabled:opacity-50"
              >
                <Check size={11} strokeWidth={3} /> Paid
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
