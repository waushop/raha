"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markRecurringByName } from "@/app/actions";
import { useToast } from "./Toast";
import type { RecurringCandidate } from "@/lib/queries";
import { Repeat } from "lucide-react";
import CategoryIcon from "./CategoryIcon";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function RecurringSuggestions({ candidates }: { candidates: RecurringCandidate[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const visible = candidates.filter((c) => !done.has(c.NAME));
  if (visible.length === 0) return null;

  function mark(name: string) {
    startTransition(async () => {
      const n = await markRecurringByName(name);
      setDone((d) => new Set(d).add(name));
      toast.show(`"${name}" marked recurring (${n} row${n === 1 ? "" : "s"})`);
      router.refresh();
    });
  }

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Repeat size={14} strokeWidth={2.5} className="text-[#a78bfa]" />
        <h2 className="text-sm font-bold text-white">Looks recurring</h2>
      </div>
      <p className="text-[10px] text-[#5a6380] mb-3">Seen in 3+ of the last 4 months but not marked recurring.</p>
      <div className="space-y-2">
        {visible.map((c) => {
          return (
            <div key={c.NAME} className="flex items-center gap-2">
              <CategoryIcon category={c.CATEGORY} size={14} className="text-[#9ca3c0]" />
              <span className="text-xs text-white/80 flex-1 truncate">{c.NAME}</span>
              <span className="text-[10px] text-[#5a6380] tabular-nums shrink-0">{c.MONTHS}× · ~{fmt(c.AVG_AMOUNT)} €</span>
              <button onClick={() => mark(c.NAME)} disabled={isPending}
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 disabled:opacity-50 transition-all btn-press shrink-0">
                Mark
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
