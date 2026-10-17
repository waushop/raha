"use client";

import { useState, useTransition, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { deleteExpense, undoDeleteExpense, copyFromPreviousMonth, copyRecurringToMonth, duplicateExpense, toggleRecurring, bulkUpdateExpenses, bulkDeleteExpenses, createImportPattern } from "@/app/actions";
import { useToast } from "./Toast";
import ExpenseForm from "./ExpenseForm";
import type { CategoryKey, Expense, ExpenseGroup } from "@/types/expense";
import { CATEGORIES, CATEGORY_KEYS, GROUP_COLOR_CLASSES } from "@/types/expense";
import { OPEN_ADD_EVENT } from "./BottomNav";
import CollapsibleCard from "./CollapsibleCard";
import SwipeRow from "./SwipeRow";
import InlineAmount from "./InlineAmount";
import CategoryIcon from "./CategoryIcon";
import Glyph from "./Glyph";
import { DEFAULT_GROUP_ICON } from "@/lib/icon-names";
import { literalPattern } from "@/lib/rules";
import type { AddPrefill } from "@/lib/add-link";
import { Banknote, CalendarArrowDown, Check, Copy, ListChecks, Plus, Repeat, Split, SquarePen, Tag, Target, Trash2, Wallet, Wand2, X } from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
  /** Planned vs actual per group (GROUP_ID, "" for none) from /plan; drawn as a thin bar under the header. */
  plan?: Record<string, { planned: number; actual: number }>;
  expenses: Expense[];
  month: string;
  groups: ExpenseGroup[];
  /** Household members (shared workspaces only) for the payer picker and badges. */
  members?: Array<{ ID: string; NAME: string }>;
  /** From the /add deep link: open the add form straight away with these values. */
  addPrefill?: AddPrefill;
};

type BulkPatch = Parameters<typeof bulkUpdateExpenses>[1];

// Row id from a `#e-<id>` deep link (search, activity, dashboard link here).
// External store rather than state-in-effect: hydration-safe and lint-clean.
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
// True after hydration; portals need document.body, which the server lacks.
const noopSubscribe = () => () => {};

function readHashId(): string | null {
  const h = window.location.hash;
  return h.startsWith("#e-") ? h.slice(3) : null;
}

const barSelectCls = "h-11 min-w-0 border border-white/[0.08] rounded-xl px-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all disabled:opacity-40";
const barBtnCls = "h-11 inline-flex items-center justify-center gap-1.5 px-3 rounded-xl border text-xs font-semibold transition-all btn-press disabled:opacity-40";

