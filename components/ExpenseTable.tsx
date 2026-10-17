"use client";

import { useState, useTransition, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { deleteExpense, undoDeleteExpense, copyFromPreviousMonth, copyRecurringToMonth, duplicateExpense, toggleRecurring } from "@/app/actions";
import { useToast } from "./Toast";
import ExpenseForm from "./ExpenseForm";
import type { Expense, ExpenseGroup } from "@/types/expense";
import { CATEGORIES, GROUP_COLOR_CLASSES } from "@/types/expense";
import { OPEN_ADD_EVENT } from "./BottomNav";
import CollapsibleCard from "./CollapsibleCard";
import SwipeRow from "./SwipeRow";
import InlineAmount from "./InlineAmount";
import CategoryIcon from "./CategoryIcon";
import Glyph from "./Glyph";
import { DEFAULT_GROUP_ICON } from "@/lib/icon-names";
import { Banknote, Copy, Plus, Repeat, SquarePen, Target, Trash2, Wallet, X } from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
  /** Planned vs actual per group (GROUP_ID, "" for none) from /plan; drawn as a thin bar under the header. */
  plan?: Record<string, { planned: number; actual: number }>;
  expenses: Expense[];
  month: string;
  groups: ExpenseGroup[];
};

// Row id from a `#e-<id>` deep link (search, activity, dashboard link here).
// External store rather than state-in-effect: hydration-safe and lint-clean.
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
function readHashId(): string | null {
  const h = window.location.hash;
  return h.startsWith("#e-") ? h.slice(3) : null;
}

