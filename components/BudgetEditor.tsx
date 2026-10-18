"use client";

import { useState, useTransition } from "react";
import { setBudget, resetAllBudgets } from "@/app/actions";
import { CATEGORIES, CATEGORY_KEYS, type CategoryKey } from "@/types/expense";
import { useToast } from "./Toast";
import { useDialog } from "./Dialog";
import CategoryIcon from "./CategoryIcon";

const TOTAL_KEY = "_total";

type Props = {
  initialTotal: number;
  initialCategories: Partial<Record<CategoryKey, number>>;
  defaultTotal: number;
  defaultCategories: Partial<Record<CategoryKey, number>>;
};

export default function BudgetEditor({
  initialTotal,
  initialCategories,
  defaultTotal,
  defaultCategories,
}: Props) {
  const [total, setTotal] = useState<string>(String(initialTotal));
  const [cats, setCats] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const k of CATEGORY_KEYS) {
      const v = initialCategories[k];
      out[k] = v != null ? String(v) : "";
    }
    return out;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const toast = useToast();
  const dialog = useDialog();

  function save(key: string, raw: string) {
    const trimmed = raw.trim();
    const amount = trimmed === "" ? null : Number(trimmed.replace(",", "."));
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      toast.showError("Budget must be a positive number");
      return;
    }
    setBusy(key);
    startTransition(async () => {
      const res = await setBudget(key, amount === 0 ? null : amount);
      if (!res.ok) toast.showError(res.error);
      setBusy(null);
    });
  }

  async function reset() {
    if (!(await dialog.confirm({ title: "Reset all budgets?", message: "Every category budget and the monthly total go back to the defaults. Past months keep their history.", confirmLabel: "Reset budgets", tone: "danger" }))) return;
    setBusy(TOTAL_KEY);
    startTransition(async () => {
      await resetAllBudgets();
      setTotal(String(defaultTotal));
      const next: Record<string, string> = {};
      for (const k of CATEGORY_KEYS) {
        const v = defaultCategories[k];
        next[k] = v != null ? String(v) : "";
      }
      setCats(next);
      setBusy(null);
    });
  }

  return (
    <div className="space-y-4">
      {/* Total */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
        <span className="text-xs font-bold text-white">Total monthly budget</span>
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="10"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            onBlur={() => save(TOTAL_KEY, total)}
            disabled={busy === TOTAL_KEY}
            className="w-24 bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1 text-xs font-mono text-amber-400 tabular-nums text-right focus:outline-none focus:border-amber-500/50 disabled:opacity-40"
          />
          <span className="text-xs text-[#5a6380]">€</span>
        </div>
      </div>

      {/* Per-category */}
      <div className="space-y-1.5">
        {CATEGORY_KEYS.map((cat) => {
          const meta = CATEGORIES[cat];
          const value = cats[cat] ?? "";
          const isDefault =
            value !== "" && Number(value) === (defaultCategories[cat] ?? -1);
          return (
            <div key={cat} className="flex items-center gap-2 py-1">
              <CategoryIcon category={cat} size={14} className="text-[#9ca3c0]" />
              <span className="text-xs font-semibold text-white/70 flex-1 truncate">
                {meta.label}
              </span>
              {isDefault && (
                <span className="hidden sm:inline text-[8px] font-bold text-[#5a6380]/60 uppercase tracking-wider" title="Matches default">
                  default
                </span>
              )}
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="10"
                  value={value}
                  placeholder="—"
                  onChange={(e) =>
                    setCats((prev) => ({ ...prev, [cat]: e.target.value }))
                  }
                  onBlur={() => save(cat, value)}
                  disabled={busy === cat}
                  className="w-24 bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1 text-xs font-mono text-white/80 tabular-nums text-right focus:outline-none focus:border-purple-500/50 disabled:opacity-40"
                />
                <span className="text-xs text-[#5a6380] w-3">€</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between items-center pt-3 border-t border-white/[0.06]">
        <p className="text-[10px] text-[#5a6380]/70">
          Edits save when you tab away. Empty = no budget for that category.
        </p>
        <button
          onClick={reset}
          className="text-[10px] text-[#5a6380] hover:text-pink-400 transition-colors"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
