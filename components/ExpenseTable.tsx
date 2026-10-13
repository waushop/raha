"use client";

import { useState, useTransition, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { deleteExpense, undoDeleteExpense, copyFromPreviousMonth, copyRecurringToMonth, duplicateExpense, toggleRecurring } from "@/app/actions";
import { useToast } from "./Toast";
import ExpenseForm from "./ExpenseForm";
import type { Expense, ExpenseGroup } from "@/types/expense";
import { CATEGORIES, GROUP_COLOR_CLASSES } from "@/types/expense";
import QuickAddFab from "./QuickAddFab";
import CollapsibleCard from "./CollapsibleCard";
import SwipeRow from "./SwipeRow";
import InlineAmount from "./InlineAmount";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
  expenses: Expense[];
  month: string;
  groups: ExpenseGroup[];
};

export default function ExpenseTable({ expenses, month, groups }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | undefined>();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const [isCopying, startCopyTransition] = useTransition();
  const toast = useToast();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !isInput) { e.preventDefault(); setEditing(undefined); setShowForm(true); }
      if (e.key === "Escape" && showForm) { setShowForm(false); setEditing(undefined); }
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
    toast.show(`"${name}" deleted`, {
      label: "Undo",
      onClick: () => {
        setDeletedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
        startTransition(() => undoDeleteExpense(id));
      },
    });
  }, [toast]);

  function handleCopy() {
    startCopyTransition(async () => { const count = await copyFromPreviousMonth(month); toast.show(`${count} expenses copied`); });
  }
  function handleCopyRecurring() {
    startCopyTransition(async () => { const count = await copyRecurringToMonth(month); toast.show(count > 0 ? `${count} recurring expenses added` : "All already added"); });
  }
  const handleDuplicate = useCallback((id: string) => {
    startTransition(async () => { await duplicateExpense(id, month); toast.show("Duplicated"); });
  }, [month, toast]);
  const handleToggleRecurring = useCallback((id: string, name: string, current: boolean) => {
    startTransition(async () => { await toggleRecurring(id); toast.show(current ? `"${name}" is no longer recurring` : `"${name}" marked as recurring`); });
  }, [toast]);

  const visible = expenses.filter(e => !deletedIds.has(e.ID));
  const income = visible.filter(e => e.KIND === "income");
  const spending = visible.filter(e => e.KIND !== "income");
  const spentTotal = spending.reduce((s, e) => s + e.AMOUNT, 0);
  const incomeTotal = income.reduce((s, e) => s + e.AMOUNT, 0);

  // Group spending by GROUP_ID; income gets its own card below
  type Section = { groupId: string | null; name: string; emoji: string | null; color: string; items: Expense[]; total: number };
  const sections: Section[] = [];
  const buckets = new Map<string, Expense[]>();
  for (const e of spending) {
    const key = e.GROUP_ID ?? "__none__";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
  }
  for (const g of groups) {
    const items = buckets.get(g.ID);
    if (!items) continue;
    items.sort((a, b) => b.AMOUNT - a.AMOUNT);
    sections.push({ groupId: g.ID, name: g.NAME, emoji: g.EMOJI, color: g.COLOR, items, total: items.reduce((s, e) => s + e.AMOUNT, 0) });
    buckets.delete(g.ID);
  }
  const ungrouped = buckets.get("__none__");
  if (ungrouped?.length) {
    ungrouped.sort((a, b) => b.AMOUNT - a.AMOUNT);
    sections.push({ groupId: null, name: "Ungrouped", emoji: "📦", color: "gray", items: ungrouped, total: ungrouped.reduce((s, e) => s + e.AMOUNT, 0) });
  }
  sections.sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-4">
      {expenses.length === 0 && !showForm && (
        <div className="card rounded-2xl p-10 sm:p-14 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="text-5xl animate-gentle-pulse">💸</div>
            <div>
              <p className="text-sm text-[#9ca3c0] font-medium">No expenses this month</p>
              <p className="text-xs text-[#5a6380] mt-1">Add an expense or copy from last month</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              <button onClick={openAdd} className="px-5 py-2.5 rounded-xl gradient-pink text-white text-sm font-bold shadow-lg shadow-pink-500/20 btn-press hover:opacity-90 transition-opacity">Add expense</button>
              <button onClick={handleCopyRecurring} disabled={isCopying} className="px-4 py-2.5 rounded-xl border border-teal-500/20 text-teal-400 text-sm font-medium hover:bg-teal-500/10 transition-all btn-press disabled:opacity-50">{isCopying ? "..." : "Add recurring"}</button>
              <button onClick={handleCopy} disabled={isCopying} className="px-4 py-2.5 rounded-xl border border-white/10 text-[#9ca3c0] text-sm font-medium hover:bg-white/5 hover:text-white transition-all btn-press disabled:opacity-50">{isCopying ? "..." : "Copy last month"}</button>
            </div>
          </div>
        </div>
      )}

      {income.length > 0 && (
        <CollapsibleCard
          className="card rounded-2xl overflow-hidden border-t-2 border-teal-500/30 animate-fade-in cat-card-hover"
          header={<>
            <span className="inline-flex items-center gap-2">
              <span className="text-sm">💵</span>
              <span className="text-sm font-bold text-teal-400">Income</span>
              <span className="text-[10px] text-[#5a6380] bg-white/5 rounded-full px-1.5 py-0.5">{income.length}</span>
            </span>
            <span className="text-sm font-mono font-bold text-teal-400/80 tabular-nums">+{fmt(incomeTotal)} €</span>
          </>}
        >
          <div className="divide-y divide-white/[0.04]">
            {[...income].sort((a, b) => b.AMOUNT - a.AMOUNT).map(e => (
              <SwipeRow key={e.ID} onSwipeLeft={() => handleDelete(e.ID, e.NAME)} onSwipeRight={() => openEdit(e)}>
                <ExpenseRow expense={e} onEdit={openEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onToggleRecurring={handleToggleRecurring} />
              </SwipeRow>
            ))}
          </div>
        </CollapsibleCard>
      )}

      {sections.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {sections.map((s) => {
            const colors = GROUP_COLOR_CLASSES[s.color] ?? GROUP_COLOR_CLASSES.blue;
            return (
              <CollapsibleCard
                key={s.groupId ?? "none"}
                className={`card rounded-2xl overflow-hidden border-t-2 ${colors.border} animate-fade-in cat-card-hover`}
                header={<>
                  <span className="inline-flex items-center gap-2">
                    {s.emoji && <span className="text-sm">{s.emoji}</span>}
                    <span className={`text-sm font-bold ${colors.text}`}>{s.name}</span>
                    <span className="text-[10px] text-[#5a6380] bg-white/5 rounded-full px-1.5 py-0.5">{s.items.length}</span>
                  </span>
                  <span className="text-sm font-mono font-bold text-white/60 tabular-nums">{fmt(s.total)} €</span>
                </>}
              >
                <div className="divide-y divide-white/[0.04]">
                  {s.items.map(e => (
                    <SwipeRow key={e.ID} onSwipeLeft={() => handleDelete(e.ID, e.NAME)} onSwipeRight={() => openEdit(e)}>
                      <ExpenseRow expense={e} onEdit={openEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onToggleRecurring={handleToggleRecurring} />
                    </SwipeRow>
                  ))}
                </div>
              </CollapsibleCard>
            );
          })}
        </div>
      )}

      {visible.length > 0 && income.length === 0 && (
        <div className="card rounded-2xl px-4 sm:px-5 py-3 flex items-center justify-between">
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#9ca3c0]">Total</span>
          <span className="text-sm font-mono font-bold text-white tabular-nums">{fmt(spentTotal)} €</span>
        </div>
      )}

      {visible.length > 0 && income.length > 0 && (
        <div className="card rounded-2xl px-4 sm:px-5 py-3 grid grid-cols-3 gap-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380]">Spent</p>
            <p className="text-sm font-mono font-bold text-white tabular-nums">{fmt(spentTotal)} €</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380]">Income</p>
            <p className="text-sm font-mono font-bold text-teal-400 tabular-nums">+{fmt(incomeTotal)} €</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380]">Net</p>
            <p className={`text-sm font-mono font-bold tabular-nums ${incomeTotal - spentTotal >= 0 ? "text-teal-400" : "text-red-400"}`}>{incomeTotal - spentTotal >= 0 ? "+" : "−"}{fmt(Math.abs(incomeTotal - spentTotal))} €</p>
          </div>
        </div>
      )}

      {!showForm && visible.length > 0 && (
        <button onClick={openAdd} className="w-full py-3 rounded-2xl border border-dashed border-white/10 text-[#5a6380] text-sm font-medium hover:border-pink-500/30 hover:text-pink-400 hover:bg-white/[0.02] transition-all btn-press group">
          <span className="inline-flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="group-hover:rotate-90 transition-transform duration-200"><path d="M8 3v10M3 8h10" /></svg>
            Add expense <kbd className="hidden sm:inline text-[10px] text-[#5a6380] bg-white/5 rounded px-1.5 py-0.5 font-mono ml-1">N</kbd>
          </span>
        </button>
      )}

      {!showForm && visible.length > 0 && <QuickAddFab onAdd={openAdd} />}

      {showForm && createPortal(
        <>
          <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={closeForm} />
          <div className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center p-4 pt-16 sm:pt-4 pointer-events-none">
            <div className="rounded-2xl p-5 sm:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto pointer-events-auto animate-fade-up bg-[#1c2237] border border-white/[0.08] shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-white flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg gradient-pink flex items-center justify-center shadow-lg shadow-pink-500/20">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
                  </span>
                  {editing ? "Edit expense" : "Add expense"}
                </h3>
                <button onClick={closeForm} className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-[#5a6380] hover:text-white transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
              <ExpenseForm month={month} editing={editing} groups={groups} onDone={closeForm} />
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

function ExpenseRow({ expense: e, onEdit, onDelete, onDuplicate, onToggleRecurring }: {
  expense: Expense;
  onEdit: (e: Expense) => void;
  onDelete: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onToggleRecurring: (id: string, name: string, current: boolean) => void;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onTouchStart() { longPressTimer.current = setTimeout(() => { navigator.vibrate?.(15); onEdit(e); }, 500); }
  function onTouchEnd() { if (longPressTimer.current) clearTimeout(longPressTimer.current); }
  function onTouchMove() { if (longPressTimer.current) clearTimeout(longPressTimer.current); }

  const cat = CATEGORIES[e.CATEGORY] ?? CATEGORIES.other;

  return (
    <div className="px-4 py-2.5 flex items-center gap-2.5 row-hover group" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchMove={onTouchMove}>
      <span className="text-base leading-none shrink-0" title={cat.label}>{cat.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/90 truncate inline-flex items-center gap-1.5">
            {e.NAME}
            {e.IS_RECURRING === 1 && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400/50 shrink-0">
                <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
              </svg>
            )}
          </span>
          <span className="ml-2 shrink-0"><InlineAmount expenseId={e.ID} amount={e.AMOUNT} tone={e.KIND === "income" ? "income" : "expense"} /></span>
        </div>
        {e.NOTES && <p className="text-[10px] text-[#5a6380] mt-0.5 truncate">{e.NOTES}</p>}
      </div>
      <div className="flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={() => onToggleRecurring(e.ID, e.NAME, e.IS_RECURRING === 1)} className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${e.IS_RECURRING ? "text-teal-400/60" : "text-[#5a6380]"} hover:text-teal-400 hover:bg-teal-500/10`} aria-label="Korduv">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" /></svg>
        </button>
        <button onClick={() => onDuplicate(e.ID)} className="w-7 h-7 rounded-lg hover:bg-purple-500/10 flex items-center justify-center text-[#5a6380] hover:text-purple-400 transition-colors" aria-label="Dubleeri">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
        </button>
        <button onClick={() => onEdit(e)} className="w-7 h-7 rounded-lg hover:bg-blue-500/10 flex items-center justify-center text-[#5a6380] hover:text-blue-400 transition-colors" aria-label="Muuda">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
        </button>
        <button onClick={() => onDelete(e.ID, e.NAME)} className="w-7 h-7 rounded-lg hover:bg-red-500/10 flex items-center justify-center text-[#5a6380] hover:text-red-400 transition-colors" aria-label="Kustuta">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
        </button>
      </div>
    </div>
  );
}
