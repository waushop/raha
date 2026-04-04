"use client";

import { useRef, useState, useTransition, useEffect } from "react";
import { createExpense, updateExpense, getRecentNames } from "@/app/actions";
import type { Expense, Category } from "@/types/expense";
import { CATEGORIES, CATEGORY_META } from "@/types/expense";

type Props = { month: string; editing?: Expense; onDone: () => void };

const CAT_RING: Record<Category, string> = {
  kodu:        "peer-checked:border-blue-500/50 peer-checked:bg-blue-500/10 peer-checked:text-blue-400",
  auto:        "peer-checked:border-orange-500/50 peer-checked:bg-orange-500/10 peer-checked:text-orange-400",
  mootorratas: "peer-checked:border-yellow-500/50 peer-checked:bg-yellow-500/10 peer-checked:text-yellow-400",
  lapsed:      "peer-checked:border-green-500/50 peer-checked:bg-green-500/10 peer-checked:text-green-400",
  teenused:    "peer-checked:border-red-500/50 peer-checked:bg-red-500/10 peer-checked:text-red-400",
  siim:        "peer-checked:border-purple-500/50 peer-checked:bg-purple-500/10 peer-checked:text-purple-400",
  janne:       "peer-checked:border-pink-500/50 peer-checked:bg-pink-500/10 peer-checked:text-pink-400",
  muu:         "peer-checked:border-gray-500/50 peer-checked:bg-gray-500/10 peer-checked:text-gray-400",
};

// Default split per category:
// - lapsed = 50/50 (shared kid expenses)
// - janne = 0% Siim (Janne owes back)
// - everything else = 100% Siim (his own expense)
function defaultSplit(cat: Category): { siimPct: number; paidBy: "siim" | "janne" } {
  if (cat === "lapsed") return { siimPct: 50, paidBy: "siim" };
  if (cat === "janne") return { siimPct: 0, paidBy: "siim" };
  return { siimPct: 100, paidBy: "siim" };
}

// Is this a shared category (where split toggle matters)?
function isSharedCategory(cat: Category): boolean {
  return cat === "lapsed" || cat === "teenused" || cat === "muu";
}

export default function ExpenseForm({ month, editing, onDone }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<Category>(editing?.CATEGORY ?? "muu");
  const [shared, setShared] = useState(editing ? editing.SIIM_PCT === 50 : isSharedCategory(category));
  const [suggestions, setSuggestions] = useState<{ NAME: string; AMOUNT: number }[]>([]);
  const [isPending, startTransition] = useTransition();

  // Compute actual siim_pct and paid_by from category + shared toggle
  const { siimPct, paidBy } = (() => {
    if (category === "janne") return { siimPct: 0, paidBy: "siim" as const };
    if (category === "siim" || category === "kodu" || category === "auto" || category === "mootorratas") {
      return { siimPct: 100, paidBy: "siim" as const };
    }
    // Shared categories: lapsed, teenused, muu
    return shared ? { siimPct: 50, paidBy: "siim" as const } : { siimPct: 100, paidBy: "siim" as const };
  })();

  // Auto-focus name input
  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 100);
  }, []);

  // Fetch suggestions when category changes
  useEffect(() => {
    if (editing) return;
    getRecentNames(category).then(setSuggestions);
  }, [category, editing]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data = new FormData(formRef.current!);
    data.set("paid_by", paidBy);
    data.set("siim_pct", String(siimPct));
    startTransition(async () => {
      if (editing) {
        await updateExpense(editing.ID, data);
      } else {
        await createExpense(data);
      }
      navigator.vibrate?.(10);
      onDone();
    });
  }

  function applySuggestion(name: string, amount: number) {
    if (nameRef.current) nameRef.current.value = name;
    if (amountRef.current) amountRef.current.value = amount.toString();
  }

  function handleCategoryChange(cat: Category) {
    setCategory(cat);
    // Auto-set shared toggle based on category
    if (isSharedCategory(cat)) {
      setShared(true);
    } else {
      setShared(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="month" value={month} />

      {/* Category picker */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a5568]">Kategooria</label>
        <div className="flex gap-1.5 overflow-x-auto stats-scroll sm:grid sm:grid-cols-4 sm:gap-1.5 pb-1 sm:pb-0">
          {CATEGORIES.map((cat) => (
            <label key={cat} className="relative shrink-0 sm:shrink">
              <input
                type="radio"
                name="category"
                value={cat}
                checked={category === cat}
                onChange={() => handleCategoryChange(cat)}
                className="peer sr-only"
              />
              <div className={`border border-white/10 rounded-lg px-2.5 sm:px-1.5 py-1.5 text-[11px] text-center font-semibold cursor-pointer transition-all text-[#8892b0] hover:border-white/20 whitespace-nowrap ${CAT_RING[cat]}`}>
                <span className="mr-0.5">{CATEGORY_META[cat].emoji}</span> {CATEGORY_META[cat].label}
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Name suggestions */}
      {suggestions.length > 0 && !editing && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.slice(0, 8).map((s) => (
            <button
              key={s.NAME}
              type="button"
              onClick={() => applySuggestion(s.NAME, s.AMOUNT)}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 text-[#8892b0] hover:bg-white/10 hover:text-white transition-all border border-white/5"
            >
              {s.NAME}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a5568]">Nimetus</label>
          <input
            ref={nameRef}
            name="name"
            required
            defaultValue={editing?.NAME}
            placeholder="nt. Eelkool, Spordiring..."
            className="border border-white/10 rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/40 transition-all placeholder:text-[#4a5568]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a5568]">Summa (€)</label>
          <input
            ref={amountRef}
            name="amount"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={editing?.AMOUNT}
            placeholder="0.00"
            className="border border-white/10 rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/40 transition-all placeholder:text-[#4a5568] font-mono tabular-nums"
          />
        </div>
      </div>

      {/* Shared toggle - only for categories where it matters */}
      {isSharedCategory(category) && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a5568]">Jaotus</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setShared(true)}
              className={`border rounded-xl px-4 py-2 text-sm text-center font-semibold transition-all ${
                shared
                  ? "border-teal-500/50 bg-teal-500/10 text-teal-400"
                  : "border-white/10 text-[#8892b0] hover:border-white/20"
              }`}
            >
              Jagatud
            </button>
            <button
              type="button"
              onClick={() => setShared(false)}
              className={`border rounded-xl px-4 py-2 text-sm text-center font-semibold transition-all ${
                !shared
                  ? "border-purple-500/50 bg-purple-500/10 text-purple-400"
                  : "border-white/10 text-[#8892b0] hover:border-white/20"
              }`}
            >
              Ainult minu
            </button>
          </div>
        </div>
      )}

      {/* Info line showing what will be saved */}
      <div className="text-[10px] text-[#4a5568] flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${siimPct === 50 ? "bg-teal-500" : siimPct === 0 ? "bg-pink-500" : "bg-purple-500"}`} />
        {siimPct === 50 ? "Jagatud Jannega 50/50" : siimPct === 0 ? "Janne kulu (Janne võlgneb)" : "Sinu isiklik kulu"}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 gradient-pink text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all btn-press shadow-lg shadow-pink-500/20"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Salvestab...
            </span>
          ) : editing ? "Salvesta" : "Lisa"}
        </button>
        <button type="button" onClick={onDone} className="px-5 py-2.5 text-sm font-medium border border-white/10 rounded-xl text-[#8892b0] hover:bg-white/5 hover:text-white transition-all btn-press">
          Tühista
        </button>
      </div>
    </form>
  );
}
