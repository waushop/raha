"use client";

import { useRef, useState, useTransition, useEffect } from "react";
import { createExpense, updateExpense, getRecentNames, createGroup, getTags, getGoalOptions } from "@/app/actions";
import { currentMonth, monthKey } from "@/lib/months";
import { formatTags, parseTags } from "@/lib/tags";
import type { Expense, CategoryKey, ExpenseGroup, Kind } from "@/types/expense";
import { CATEGORIES, CATEGORY_KEYS, GROUP_COLORS, GROUP_COLOR_CLASSES } from "@/types/expense";
import { useToast } from "./Toast";

type Props = { month: string; editing?: Expense; groups: ExpenseGroup[]; onDone: () => void };

export default function ExpenseForm({ month, editing, groups, onDone }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>(editing?.KIND ?? "expense");
  const [category, setCategory] = useState<CategoryKey>(editing?.CATEGORY ?? "other");
  const [groupId, setGroupId] = useState<string>(editing?.GROUP_ID ?? "");
  const [isRecurring, setIsRecurring] = useState(editing?.IS_RECURRING === 1);
  const [showExtra, setShowExtra] = useState(!!editing?.NOTES || !!editing?.TAGS);
  const [tags, setTags] = useState(editing?.TAGS ?? "");
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [goalId, setGoalId] = useState<string>(editing?.GOAL_ID ?? "");
  const [goalOptions, setGoalOptions] = useState<{ ID: string; NAME: string; EMOJI: string | null }[]>([]);
  const showGoals = category === "savings" || !!goalId;
  // Default the date to today when adding to the current month; otherwise
  // leave it blank (the row then has a month but no day).
  const today = new Date();
  const defaultDate = editing
    ? (editing.DAY ? `${editing.MONTH}-${String(editing.DAY).padStart(2, "0")}` : "")
    : (month === currentMonth() ? `${monthKey(today)}-${String(today.getDate()).padStart(2, "0")}` : "");
  const [suggestions, setSuggestions] = useState<{ NAME: string; AMOUNT: number }[]>([]);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  // Inline "+ New" group: null = closed, string = the name being typed.
  // Created groups are kept locally so they show up before the page revalidates.
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const [localGroups, setLocalGroups] = useState<ExpenseGroup[]>([]);
  const [isCreatingGroup, startGroupTransition] = useTransition();
  const allGroups = [...groups, ...localGroups.filter((l) => !groups.some((g) => g.ID === l.ID))];

  function submitNewGroup() {
    const name = newGroupName?.trim();
    if (!name) return;
    const color = GROUP_COLORS[allGroups.length % GROUP_COLORS.length];
    const fd = new FormData();
    fd.set("name", name); fd.set("emoji", "📦"); fd.set("color", color);
    startGroupTransition(async () => {
      const res = await createGroup(fd);
      if (!res.ok) { toast.showError(res.error); return; }
      setLocalGroups((p) => [...p, { ID: res.id, NAME: name, EMOJI: "📦", COLOR: color, SORT_ORDER: allGroups.length }]);
      setGroupId(res.id);
      setNewGroupName(null);
    });
  }

  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 100); }, []);
  useEffect(() => { if (!editing) getRecentNames(category, kind).then(setSuggestions); }, [category, kind, editing]);
  useEffect(() => { if (showGoals) getGoalOptions().then(setGoalOptions).catch(() => {}); }, [showGoals]);
  useEffect(() => { if (showExtra) getTags().then((rows) => setTagOptions(rows.map((r) => r.TAG))).catch(() => {}); }, [showExtra]);

  function toggleTag(tag: string) {
    const current = parseTags(tags);
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    setTags(formatTags(next) ?? "");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data = new FormData(formRef.current!);
    data.set("kind", kind);
    data.set("is_recurring", isRecurring ? "1" : "0");
    data.set("tags", tags || "");
    data.set("group_id", groupId || "");
    data.set("goal_id", showGoals ? goalId : "");
    startTransition(async () => {
      const res = editing ? await updateExpense(editing.ID, data) : await createExpense(data);
      if (!res.ok) { toast.showError(res.error); return; }
      navigator.vibrate?.(10);
      toast.show(editing ? "Saved" : `"${data.get("name")}" added`);
      onDone();
    });
  }

  function applySuggestion(name: string, amount: number) {
    if (nameRef.current) nameRef.current.value = name;
    if (amountRef.current) amountRef.current.value = amount.toString();
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="month" value={month} />

      {/* Direction (expense vs income) */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setKind("expense")}
          className={`flex-1 border rounded-lg px-3 py-2 text-xs font-bold transition-all ${
            kind === "expense"
              ? "border-pink-500/40 bg-pink-500/10 text-pink-300"
              : "border-white/[0.06] text-[#5a6380] hover:border-white/15"
          }`}
        >
          ↓ Expense
        </button>
        <button
          type="button"
          onClick={() => setKind("income")}
          className={`flex-1 border rounded-lg px-3 py-2 text-xs font-bold transition-all ${
            kind === "income"
              ? "border-teal-500/40 bg-teal-500/10 text-teal-300"
              : "border-white/[0.06] text-[#5a6380] hover:border-white/15"
          }`}
        >
          ↑ Income
        </button>
      </div>

      {/* Group selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Group</label>
        <div className="flex gap-1.5 overflow-x-auto stats-scroll pb-1">
          <button type="button" onClick={() => setGroupId("")}
            className={`shrink-0 border rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all ${!groupId ? "border-white/20 bg-white/10 text-white" : "border-white/[0.06] text-[#5a6380] hover:border-white/15"}`}>
            None
          </button>
          {allGroups.map(g => {
            const colors = GROUP_COLOR_CLASSES[g.COLOR] ?? GROUP_COLOR_CLASSES.blue;
            return (
              <button key={g.ID} type="button" onClick={() => setGroupId(g.ID)}
                className={`shrink-0 border rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all whitespace-nowrap ${
                  groupId === g.ID ? `${colors.border} bg-white/10 ${colors.text}` : "border-white/[0.06] text-[#9ca3c0] hover:border-white/15"
                }`}>
                {g.EMOJI && <span className="mr-1">{g.EMOJI}</span>}{g.NAME}
              </button>
            );
          })}
          {newGroupName === null ? (
            <button type="button" onClick={() => setNewGroupName("")}
              className="shrink-0 border border-dashed border-white/[0.06] rounded-lg px-3 py-1.5 text-[11px] font-semibold text-[#5a6380] hover:text-[#9ca3c0] hover:border-white/15 transition-all">
              + New
            </button>
          ) : (
            <span className="shrink-0 inline-flex items-center gap-1">
              <input
                autoFocus
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); submitNewGroup(); }
                  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setNewGroupName(null); }
                }}
                placeholder="Group name"
                aria-label="New group name"
                className="w-28 border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 placeholder:text-[#5a6380]"
              />
              <button type="button" onClick={submitNewGroup} disabled={isCreatingGroup || !newGroupName.trim()}
                className="rounded-lg px-2 py-1 text-[11px] font-bold bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40 transition-all">
                {isCreatingGroup ? "…" : "Add"}
              </button>
            </span>
          )}
        </div>
        <input type="hidden" name="group_id" value={groupId} />
      </div>

      {/* Category picker */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Category</label>
        <div className="flex gap-1.5 overflow-x-auto stats-scroll pb-1">
          {CATEGORY_KEYS.map((key) => {
            const cat = CATEGORIES[key];
            return (
              <button key={key} type="button" onClick={() => setCategory(key)}
                className={`shrink-0 flex flex-col items-center gap-0.5 w-14 py-2 rounded-xl border text-center transition-all ${
                  category === key ? "border-purple-500/40 bg-purple-500/10 text-white" : "border-white/[0.06] text-[#5a6380] hover:border-white/15 hover:text-[#9ca3c0]"
                }`}>
                <span className="text-lg leading-none">{cat.icon}</span>
                <span className="text-[8px] font-semibold leading-tight truncate w-full px-0.5">{cat.label}</span>
              </button>
            );
          })}
        </div>
        <input type="hidden" name="category" value={category} />
      </div>

      {/* Goal (savings) */}
      {showGoals && goalOptions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Counts towards goal</label>
          <div className="flex gap-1.5 overflow-x-auto stats-scroll pb-1">
            <button type="button" onClick={() => setGoalId("")}
              className={`shrink-0 border rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all ${!goalId ? "border-white/20 bg-white/10 text-white" : "border-white/[0.06] text-[#5a6380] hover:border-white/15"}`}>
              None
            </button>
            {goalOptions.map((g) => (
              <button key={g.ID} type="button" onClick={() => setGoalId(g.ID)}
                className={`shrink-0 border rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all whitespace-nowrap ${goalId === g.ID ? "border-teal-500/40 bg-teal-500/10 text-teal-300" : "border-white/[0.06] text-[#9ca3c0] hover:border-white/15"}`}>
                {g.EMOJI && <span className="mr-1">{g.EMOJI}</span>}{g.NAME}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && !editing && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.slice(0, 6).map((s) => (
            <button key={s.NAME} type="button" onClick={() => applySuggestion(s.NAME, s.AMOUNT)}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 text-[#9ca3c0] hover:bg-white/10 hover:text-white transition-all border border-white/[0.06]">
              {s.NAME}
            </button>
          ))}
        </div>
      )}

      {/* Name + Amount + Date */}
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Name</label>
          <input ref={nameRef} name="name" required defaultValue={editing?.NAME} placeholder="e.g. Grocery store, Netflix..."
            className="border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/40 transition-all placeholder:text-[#5a6380]" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Amount (€)</label>
          <input ref={amountRef} name="amount" type="number" step="0.01" min="0" required defaultValue={editing?.AMOUNT} placeholder="0.00"
            className="border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/40 transition-all placeholder:text-[#5a6380] font-mono tabular-nums" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Date <span className="normal-case tracking-normal font-medium text-[#5a6380]/60">(optional)</span></label>
          <input name="date" type="date" defaultValue={defaultDate}
            className="border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/40 transition-all font-mono tabular-nums [color-scheme:dark]" />
        </div>
      </div>

      {/* Extra fields */}
      {showExtra && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Notes</label>
            <input name="notes" defaultValue={editing?.NOTES ?? ""} placeholder="Optional..."
              className="border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all placeholder:text-[#5a6380]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Tags</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => setTags(formatTags(parseTags(tags)) ?? "")} placeholder="#travel, #kids"
              className="border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all placeholder:text-[#5a6380]" />
            {tagOptions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {tagOptions.slice(0, 12).map((t) => {
                  const on = parseTags(tags).includes(t);
                  return (
                    <button key={t} type="button" onClick={() => toggleTag(t)}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${on ? "bg-purple-500/20 border-purple-500/40 text-purple-200" : "bg-white/5 border-white/[0.06] text-[#9ca3c0] hover:text-white"}`}>
                      #{t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {!showExtra && <input type="hidden" name="notes" value="" />}

      {/* Toggles */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setIsRecurring(!isRecurring)}
          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${
            isRecurring ? "border-teal-500/30 bg-teal-500/10 text-teal-400" : "border-white/[0.06] text-[#5a6380] hover:text-[#9ca3c0]"
          }`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
          </svg>
          Recurring
        </button>
        <button type="button" onClick={() => setShowExtra(!showExtra)}
          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${
            showExtra ? "border-purple-500/30 bg-purple-500/10 text-purple-400" : "border-white/[0.06] text-[#5a6380] hover:text-[#9ca3c0]"
          }`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          More
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={isPending}
          className="flex-1 gradient-pink text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all btn-press shadow-lg shadow-pink-500/20">
          {isPending ? "Saving..." : editing ? "Save" : "Add"}
        </button>
        <button type="button" onClick={onDone} className="px-5 py-2.5 text-sm font-medium border border-white/[0.08] rounded-xl text-[#9ca3c0] hover:bg-white/5 hover:text-white transition-all btn-press">
          Cancel
        </button>
      </div>
    </form>
  );
}
