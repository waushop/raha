"use client";

import { useState, useTransition } from "react";
import { createGoal, updateGoal, deleteGoal } from "@/app/actions";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "./Toast";
import { useDialog } from "./Dialog";
import type { GoalProgress } from "@/lib/goals";
import { monthLabel } from "@/lib/months";
import { DEFAULT_GOAL_ICON, iconFromLegacy, type IconName } from "@/lib/icon-names";
import Glyph from "./Glyph";
import IconPicker from "./IconPicker";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const STATUS: Record<GoalProgress["status"], { label: string; cls: string }> = {
  done: { label: "Reached", cls: "text-teal-400" },
  "on-track": { label: "On track", cls: "text-teal-400" },
  behind: { label: "Behind", cls: "text-amber-400" },
  "no-deadline": { label: "No deadline", cls: "text-[#5a6380]" },
};

export function GoalRing({ pct, size = 56, stroke = 6, className = "" }: { pct: number; size?: number; stroke?: number; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`shrink-0 ${className}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-white/5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#goal-grad)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.7s ease-out" }} />
      <defs>
        <linearGradient id="goal-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2dd4bf" /><stop offset="100%" stopColor="#a9a9b2" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function GoalList({ goals }: { goals: GoalProgress[] }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GoalProgress | null>(null);
  const [icon, setIcon] = useState<IconName>(DEFAULT_GOAL_ICON);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const dialog = useDialog();

  function openCreate() { setEditing(null); setIcon(DEFAULT_GOAL_ICON); setShowForm(true); }
  function openEdit(g: GoalProgress) { setEditing(g); setIcon(iconFromLegacy(g.ICON) ?? DEFAULT_GOAL_ICON); setShowForm(true); }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = editing ? await updateGoal(editing.ID, data) : await createGoal(data);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(editing ? "Goal updated" : "Goal created");
      setShowForm(false); setEditing(null);
    });
  }

  async function handleDelete(g: GoalProgress) {
    if (!(await dialog.confirm({ title: `Remove goal "${g.NAME}"?`, message: "Contributions stay in the ledger as ordinary rows.", confirmLabel: "Remove goal", tone: "danger", icon: Trash2 }))) return;
    startTransition(async () => { await deleteGoal(g.ID); toast.show(`"${g.NAME}" removed`); });
  }

  const input = "border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all placeholder:text-[#5a6380]";
  const label = "text-[10px] font-bold uppercase tracking-widest text-[#5a6380]";

  return (
    <div className="space-y-4">
      {goals.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {goals.map((g) => {
            const st = STATUS[g.status];
            return (
              <div key={g.ID} className="card rounded-2xl p-4 flex gap-4">
                <div className="relative">
                  <GoalRing pct={g.pct} />
                  <span className="absolute inset-0 flex items-center justify-center text-xl"><Glyph name={g.ICON} fallback="target" size={20} /></span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white truncate">{g.NAME}</p>
                      <p className="text-xs font-mono tabular-nums text-white/70">{fmt(g.saved)} <span className="text-[#5a6380]">/ {fmt(g.TARGET_AMOUNT)} €</span> <span className="text-[#5a6380]">· {g.pct.toFixed(0)}%</span></p>
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <button onClick={() => openEdit(g)} aria-label="Edit goal" className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-[#5a6380] hover:text-blue-400 transition-colors">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => handleDelete(g)} aria-label="Remove goal" className="w-7 h-7 rounded-lg hover:bg-red-500/10 flex items-center justify-center text-[#5a6380] hover:text-red-400 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <p className={`text-[10px] mt-1.5 font-semibold ${st.cls}`}>
                    {st.label}
                    {g.status !== "done" && g.TARGET_MONTH && <span className="text-[#5a6380] font-normal"> · target {monthLabel(g.TARGET_MONTH, "short")}</span>}
                    {g.status !== "done" && g.projectedMonth && <span className="text-[#5a6380] font-normal"> · at this pace {monthLabel(g.projectedMonth, "short")}</span>}
                  </p>
                  {g.status !== "done" && (
                    <p className="text-[10px] text-[#5a6380] font-mono tabular-nums mt-0.5">
                      {g.neededPerMonth !== null ? `${fmt(g.neededPerMonth)} €/mo needed` : `${fmt(g.remaining)} € to go`}
                      {g.recentPerMonth > 0 && ` · saving ~${fmt(g.recentPerMonth)} €/mo`}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card rounded-2xl p-8 text-center">
          <p className="text-sm text-[#9ca3c0]">No goals yet</p>
          <p className="text-xs text-[#5a6380] mt-1">Set a target and link savings entries to it from the expense form</p>
        </div>
      )}

      {showForm ? (
        <form onSubmit={handleSubmit} className="card rounded-2xl p-5 space-y-4 animate-fade-in">
          <h3 className="text-sm font-bold text-white">{editing ? "Edit goal" : "New goal"}</h3>
          <div className="flex flex-col gap-1.5">
            <label className={label}>Icon</label>
            <IconPicker value={icon} onChange={setIcon} field="icon" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className={label}>Name</label>
              <input name="name" required defaultValue={editing?.NAME} placeholder="e.g. Emergency fund" className={input} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={label}>Target (€)</label>
              <input name="target_amount" type="number" step="1" min="1" required defaultValue={editing?.TARGET_AMOUNT} placeholder="5000" className={`${input} font-mono tabular-nums`} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={label}>Target month <span className="normal-case tracking-normal font-medium text-[#5a6380]/60">(optional)</span></label>
              <input name="target_month" type="month" defaultValue={editing?.TARGET_MONTH ?? ""} className={`${input} font-mono tabular-nums [color-scheme:dark]`} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={label}>Already saved (€)</label>
              <input name="starting_amount" type="number" step="0.01" min="0" defaultValue={editing?.STARTING_AMOUNT || ""} placeholder="0" className={`${input} font-mono tabular-nums`} />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={isPending} className="flex-1 gradient-pink text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all btn-press shadow-lg shadow-pink-500/20">
              {isPending ? "Saving..." : editing ? "Save" : "Create"}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="px-5 py-2.5 text-sm font-medium border border-white/[0.08] rounded-xl text-[#9ca3c0] hover:bg-white/5 hover:text-white transition-all btn-press">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={openCreate} className="w-full py-3 rounded-2xl border border-dashed border-white/10 text-[#5a6380] text-sm font-medium hover:border-pink-500/30 hover:text-pink-400 hover:bg-white/[0.02] transition-all btn-press group">
          <span className="inline-flex items-center gap-2">
            <Plus size={16} className="group-hover:rotate-90 transition-transform duration-200" />
            Add goal
          </span>
        </button>
      )}
    </div>
  );
}
