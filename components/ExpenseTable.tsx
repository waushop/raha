"use client";

import { Fragment, useState, useTransition, useEffect, useCallback, useRef } from "react";
import { deleteExpense, undoDeleteExpense, copyFromPreviousMonth, duplicateExpense } from "@/app/actions";
import { useToast } from "./Toast";
import ExpenseForm from "./ExpenseForm";
import type { Expense, Category } from "@/types/expense";
import { CATEGORY_META } from "@/types/expense";
import QuickAddFab from "./QuickAddFab";
import CollapsibleCard from "./CollapsibleCard";
import SwipeRow from "./SwipeRow";

const fmt = (n: number) =>
  n.toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just nüüd";
  if (mins < 60) return `${mins} min tagasi`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h tagasi`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}p tagasi`;
  if (days < 30) return `${Math.floor(days / 7)}n tagasi`;
  return new Date(dateStr).toLocaleDateString("et-EE", { day: "numeric", month: "short" });
}

const CAT_DOT: Record<Category, string> = {
  kodu: "bg-blue-500", auto: "bg-orange-500", mootorratas: "bg-yellow-500",
  lapsed: "bg-green-500", teenused: "bg-red-500", siim: "bg-purple-500",
  janne: "bg-pink-500", muu: "bg-gray-500",
};

const CAT_BORDER: Record<Category, string> = {
  kodu: "border-blue-500/20", auto: "border-orange-500/20", mootorratas: "border-yellow-500/20",
  lapsed: "border-green-500/20", teenused: "border-red-500/20", siim: "border-purple-500/20",
  janne: "border-pink-500/20", muu: "border-gray-500/20",
};

type Props = {
  expenses: Expense[];
  month: string;
  recurringNames?: Set<string>;
};

