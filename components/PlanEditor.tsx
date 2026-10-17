"use client";

import { useState, useTransition } from "react";
import { Copy, Plus, Repeat, Sparkles, Trash2 } from "lucide-react";
import { useToast } from "./Toast";
import CategoryIcon from "./CategoryIcon";
import Glyph from "./Glyph";
import { addPlanLine, addSubscriptionsToPlan, buildPlanFromAverages, copyPlanFromPrevious, deletePlanLine, updatePlanLine } from "@/app/plan/actions";
import type { LineProgress, PlanSummary, UnplannedGroup } from "@/lib/plan";
import { CATEGORIES, CATEGORY_KEYS, GROUP_COLOR_CLASSES, type CategoryKey, type ExpenseGroup } from "@/types/expense";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#5a6380] focus:outline-none focus:border-purple-500/50";
const labelCls = "block text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1";

type Props = { month: string; summary: PlanSummary; groups: ExpenseGroup[]; hasPrevious: boolean; isCurrentOrFuture: boolean };

export default function PlanEditor({ month, summary, groups, hasPrevious, isCurrentOrFuture }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function run(label: string, fn: () => Promise<{ ok: true; added: number } | { ok: false; error: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(res.added > 0 ? `${res.added} line${res.added !== 1 ? "s" : ""} added` : `Nothing new to add (${label})`);
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    data.set("month", month);
    startTransition(async () => {
      const res = await addPlanLine(data);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show("Line added");
      setShowForm(false);
    });
  }

  function setPlanned(line: LineProgress, value: string) {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || Math.abs(n - line.PLANNED) < 0.005) return;
    startTransition(async () => {
      const res = await updatePlanLine(line.ID, { planned: Math.round(n * 100) / 100 });
      if (!res.ok) toast.showError(res.error);
    });
  }

  function remove(line: LineProgress) {
    startTransition(async () => {
      const res = await deletePlanLine(line.ID);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(`"${line.LABEL}" removed`);
    });
  }

  const income = summary.lines.filter((l) => l.KIND === "income");
  const spend = summary.lines.filter((l) => l.KIND !== "income");
  const groupOrder = [...groups.map((g) => g.ID), ""];
  const byGroup = new Map<string, LineProgress[]>();
  for (const l of spend) {
    const k = l.GROUP_ID ?? "";
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k)!.push(l);
  }
  const groupMeta = (id: string) => groups.find((g) => g.ID === id);
  const unplannedExpense = summary.unplanned.filter((u) => u.KIND === "expense");
  const unplannedIncome = summary.unplanned.filter((u) => u.KIND === "income");

  return (
    <div className="space-y-4">
      {/* Quick starts */}
      <div className="flex flex-wrap gap-2">
        {hasPrevious && (
          <button onClick={() => run("copy", () => copyPlanFromPrevious(month))} disabled={isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50">
            <Copy size={12} /> Copy last plan
          </button>
        )}
        <button onClick={() => run("averages", () => buildPlanFromAverages(month))} disabled={isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50">
          <Sparkles size={12} /> Build from averages
        </button>
        <button onClick={() => run("subscriptions", () => addSubscriptionsToPlan(month))} disabled={isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50">
          <Repeat size={12} strokeWidth={2.5} /> Add subscriptions
        </button>
        <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-white hover:from-pink-500/30 hover:to-purple-500/30 transition-colors">
          <Plus size={12} /> Add line
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-6 gap-3 animate-fade-in">
          <div className="col-span-2">
            <label className={labelCls}>Label</label>
            <input name="label" required maxLength={60} className={inputCls} placeholder="Groceries" />
          </div>
          <div>
            <label className={labelCls}>Kind</label>
            <select name="kind" defaultValue="expense" className={inputCls}>
              <option value="expense">Expense</option>
              <option value="fund">Fund (rolls over)</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Planned €</label>
            <input name="planned" type="number" step="0.01" min="0" inputMode="decimal" className={inputCls} placeholder="0" />
          </div>
          <div>
            <label className={labelCls}>Category</label>
            <select name="category" defaultValue="groceries" className={inputCls}>
              {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Group</label>
            <select name="group_id" defaultValue="" className={inputCls}>
              <option value="">No group</option>
              {groups.map((g) => <option key={g.ID} value={g.ID}>{g.NAME}</option>)}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-6 flex gap-2">
            <button type="submit" disabled={isPending} className="flex-1 sm:flex-none sm:px-6 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl py-2 text-sm disabled:opacity-50">Add</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 rounded-xl bg-white/5 text-[#9ca3c0] text-sm">Cancel</button>
          </div>
        </form>
      )}

      {summary.lines.length === 0 && (
        <div className="card rounded-2xl p-8 text-center">
          <p className="text-sm text-[#9ca3c0]">No plan for this month yet</p>
          <p className="text-xs text-[#5a6380] mt-1">Start from last month, from your averages, or add lines by hand. Give every euro a job until &ldquo;Left to plan&rdquo; reads zero.</p>
        </div>
      )}

      {/* Income */}
      {(income.length > 0 || unplannedIncome.length > 0) && (
        <Section title="Income" hint={`${fmt(summary.actualIncome)} € received`}>
          {income.map((l) => <LineRow key={l.ID} line={l} onPlanned={setPlanned} onRemove={remove} busy={isPending} />)}
          {unplannedIncome.map((u) => <UnplannedRow key={`${u.CATEGORY}-${u.GROUP_ID}`} u={u} />)}
        </Section>
      )}

      {/* Spending by group */}
      {groupOrder.filter((g) => byGroup.has(g)).map((gid) => {
        const g = gid ? groupMeta(gid) : undefined;
        const colors = g ? (GROUP_COLOR_CLASSES[g.COLOR] ?? GROUP_COLOR_CLASSES.blue) : null;
        const lines = byGroup.get(gid)!;
        const planned = lines.reduce((s, l) => s + l.PLANNED, 0);
        const actual = lines.reduce((s, l) => s + l.actual, 0);
        return (
          <Section
            key={gid || "none"}
            title={<span className={`inline-flex items-center gap-2 ${colors?.text ?? ""}`}>{g ? <Glyph name={g.ICON} size={14} /> : null}{g?.NAME ?? "No group"}</span>}
            hint={`${fmt0(actual)} / ${fmt0(planned)} €`}
            bar={planned > 0 ? Math.min(100, (actual / planned) * 100) : 0}
            over={actual > planned}
          >
            {lines.map((l) => <LineRow key={l.ID} line={l} onPlanned={setPlanned} onRemove={remove} busy={isPending} />)}
          </Section>
        );
      })}

      {/* Unplanned */}
      {unplannedExpense.length > 0 && (
        <Section title={<span className="text-red-400">Unplanned</span>} hint={`${fmt(summary.unplannedSpending)} € with no line`} danger>
          {unplannedExpense.map((u) => <UnplannedRow key={`${u.CATEGORY}-${u.GROUP_ID}`} u={u} groups={groups} />)}
          <p className="px-4 py-2 text-[10px] text-[#5a6380]">{isCurrentOrFuture ? "Add a line for these so the plan stays honest, or move the rows to another category." : "Spending this month that had no line in the plan."}</p>
        </Section>
      )}
    </div>
  );
}

function Section({ title, hint, bar, over, danger, children }: { title: React.ReactNode; hint?: string; bar?: number; over?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className={`card rounded-2xl overflow-hidden ${danger ? "border-red-500/20" : ""}`}>
      <div className="px-4 py-2.5 border-b border-white/[0.06]">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-bold text-white">{title}</h2>
          {hint && <span className={`text-[10px] font-mono tabular-nums ${over ? "text-red-400" : "text-[#5a6380]"}`}>{hint}</span>}
        </div>
        {bar !== undefined && (
          <div className="h-1 rounded-full bg-white/5 mt-2 overflow-hidden">
            <div className={`h-full rounded-full ${over ? "bg-red-500" : "bg-gradient-to-r from-pink-500 to-purple-500"}`} style={{ width: `${bar}%` }} />
          </div>
        )}
      </div>
      <div className="divide-y divide-white/[0.04]">{children}</div>
    </div>
  );
}

function LineRow({ line, onPlanned, onRemove, busy }: { line: LineProgress; onPlanned: (l: LineProgress, v: string) => void; onRemove: (l: LineProgress) => void; busy: boolean }) {
  const pct = line.PLANNED > 0 ? Math.min(100, (line.actual / line.PLANNED) * 100) : line.actual > 0 ? 100 : 0;
  const over = line.KIND !== "income" && line.actual > line.PLANNED;
  return (
    <div className="px-4 py-2.5 row-hover">
      <div className="flex items-center gap-3">
        <CategoryIcon category={line.CATEGORY} size={14} className="text-[#5a6380]" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/90 truncate">{line.LABEL}</span>
            {line.KIND === "fund" && <span className="text-[9px] font-bold uppercase tracking-wider text-purple-400 bg-purple-500/10 rounded-full px-1.5 py-0.5">fund</span>}
          </div>
          <div className="text-[10px] text-[#5a6380] tabular-nums">
            {line.KIND === "income" ? `${fmt(line.actual)} € received` : `${fmt(line.actual)} € spent`}
            {line.rows > 0 && ` · ${line.rows} row${line.rows !== 1 ? "s" : ""}`}
            {line.KIND === "fund" && line.balance !== null && <span className="text-purple-400/80"> · balance {fmt(line.balance)} €</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number" step="0.01" min="0" inputMode="decimal"
            defaultValue={line.PLANNED}
            onBlur={(e) => onPlanned(line, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            aria-label={`Planned for ${line.LABEL}`}
            className="w-24 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm font-mono text-white text-right tabular-nums focus:outline-none focus:border-purple-500/50"
          />
          <span className="text-[10px] text-[#5a6380]">€</span>
          <span className={`w-16 text-right text-[11px] font-mono tabular-nums ${over ? "text-red-400" : line.remaining < 0 && line.KIND === "income" ? "text-amber-400" : "text-teal-400"}`} title={line.KIND === "income" ? "received − planned" : "planned − spent"}>
            {line.remaining >= 0 ? "+" : ""}{fmt0(line.remaining)}
          </span>
          <button onClick={() => onRemove(line)} disabled={busy} aria-label="Remove line" className="p-1 rounded-lg text-[#5a6380] hover:text-red-400 hover:bg-white/5 transition-colors"><Trash2 size={12} /></button>
        </div>
      </div>
      <div className="h-0.5 rounded-full bg-white/5 mt-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${over ? "bg-red-500" : line.KIND === "income" ? "bg-teal-500" : "bg-purple-500/70"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function UnplannedRow({ u, groups }: { u: UnplannedGroup; groups?: ExpenseGroup[] }) {
  const g = groups?.find((x) => x.ID === u.GROUP_ID);
  return (
    <div className="px-4 py-2 flex items-center gap-3">
      <CategoryIcon category={u.CATEGORY} size={14} className="text-[#5a6380]" />
      <span className="flex-1 text-sm text-white/80 truncate">
        {CATEGORIES[u.CATEGORY as CategoryKey]?.label ?? u.CATEGORY}{g ? <span className="text-[#5a6380]"> · {g.NAME}</span> : null}
        <span className="text-[10px] text-[#5a6380]"> · {u.rows} row{u.rows !== 1 ? "s" : ""}</span>
      </span>
      <span className="text-sm font-mono text-white/70 tabular-nums">{fmt(u.amount)} €</span>
    </div>
  );
}