export default function ExpenseTable({ expenses, month, groups, plan = {} }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | undefined>();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const [isCopying, startCopyTransition] = useTransition();
  const toast = useToast();
  const hashId = useSyncExternalStore(subscribeHash, readHashId, () => null);

  useEffect(() => {
    if (!hashId) return;
    document.getElementById(`e-${hashId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [hashId]);

  useEffect(() => {
    function onOpenAdd() { setEditing(undefined); setShowForm(true); }
    window.addEventListener(OPEN_ADD_EVENT, onOpenAdd);
    return () => window.removeEventListener(OPEN_ADD_EVENT, onOpenAdd);
  }, []);

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
  type Section = { groupId: string | null; name: string; icon: string | null; color: string; items: Expense[]; total: number };
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
    sections.push({ groupId: g.ID, name: g.NAME, icon: g.ICON, color: g.COLOR, items, total: items.reduce((s, e) => s + e.AMOUNT, 0) });
    buckets.delete(g.ID);
  }
  const ungrouped = buckets.get("__none__");
  if (ungrouped?.length) {
    ungrouped.sort((a, b) => b.AMOUNT - a.AMOUNT);
    sections.push({ groupId: null, name: "Ungrouped", icon: DEFAULT_GROUP_ICON, color: "gray", items: ungrouped, total: ungrouped.reduce((s, e) => s + e.AMOUNT, 0) });
  }
  sections.sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-4">
      {expenses.length === 0 && !showForm && (
        <div className="card rounded-2xl p-10 sm:p-14 text-center">
          <div className="flex flex-col items-center gap-4">
            <Wallet size={48} strokeWidth={1.25} className="mx-auto text-[#5a6380] animate-gentle-pulse" aria-hidden />
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
              <Banknote size={14} className="text-teal-400" aria-hidden />
              <span className="text-sm font-bold text-teal-400">Income</span>
              <span className="text-[10px] text-[#5a6380] bg-white/5 rounded-full px-1.5 py-0.5">{income.length}</span>
            </span>
            <span className="text-sm font-mono font-bold text-teal-400/80 tabular-nums">+{fmt(incomeTotal)} €</span>
          </>}
        >
          <div className="divide-y divide-white/[0.04]">
            {[...income].sort((a, b) => b.AMOUNT - a.AMOUNT).map(e => (
              <SwipeRow key={e.ID} onSwipeLeft={() => handleDelete(e.ID, e.NAME)} onSwipeRight={() => openEdit(e)}>
                <ExpenseRow expense={e} highlighted={e.ID === hashId} onEdit={openEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onToggleRecurring={handleToggleRecurring} />
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
                    <Glyph name={s.icon} size={16} className={colors.text} />
                    <span className={`text-sm font-bold ${colors.text}`}>{s.name}</span>
                    <span className="text-[10px] text-[#5a6380] bg-white/5 rounded-full px-1.5 py-0.5">{s.items.length}</span>
                  </span>
                  <span className="text-right">
                    <span className="text-sm font-mono font-bold text-white/60 tabular-nums">{fmt(s.total)} €</span>
                    {plan[s.groupId ?? ""] && plan[s.groupId ?? ""].planned > 0 && (
                      <span className="block mt-1 w-24 ml-auto" title={`Planned ${fmt(plan[s.groupId ?? ""].planned)} €`}>
                        <span className="block h-1 rounded-full bg-white/5 overflow-hidden">
                          <span className={`block h-full rounded-full ${s.total > plan[s.groupId ?? ""].planned ? "bg-red-500" : "bg-gradient-to-r from-pink-500 to-purple-500"}`} style={{ width: `${Math.min(100, (s.total / plan[s.groupId ?? ""].planned) * 100)}%` }} />
                        </span>
                        <span className={`block text-[9px] font-mono tabular-nums ${s.total > plan[s.groupId ?? ""].planned ? "text-red-400" : "text-[#5a6380]"}`}>of {fmt(plan[s.groupId ?? ""].planned)} planned</span>
                      </span>
                    )}
                  </span>
                </>}
              >
                <div className="divide-y divide-white/[0.04]">
                  {s.items.map(e => (
                    <SwipeRow key={e.ID} onSwipeLeft={() => handleDelete(e.ID, e.NAME)} onSwipeRight={() => openEdit(e)}>
                      <ExpenseRow expense={e} highlighted={e.ID === hashId} onEdit={openEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onToggleRecurring={handleToggleRecurring} />
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
            <Plus size={16} className="group-hover:rotate-90 transition-transform duration-200" />
            Add expense <kbd className="hidden sm:inline text-[10px] text-[#5a6380] bg-white/5 rounded px-1.5 py-0.5 font-mono ml-1">N</kbd>
          </span>
        </button>
      )}


      {showForm && createPortal(
        <>
          <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={closeForm} />
          <div className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center p-4 pt-16 sm:pt-4 pointer-events-none">
            <div className="rounded-2xl p-5 sm:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto pointer-events-auto animate-fade-up panel border border-white/[0.08] shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold text-white flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg gradient-pink flex items-center justify-center shadow-lg shadow-pink-500/20">
                    <Plus size={14} strokeWidth={2.5} className="text-white" />
                  </span>
                  {editing ? "Edit expense" : "Add expense"}
                </h3>
                <button onClick={closeForm} className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-[#5a6380] hover:text-white transition-colors">
                  <X size={16} />
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

function ExpenseRow({ expense: e, highlighted, onEdit, onDelete, onDuplicate, onToggleRecurring }: {
  expense: Expense;
  highlighted: boolean;
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
    <div id={`e-${e.ID}`} className={`px-4 py-2.5 flex items-center gap-2.5 row-hover group scroll-mt-24 ${highlighted ? "row-highlight" : ""}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchMove={onTouchMove}>
      <CategoryIcon category={e.CATEGORY} size={16} className="text-[#9ca3c0]" title={cat.label} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/90 truncate inline-flex items-center gap-1.5">
            {e.DAY !== null && e.DAY !== undefined && (
              <span className="text-[9px] font-mono tabular-nums text-[#5a6380] bg-white/5 rounded px-1 shrink-0" title={`Day ${e.DAY}`}>{e.DAY}</span>
            )}
            {e.NAME}
            {e.GOAL_ID && <span className="text-[10px] shrink-0 inline-flex" title="Counts towards a goal"><Target size={10} className="text-purple-400 shrink-0" aria-hidden /></span>}
            {e.IS_RECURRING === 1 && (
              <Repeat size={10} strokeWidth={2.5} className="text-teal-400/50 shrink-0" />
            )}
          </span>
          <span className="ml-2 shrink-0"><InlineAmount expenseId={e.ID} amount={e.AMOUNT} tone={e.KIND === "income" ? "income" : "expense"} /></span>
        </div>
        {e.NOTES && <p className="text-[10px] text-[#5a6380] mt-0.5 truncate">{e.NOTES}</p>}
      </div>
      <div className="flex gap-0.5 row-actions shrink-0">
        <button onClick={() => onToggleRecurring(e.ID, e.NAME, e.IS_RECURRING === 1)} className={`w-7 h-7 rounded-lg hidden sm:flex items-center justify-center transition-colors ${e.IS_RECURRING ? "text-teal-400/60" : "text-[#5a6380]"} hover:text-teal-400 hover:bg-teal-500/10`} aria-label="Recurring">
          <Repeat size={11} strokeWidth={2.5} />
        </button>
        <button onClick={() => onDuplicate(e.ID)} className="w-7 h-7 rounded-lg hover:bg-purple-500/10 hidden sm:flex items-center justify-center text-[#5a6380] hover:text-purple-400 transition-colors" aria-label="Duplicate">
          <Copy size={11} />
        </button>
        <button onClick={() => onEdit(e)} className="w-7 h-7 rounded-lg hover:bg-blue-500/10 flex items-center justify-center text-[#5a6380] hover:text-blue-400 transition-colors" aria-label="Edit">
          <SquarePen size={11} />
        </button>
        <button onClick={() => onDelete(e.ID, e.NAME)} className="w-7 h-7 rounded-lg hover:bg-red-500/10 flex items-center justify-center text-[#5a6380] hover:text-red-400 transition-colors" aria-label="Delete">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}