export default function ExpenseTable({ expenses, month, recurringNames }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | undefined>();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isCopying, startCopyTransition] = useTransition();
  const toast = useToast();

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !isInput) {
        e.preventDefault();
        setEditing(undefined);
        setShowForm(true);
      }
      if (e.key === "Escape" && showForm) {
        setShowForm(false);
        setEditing(undefined);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showForm]);

  function openAdd() { setEditing(undefined); setShowForm(true); }
  function openEdit(e: Expense) { setEditing(e); setShowForm(true); }
  function closeForm() { setShowForm(false); setEditing(undefined); }

  const handleDelete = useCallback((id: string, name: string) => {
    setDeletedIds(prev => new Set(prev).add(id));
    startTransition(() => deleteExpense(id));
    navigator.vibrate?.(10);
    toast.show(`"${name}" kustutatud`, {
      label: "Tagasi",
      onClick: () => {
        setDeletedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
        startTransition(() => undoDeleteExpense(id));
      },
    });
  }, [toast]);

  function handleCopy() {
    startCopyTransition(async () => {
      const count = await copyFromPreviousMonth(month);
      toast.show(`${count} kulu kopeeritud eelmisest kuust`);
    });
  }

  const handleDuplicate = useCallback((id: string) => {
    startTransition(async () => {
      await duplicateExpense(id, month);
      toast.show("Kulu dupleeritud");
    });
  }, [month, toast]);

  const visible = expenses.filter(e => !deletedIds.has(e.ID));

  // Group by category, sort by total descending
  const grouped: { category: Category; items: Expense[] }[] = [];
  const catMap = new Map<Category, Expense[]>();
  const catOrder: Category[] = [];
  for (const e of visible) {
    if (!catMap.has(e.CATEGORY)) { catMap.set(e.CATEGORY, []); catOrder.push(e.CATEGORY); }
    catMap.get(e.CATEGORY)!.push(e);
  }
  catOrder.sort((a, b) => {
    const totalA = catMap.get(a)!.reduce((s, e) => s + e.AMOUNT, 0);
    const totalB = catMap.get(b)!.reduce((s, e) => s + e.AMOUNT, 0);
    return totalB - totalA;
  });
  for (const cat of catOrder) {
    const items = catMap.get(cat)!.sort((a, b) => b.AMOUNT - a.AMOUNT);
    grouped.push({ category: cat, items });
  }

  return (
    <div className="space-y-4">
      {/* Empty state */}
      {expenses.length === 0 && !showForm && (
        <div className="card rounded-2xl p-10 sm:p-14 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="text-5xl animate-gentle-pulse">
              {["💰", "🏦", "📊", "💸", "🪙"][Math.floor(Date.now() / 86400000) % 5]}
            </div>
            <div>
              <p className="text-sm text-[#8892b0] font-medium">
                {["Selle kuu kulud puuduvad", "Puhas leht!", "Uus kuu, uued kulud"][Math.floor(Date.now() / 86400000) % 3]}
              </p>
              <p className="text-xs text-[#4a5568] mt-1">Lisa esimene kulu või kopeeri eelmisest kuust</p>
            </div>
            <div className="flex gap-3 mt-2">
              <button onClick={openAdd} className="px-5 py-2.5 rounded-xl gradient-pink text-white text-sm font-bold shadow-lg shadow-pink-500/20 btn-press hover:opacity-90 transition-opacity">
                Lisa kulu
              </button>
              <button onClick={handleCopy} disabled={isCopying} className="px-5 py-2.5 rounded-xl border border-white/10 text-[#8892b0] text-sm font-medium hover:bg-white/5 hover:text-white transition-all btn-press disabled:opacity-50">
                {isCopying ? "Kopeerib..." : "Kopeeri eelmisest kuust"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category cards + settlement box */}
      {grouped.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {grouped.map(({ category, items }) => {
            const meta = CATEGORY_META[category];
            const catTotal = items.reduce((s, e) => s + e.AMOUNT, 0);
            return (
              <CollapsibleCard
                key={category}
                className={`card rounded-2xl overflow-hidden border-t-2 ${CAT_BORDER[category]} animate-fade-in cat-card-hover`}
                header={
                  <>
                    <span className="inline-flex items-center gap-2">
                      <span className="text-sm leading-none">{meta.emoji}</span>
                      <span className={`text-sm font-bold ${meta.color}`}>{meta.label}</span>
                      <span className="text-[10px] text-[#4a5568] font-medium bg-white/5 rounded-full px-1.5 py-0.5">{items.length}</span>
                    </span>
                    <span className="text-sm font-mono font-bold text-white/60 tabular-nums">{fmt(catTotal)} €</span>
                  </>
                }
              >
                <div className="divide-y divide-white/[0.03]">
                  {items.map((e) => (
                    <SwipeRow
                      key={e.ID}
                      onSwipeLeft={() => handleDelete(e.ID, e.NAME)}
                      onSwipeRight={() => openEdit(e)}
                    >
                      <ExpenseRow expense={e} catTotal={catTotal} catColor={CAT_DOT[category]} onEdit={openEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} isRecurring={recurringNames?.has(e.NAME)} />
                    </SwipeRow>
                  ))}
                </div>
              </CollapsibleCard>
            );
          })}

          {/* Settlement card */}
          <SettlementCard expenses={visible} />
        </div>
      )}

      {/* Total bar */}
      {visible.length > 0 && (
        <div className="card rounded-2xl px-4 sm:px-5 py-3 flex items-center justify-between">
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#8892b0]">Kokku</span>
          <span className="text-sm font-mono font-bold text-white tabular-nums">
            {fmt(visible.reduce((s, e) => s + e.AMOUNT, 0))} €
          </span>
        </div>
      )}

      {/* Add button */}
      {!showForm && visible.length > 0 && (
        <button onClick={openAdd} className="w-full py-3 sm:py-3.5 rounded-2xl border border-dashed border-white/10 text-[#4a5568] text-sm font-medium hover:border-pink-500/30 hover:text-pink-400 hover:bg-white/[0.02] transition-all btn-press group">
          <span className="inline-flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="group-hover:rotate-90 transition-transform duration-200">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Lisa kulu
            <kbd className="hidden sm:inline text-[10px] text-[#4a5568] bg-white/5 rounded px-1.5 py-0.5 font-mono ml-1">N</kbd>
          </span>
        </button>
      )}

      {/* Mobile FAB */}
      {!showForm && visible.length > 0 && <QuickAddFab onAdd={openAdd} />}

      {/* Form */}
      {showForm && (
        <>
          <div className="sm:hidden fixed inset-0 bg-black/60 z-40 animate-backdrop" onClick={closeForm} />
          <div className="sm:card fixed inset-x-0 bottom-0 z-50 sm:relative sm:inset-auto sm:z-auto bg-[#1f2940] sm:bg-transparent rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 max-h-[85vh] sm:max-h-none overflow-y-auto animate-slide-up sm:animate-fade-in border-t border-white/10 sm:border shadow-2xl sm:shadow-none">
            <div className="sm:hidden w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
            <h3 className="font-bold text-white mb-5 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg gradient-pink flex items-center justify-center shadow-lg shadow-pink-500/20">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </span>
              {editing ? "Muuda kulu" : "Lisa uus kulu"}
            </h3>
            <ExpenseForm month={month} editing={editing} onDone={closeForm} />
          </div>
        </>
      )}
    </div>
  );
}

