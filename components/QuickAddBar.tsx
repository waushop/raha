"use client";

import { useState, useTransition } from "react";
import { createExpense } from "@/app/actions";
import { useToast } from "./Toast";
import type { CategoryKey } from "@/types/expense";
import { currentMonth, monthKey } from "@/lib/months";
import { parseQuickAdd } from "@/lib/quickadd";
import { CornerDownLeft, Zap } from "lucide-react";
import CategoryIcon from "./CategoryIcon";

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
  const [text, setText] = useState("");
  const toast = useToast();

  function baseForm(category: CategoryKey, name: string, amount: number): FormData {
    const data = new FormData();
    data.set("category", category);
    data.set("name", name);
    data.set("amount", amount.toString());
    data.set("month", month);
    if (month === currentMonth()) {
      const now = new Date();
      data.set("date", `${monthKey(now)}-${String(now.getDate()).padStart(2, "0")}`);
    }
    return data;
  }

  function quickAdd(preset: Preset) {
    const data = baseForm(preset.CATEGORY, preset.NAME, preset.AMOUNT);
    startTransition(async () => {
      const res = await createExpense(data);
      if (!res.ok) { toast.showError(res.error); return; }
      navigator.vibrate?.(10);
      toast.show(`"${preset.NAME}" added`);
    });
  }

  // "coffee 3.5 #work" → one row. The category comes from a preset with the
  // same name when there is one; otherwise "other" (the edit modal fixes it).
  function submitTyped() {
    const parsed = parseQuickAdd(text);
    if (!parsed) { toast.showError("Type a name and an amount, e.g. coffee 3.5"); return; }
    const preset = presets.find((p) => p.NAME.toLowerCase() === parsed.name.toLowerCase());
    const data = baseForm(preset?.CATEGORY ?? "other", parsed.name, parsed.amount);
    data.set("kind", parsed.kind);
    data.set("tags", parsed.tags ?? "");
    startTransition(async () => {
      const res = await createExpense(data);
      if (!res.ok) { toast.showError(res.error); return; }
      navigator.vibrate?.(10);
      setText("");
      toast.show(`"${parsed.name}" added`);
    });
  }

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="card rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={14} className="text-[#5a6380]" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Quick add</span>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); submitTyped(); }}
        className="flex items-center gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={isPending}
          placeholder="coffee 3.5 #work"
          aria-label="Quick add: name, amount and optional #tags"
          autoComplete="off"
          enterKeyHint="done"
          className="flex-1 min-w-0 border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/40 transition-all placeholder:text-[#5a6380] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isPending || !text.trim()}
          aria-label="Add"
          title="Add (Enter)"
          className="shrink-0 w-11 h-11 rounded-xl gradient-pink text-white flex items-center justify-center shadow-lg shadow-pink-500/20 btn-press hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          <CornerDownLeft size={16} strokeWidth={2.5} />
        </button>
      </form>
      <p className="text-[10px] text-[#5a6380] mt-1.5">
        Name, amount and <span className="font-mono">#tags</span> in any order; <span className="font-mono">+2850 salary</span> adds income.
      </p>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {presets.map((p, i) => {
            return (
              <button
                key={`${p.NAME}-${i}`}
                onClick={() => quickAdd(p)}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/[0.06] text-xs font-medium text-[#9ca3c0] hover:bg-white/10 hover:text-white hover:border-white/10 transition-all btn-press disabled:opacity-50"
              >
                <CategoryIcon category={p.CATEGORY} size={14} />
                <span>{p.NAME}</span>
                <span className="text-[10px] text-[#5a6380] font-mono tabular-nums">{fmt(p.AMOUNT)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
