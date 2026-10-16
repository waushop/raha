"use client";

import { useTransition } from "react";
import { createExpense } from "@/app/actions";
import { useToast } from "./Toast";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES } from "@/types/expense";
import { currentMonth, monthKey } from "@/lib/months";

type Preset = {
  NAME: string;
  AMOUNT: number;
  CATEGORY: CategoryKey;
};

type Props = {
  presets: Preset[];
  month: string;
};

export default function QuickAddBar({ presets, month }: Props) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  if (presets.length === 0) return null;

  function quickAdd(preset: Preset) {
    const data = new FormData();
    data.set("category", preset.CATEGORY);
    data.set("name", preset.NAME);
    data.set("amount", preset.AMOUNT.toString());
    data.set("month", month);
    if (month === currentMonth()) {
      const now = new Date();
      data.set("date", `${monthKey(now)}-${String(now.getDate()).padStart(2, "0")}`);
    }

    startTransition(async () => {
      const res = await createExpense(data);
      if (!res.ok) { toast.showError(res.error); return; }
      navigator.vibrate?.(10);
      toast.show(`"${preset.NAME}" added`);
    });
  }

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="card rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a6380" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Quick add</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p, i) => {
          const meta = CATEGORIES[p.CATEGORY] ?? CATEGORIES.other;
          return (
            <button
              key={`${p.NAME}-${i}`}
              onClick={() => quickAdd(p)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/[0.06] text-xs font-medium text-[#9ca3c0] hover:bg-white/10 hover:text-white hover:border-white/10 transition-all btn-press disabled:opacity-50"
            >
              <span className="text-[10px]">{meta.icon}</span>
              <span>{p.NAME}</span>
              <span className="text-[10px] text-[#5a6380] font-mono tabular-nums">{fmt(p.AMOUNT)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