function ExpenseRow({ expense: e, catTotal, catColor, onEdit, onDelete, onDuplicate, isRecurring }: {
  expense: Expense;
  catTotal: number;
  catColor: string;
  onEdit: (e: Expense) => void;
  onDelete: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  isRecurring?: boolean;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onTouchStart() {
    longPressTimer.current = setTimeout(() => {
      navigator.vibrate?.(15);
      onEdit(e);
    }, 500);
  }
  function onTouchEnd() { if (longPressTimer.current) clearTimeout(longPressTimer.current); }
  function onTouchMove() { if (longPressTimer.current) clearTimeout(longPressTimer.current); }

  const pct = catTotal > 0 ? (e.AMOUNT / catTotal) * 100 : 0;

  return (
    <div
      className="px-4 py-2.5 flex items-center gap-2 row-hover group relative overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
    >
      <div className={`absolute inset-y-0 left-0 ${catColor} opacity-[0.04] transition-all duration-500`} style={{ width: `${pct}%` }} />
      <div className="flex-1 min-w-0 relative">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/90 truncate inline-flex items-center gap-1.5">
            {e.NAME}
            {isRecurring && (
              <span title="Korduv">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400/50 shrink-0">
                  <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
                  <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
                </svg>
              </span>
            )}
          </span>
          <span className="text-sm font-mono font-semibold text-white/80 ml-2 shrink-0 tabular-nums">{fmt(e.AMOUNT)} €</span>
        </div>
      </div>
      <div className="flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0 relative">
        <button onClick={() => onDuplicate(e.ID)} className="w-7 h-7 rounded-lg hover:bg-teal-500/10 flex items-center justify-center text-[#4a5568] hover:text-teal-400 transition-colors" aria-label="Dubleeri">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        </button>
        <button onClick={() => onEdit(e)} className="w-7 h-7 rounded-lg hover:bg-purple-500/10 flex items-center justify-center text-[#4a5568] hover:text-purple-400 transition-colors" aria-label="Muuda">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button onClick={() => onDelete(e.ID, e.NAME)} className="w-7 h-7 rounded-lg hover:bg-red-500/10 flex items-center justify-center text-[#4a5568] hover:text-red-400 transition-colors" aria-label="Kustuta">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function SettlementCard({ expenses }: { expenses: Expense[] }) {
  const lapsedTotal = expenses.filter(e => e.CATEGORY === "lapsed").reduce((s, e) => s + e.AMOUNT, 0);
  const teenusedTotal = expenses.filter(e => e.CATEGORY === "teenused").reduce((s, e) => s + e.AMOUNT, 0);
  const janneTotal = expenses.filter(e => e.CATEGORY === "janne").reduce((s, e) => s + e.AMOUNT, 0);

  const janneOwes = (lapsedTotal + teenusedTotal) / 2 + janneTotal;
  const siimOwes = expenses.reduce((s, e) => s + e.AMOUNT, 0) - janneOwes;

  if (janneOwes < 0.01 && siimOwes < 0.01) return null;

  return (
    <div className="card rounded-2xl overflow-hidden border-t-2 border-teal-500/20 animate-fade-in">
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <span className="inline-flex items-center gap-2">
          <span className="text-sm leading-none">💶</span>
          <span className="text-sm font-bold text-teal-400">Arveldus</span>
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#8892b0]">Siim</span>
          <span className="text-sm font-mono font-bold text-purple-400 tabular-nums">{fmt(siimOwes)} €</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#8892b0]">Janne</span>
          <span className="text-sm font-mono font-bold text-pink-400 tabular-nums">{fmt(janneOwes)} €</span>
        </div>
        {janneOwes > 0.01 && (
          <div className="border-t border-white/5 pt-3 text-center">
            <p className="text-[9px] text-[#4a5568] uppercase tracking-widest font-bold mb-1">Janne</p>
            <p className="text-lg font-bold font-mono text-amber-400 tabular-nums">{fmt(janneOwes)} €</p>
          </div>
        )}
      </div>
    </div>
  );
}