export default function ExpenseTable({ expenses, month, groups, plan = {}, members = [], addPrefill }: Props) {
  const [showForm, setShowForm] = useState(!!addPrefill);
  // The deep-link values apply to the first form only; "n" or the + button later opens a blank one.
  const [prefill, setPrefill] = useState<AddPrefill | undefined>(addPrefill);
  const [editing, setEditing] = useState<Expense | undefined>();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const [isCopying, startCopyTransition] = useTransition();
  const toast = useToast();
  const hashId = useSyncExternalStore(subscribeHash, readHashId, () => null);
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // Selection mode: checkboxes on every row, bulk bar at the bottom.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isBulkPending, startBulkTransition] = useTransition();
  const [bulkTags, setBulkTags] = useState("");
  const [bulkMonth, setBulkMonth] = useState(month);
  // "Create rule" popover for one row.
  const [ruleFor, setRuleFor] = useState<Expense | undefined>();

  useEffect(() => {
    if (!hashId) return;
    document.getElementById(`e-${hashId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [hashId]);

  // Drop ?add=1&… from the address bar so a reload doesn't reopen the form.
  useEffect(() => {
    if (addPrefill) window.history.replaceState(null, "", `/?month=${month}`);
  }, [addPrefill, month]);

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
      if (e.key === "Escape" && ruleFor) { setRuleFor(undefined); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showForm, ruleFor]);

  function openAdd() { setEditing(undefined); setShowForm(true); }
  function openEdit(e: Expense) { setEditing(e); setShowForm(true); }
  function closeForm() { setShowForm(false); setEditing(undefined); setPrefill(undefined); }

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

  const toggleSelected = useCallback((id: string) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  function exitSelectMode() { setSelectMode(false); setSelected(new Set()); }

  function runBulk(patch: BulkPatch) {
    const ids = [...selected];
    if (ids.length === 0) return;
    startBulkTransition(async () => {
      const res = await bulkUpdateExpenses(ids, patch);
      if (!res.ok) { toast.showError(res.error); return; }
      navigator.vibrate?.(10);
      setSelected(new Set());
      setBulkTags("");
      toast.show(`${res.changed} row${res.changed === 1 ? "" : "s"} updated`);
    });
  }
  function runBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    startBulkTransition(async () => {
      const res = await bulkDeleteExpenses(ids);
      if (!res.ok) { toast.showError(res.error); return; }
      navigator.vibrate?.(10);
      setDeletedIds(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
      setSelected(new Set());
      toast.show(`${res.changed} row${res.changed === 1 ? "" : "s"} deleted`);
    });
  }

  const visible = expenses.filter(e => !deletedIds.has(e.ID));
  const income = visible.filter(e => e.KIND === "income");
  const spending = visible.filter(e => e.KIND !== "income");
  const spentTotal = spending.reduce((s, e) => s + e.AMOUNT, 0);
  const incomeTotal = income.reduce((s, e) => s + e.AMOUNT, 0);
  const selectedCount = visible.filter(e => selected.has(e.ID)).length;
  const allSelected = visible.length > 0 && selectedCount === visible.length;

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

  const payerName = (id: string | null | undefined) => (id ? members.find((m) => m.ID === id)?.NAME ?? null : null);
  const rowProps = { payerName, highlighted: false, onEdit: openEdit, onDelete: handleDelete, onDuplicate: handleDuplicate, onToggleRecurring: handleToggleRecurring, onCreateRule: setRuleFor, selectable: selectMode, onToggleSelect: toggleSelected };

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

      {/* Toolbar: selection toggle */}
      {visible.length > 0 && (
        <div className="flex items-center justify-end gap-2 -mb-1">
          {selectMode && (
            <button
              onClick={() => setSelected(allSelected ? new Set() : new Set(visible.map(e => e.ID)))}
              className="h-9 px-3 rounded-lg text-xs font-semibold text-[#9ca3c0] hover:text-white hover:bg-white/5 transition-all btn-press"
            >
              {allSelected ? "Select none" : `Select all (${visible.length})`}
            </button>
          )}
          <button
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            aria-pressed={selectMode}
            className={`h-9 inline-flex items-center gap-1.5 px-3 rounded-lg border text-xs font-semibold transition-all btn-press ${
              selectMode ? "border-purple-500/40 bg-purple-500/10 text-purple-300" : "border-white/[0.06] text-[#5a6380] hover:text-[#9ca3c0] hover:border-white/15"
            }`}
          >
            {selectMode ? <X size={13} /> : <ListChecks size={13} />}
            {selectMode ? "Done" : "Select"}
          </button>
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
                <ExpenseRow expense={e} {...rowProps} highlighted={e.ID === hashId} selected={selected.has(e.ID)} />
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
                      <ExpenseRow expense={e} {...rowProps} highlighted={e.ID === hashId} selected={selected.has(e.ID)} />
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

      {/* Bulk action bar: sticky above the mobile bottom bar, like Toast / ScrollToTop */}
      {selectMode && selectedCount > 0 && createPortal(
        <div className="fixed bottom-20 lg:bottom-6 left-3 right-3 lg:left-[20.5rem] lg:right-6 z-40 animate-fade-up pointer-events-none" role="region" aria-label="Bulk actions">
          <div className="max-w-4xl mx-auto panel border border-white/[0.1] rounded-2xl shadow-[0_16px_60px_rgba(0,0,0,0.6)] p-3 pointer-events-auto">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-bold text-white">
                <span className="font-mono tabular-nums text-purple-300">{selectedCount}</span> selected
              </span>
              <button onClick={() => setSelected(new Set())} className="h-9 px-3 rounded-lg text-xs font-semibold text-[#9ca3c0] hover:text-white hover:bg-white/5 transition-all btn-press inline-flex items-center gap-1">
                <X size={12} /> Clear
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value=""
                disabled={isBulkPending}
                onChange={(e) => { if (e.target.value) runBulk({ category: e.target.value }); }}
                aria-label="Set category"
                className={`${barSelectCls} flex-1 basis-[9rem]`}
              >
                <option value="" className="panel">Category…</option>
                {CATEGORY_KEYS.map((key) => <option key={key} value={key} className="panel">{CATEGORIES[key].label}</option>)}
              </select>
              <select
                value=""
                disabled={isBulkPending}
                onChange={(e) => { if (e.target.value) runBulk({ groupId: e.target.value === "__none__" ? null : e.target.value }); }}
                aria-label="Set group"
                className={`${barSelectCls} flex-1 basis-[9rem]`}
              >
                <option value="" className="panel">Group…</option>
                <option value="__none__" className="panel">No group</option>
                {groups.map((g) => <option key={g.ID} value={g.ID} className="panel">{g.NAME}</option>)}
              </select>
              <form onSubmit={(e) => { e.preventDefault(); runBulk({ tags: bulkTags.trim() || null }); }} className="flex items-center gap-1 flex-1 basis-[12rem] min-w-0">
                <input
                  value={bulkTags}
                  onChange={(e) => setBulkTags(e.target.value)}
                  disabled={isBulkPending}
                  placeholder="#tags (empty clears)"
                  aria-label="Set tags"
                  className="h-11 flex-1 min-w-0 border border-white/[0.08] rounded-xl px-3 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all placeholder:text-[#5a6380] disabled:opacity-40"
                />
                <button type="submit" disabled={isBulkPending} className={`${barBtnCls} border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20`} aria-label="Apply tags">
                  <Tag size={13} /> Apply
                </button>
              </form>
              <button onClick={() => runBulk({ isRecurring: true })} disabled={isBulkPending} className={`${barBtnCls} border-teal-500/30 text-teal-400 hover:bg-teal-500/10`}>
                <Repeat size={13} strokeWidth={2.5} /> Recurring
              </button>
              <button onClick={() => runBulk({ isRecurring: false })} disabled={isBulkPending} className={`${barBtnCls} border-white/[0.08] text-[#9ca3c0] hover:bg-white/5 hover:text-white`}>
                Not recurring
              </button>
              <form onSubmit={(e) => { e.preventDefault(); if (bulkMonth) runBulk({ month: bulkMonth }); }} className="flex items-center gap-1 basis-[13rem] min-w-0">
                <input
                  type="month"
                  value={bulkMonth}
                  onChange={(e) => setBulkMonth(e.target.value)}
                  disabled={isBulkPending}
                  aria-label="Move to month"
                  className={`${barSelectCls} flex-1 font-mono tabular-nums [color-scheme:dark]`}
                />
                <button type="submit" disabled={isBulkPending || !bulkMonth || bulkMonth === month} className={`${barBtnCls} border-blue-500/30 text-blue-300 hover:bg-blue-500/10`} aria-label="Move to month">
                  <CalendarArrowDown size={13} /> Move
                </button>
              </form>
              <button onClick={runBulkDelete} disabled={isBulkPending} className={`${barBtnCls} border-red-500/30 text-red-400 hover:bg-red-500/10 ml-auto`}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {ruleFor && createPortal(
        <RuleDialog expense={ruleFor} groups={groups} onClose={() => setRuleFor(undefined)} />,
        document.body
      )}

      {showForm && mounted && createPortal(
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
              <ExpenseForm month={month} editing={editing} prefill={editing ? undefined : prefill} groups={groups} members={members} onDone={closeForm} />
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

// "Create rule from this row": a small dialog prefilled from the row. The
// rule then categorises matching imports and renames manual entries.
function RuleDialog({ expense: e, groups, onClose }: { expense: Expense; groups: ExpenseGroup[]; onClose: () => void }) {
  const [pattern, setPattern] = useState(literalPattern(e.NAME));
  const [category, setCategory] = useState<CategoryKey>(e.CATEGORY);
  const [groupId, setGroupId] = useState(e.GROUP_ID ?? "");
  const [rename, setRename] = useState(e.NAME);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const inputCls = "w-full border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all placeholder:text-[#5a6380]";

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    startTransition(async () => {
      const res = await createImportPattern(pattern, category, groupId || null, { setName: rename.trim() || null });
      if (!res.ok) { toast.showError(res.error); return; }
      navigator.vibrate?.(10);
      toast.show("Rule created");
      onClose();
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center p-4 pt-16 sm:pt-4 pointer-events-none">
        <form onSubmit={submit} className="rounded-2xl p-5 w-full max-w-sm pointer-events-auto animate-fade-up panel border border-white/[0.08] shadow-[0_24px_80px_rgba(0,0,0,0.6)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-white flex items-center gap-2"><Wand2 size={15} className="text-purple-400" /> Create rule</h3>
            <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-[#5a6380] hover:text-white transition-colors"><X size={16} /></button>
          </div>
          <p className="text-[11px] text-[#5a6380]">Imports and quick entries whose text matches the pattern get this category, group and name.</p>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Pattern <span className="normal-case tracking-normal font-medium text-[#5a6380]/60">(regex, case-insensitive)</span></span>
            <input value={pattern} onChange={(ev) => setPattern(ev.target.value)} required className={`${inputCls} font-mono`} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Category</span>
              <select value={category} onChange={(ev) => setCategory(ev.target.value as CategoryKey)} className={inputCls}>
                {CATEGORY_KEYS.map((key) => <option key={key} value={key} className="panel">{CATEGORIES[key].label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Group</span>
              <select value={groupId} onChange={(ev) => setGroupId(ev.target.value)} className={inputCls}>
                <option value="" className="panel">No group</option>
                {groups.map((g) => <option key={g.ID} value={g.ID} className="panel">{g.NAME}</option>)}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Rename to <span className="normal-case tracking-normal font-medium text-[#5a6380]/60">(optional)</span></span>
            <input value={rename} onChange={(ev) => setRename(ev.target.value)} placeholder="Keep the original name" className={inputCls} />
          </label>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={isPending || !pattern.trim()} className="flex-1 gradient-pink text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all btn-press shadow-lg shadow-pink-500/20">
              {isPending ? "Saving..." : "Create rule"}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-medium border border-white/[0.08] rounded-xl text-[#9ca3c0] hover:bg-white/5 hover:text-white transition-all btn-press">Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}

function ExpenseRow({ expense: e, payerName, highlighted, onEdit, onDelete, onDuplicate, onToggleRecurring, onCreateRule, selectable, selected, onToggleSelect }: {
  expense: Expense;
  payerName: (id: string | null | undefined) => string | null;
  highlighted: boolean;
  onEdit: (e: Expense) => void;
  onDelete: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onToggleRecurring: (id: string, name: string, current: boolean) => void;
  onCreateRule: (e: Expense) => void;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onTouchStart() { longPressTimer.current = setTimeout(() => { navigator.vibrate?.(15); onEdit(e); }, 500); }
  function onTouchEnd() { if (longPressTimer.current) clearTimeout(longPressTimer.current); }
  function onTouchMove() { if (longPressTimer.current) clearTimeout(longPressTimer.current); }

  const cat = CATEGORIES[e.CATEGORY] ?? CATEGORIES.other;

  return (
    <div id={`e-${e.ID}`} className={`px-4 py-2.5 flex items-center gap-2.5 row-hover group scroll-mt-24 ${highlighted ? "row-highlight" : ""} ${selected ? "bg-purple-500/[0.08]" : ""}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchMove={onTouchMove}>
      {selectable && (
        // 44px hit area; touch/click stop here so neither long-press edit nor swipe fires.
        <label
          className="w-11 h-11 -my-2 -ml-3 shrink-0 flex items-center justify-center cursor-pointer"
          onClick={(ev) => ev.stopPropagation()}
          onTouchStart={(ev) => ev.stopPropagation()}
          onTouchMove={(ev) => ev.stopPropagation()}
          onTouchEnd={(ev) => ev.stopPropagation()}
        >
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect(e.ID)} aria-label={`Select ${e.NAME}`} className="sr-only peer" />
          <span className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-purple-500/50 ${selected ? "bg-purple-500 border-purple-400 text-white" : "border-white/20 bg-white/5 text-transparent"}`} aria-hidden>
            <Check size={13} strokeWidth={3} />
          </span>
        </label>
      )}
      <CategoryIcon category={e.CATEGORY} size={16} className="text-[#9ca3c0]" title={cat.label} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/90 truncate inline-flex items-center gap-1.5">
            {e.DAY !== null && e.DAY !== undefined && (
              <span className="text-[9px] font-mono tabular-nums text-[#5a6380] bg-white/5 rounded px-1 shrink-0" title={`Day ${e.DAY}`}>{e.DAY}</span>
            )}
            {e.NAME}
            {payerName(e.PAID_BY) && <span className="text-[9px] font-bold shrink-0 w-4 h-4 rounded-full bg-pink-500/15 text-pink-300 inline-flex items-center justify-center" title={`Paid by ${payerName(e.PAID_BY)}`}>{payerName(e.PAID_BY)!.slice(0, 1).toUpperCase()}</span>}
            {e.GOAL_ID && <span className="text-[10px] shrink-0 inline-flex" title="Counts towards a goal"><Target size={10} className="text-purple-400 shrink-0" aria-hidden /></span>}
            {e.SPLIT_GROUP && <span className="text-[10px] shrink-0 inline-flex" title="Part of a split"><Split size={10} className="text-amber-400 shrink-0" aria-hidden /></span>}
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
        <button onClick={() => onCreateRule(e)} className="w-7 h-7 rounded-lg hover:bg-amber-500/10 flex items-center justify-center text-[#5a6380] hover:text-amber-400 transition-colors" aria-label="Create rule" title="Create rule from this row">
          <Wand2 size={11} />
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
