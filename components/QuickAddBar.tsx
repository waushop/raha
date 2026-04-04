"use client";

import { useTransition } from "react";
import { createExpense } from "@/app/actions";
import { useToast } from "./Toast";
import type { Category } from "@/types/expense";
import { CATEGORY_META } from "@/types/expense";

type Preset = {
  NAME: string;
  AMOUNT: number;
  CATEGORY: Category;
  PAID_BY: "siim" | "janne";
  SIIM_PCT: number;
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
    data.set("paid_by", preset.PAID_BY);
    data.set("siim_pct", preset.SIIM_PCT.toString());
    data.set("month", month);

    startTransition(async () => {
      await createExpense(data);
      navigator.vibrate?.(10);
      toast.show(`"${preset.NAME}" lisatud`);
    });
  }

  const fmt = (n: number) =>
    n.toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="card rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#4a5568]">Kiirvalik</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p, i) => {
          const meta = CATEGORY_META[p.CATEGORY];
          return (
            <button
              key={`${p.NAME}-${i}`}
              onClick={() => quickAdd(p)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-xs font-medium text-[#8892b0] hover:bg-white/10 hover:text-white hover:border-white/10 transition-all btn-press disabled:opacity-50"
            >
              <span className="text-[10px]">{meta.emoji}</span>
              <span>{p.NAME}</span>
              <span className="text-[10px] text-[#4a5568] font-mono tabular-nums">{fmt(p.AMOUNT)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
