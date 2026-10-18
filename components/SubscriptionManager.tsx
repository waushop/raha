"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Pause, Pencil, Play, Plus, TriangleAlert, Trash2, X } from "lucide-react";
import { useToast } from "./Toast";
import { useDialog } from "./Dialog";
import CategoryIcon from "./CategoryIcon";
import Glyph from "./Glyph";
import { createSubscription, deleteSubscription, setSubscriptionStatus, updateSubscription } from "@/app/subscriptions/actions";
import type { SubscriptionView } from "@/lib/subscriptions-db";
import { CADENCES, CADENCE_LABEL, CADENCE_SHORT, type Cadence } from "@/lib/subscriptions";
import { CATEGORIES, CATEGORY_KEYS, GROUP_COLOR_CLASSES, type ExpenseGroup } from "@/types/expense";
import { monthLabel } from "@/lib/months";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dueLabel(iso: string, today: string): string {
  const days = Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  return iso.slice(5).replace("-", "/");
}

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#5a6380] focus:outline-none focus:border-purple-500/50";
const labelCls = "block text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1";

type Props = { subscriptions: SubscriptionView[]; groups: ExpenseGroup[]; today: string };

export default function SubscriptionManager({ subscriptions, groups, today }: Props) {
  const [editing, setEditing] = useState<SubscriptionView | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const dialog = useDialog();

  function openCreate() { setEditing(null); setCadence("monthly"); setShowForm(true); }
  function openEdit(s: SubscriptionView) { setEditing(s); setCadence(s.CADENCE); setShowForm(true); }
  function close() { setShowForm(false); setEditing(null); }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = editing ? await updateSubscription(editing.ID, data) : await createSubscription(data);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(editing ? "Subscription updated" : "Subscription added");
      navigator.vibrate?.(10);
      close();
    });
  }

  function status(s: SubscriptionView, next: "active" | "paused" | "cancelled") {
    startTransition(async () => {
      const res = await setSubscriptionStatus(s.ID, next);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(`"${s.NAME}" ${next === "active" ? "resumed" : next}`);
    });
  }

  async function remove(s: SubscriptionView) {
    if (!(await dialog.confirm({ title: `Delete "${s.NAME}"?`, message: "Past charges stay in the ledger but lose their link and price history. To stop tracking it, cancelling keeps the history.", confirmLabel: "Delete", tone: "danger", icon: Trash2 }))) return;
    startTransition(async () => {
      const res = await deleteSubscription(s.ID);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(`"${s.NAME}" removed`);
    });
  }

  const active = subscriptions.filter((s) => s.STATUS === "active");
  const rest = subscriptions.filter((s) => s.STATUS !== "active");

  return (
    <div className="space-y-4">
      {subscriptions.length === 0 && !showForm && (
        <div className="card rounded-2xl p-8 text-center">
          <p className="text-sm text-[#9ca3c0]">No subscriptions yet</p>
          <p className="text-xs text-[#5a6380] mt-1">Mark an expense as recurring, or add one here</p>
        </div>
      )}

      {active.length > 0 && <Section title="Active" items={active} today={today} onEdit={openEdit} onStatus={status} onRemove={remove} busy={isPending} />}
      {rest.length > 0 && <Section title="Paused and cancelled" items={rest} today={today} onEdit={openEdit} onStatus={status} onRemove={remove} busy={isPending} muted />}

      {showForm ? (
        <form onSubmit={submit} className="card rounded-2xl p-5 space-y-4 animate-fade-in">
          <h3 className="text-sm font-bold text-white">{editing ? "Edit subscription" : "New subscription"}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={labelCls}>Name</label>
              <input name="name" defaultValue={editing?.NAME ?? ""} required maxLength={80} className={inputCls} placeholder="Netflix" />
            </div>
            <div>
              <label className={labelCls}>Amount €</label>
              <input name="amount" type="number" step="0.01" min="0.01" inputMode="decimal" defaultValue={editing?.AMOUNT ?? ""} required className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Cadence</label>
              <select name="cadence" value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)} className={inputCls}>
                {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
              </select>
            </div>
            {cadence !== "weekly" && (
              <div>
                <label className={labelCls}>Charge day</label>
                <input name="day" type="number" min={1} max={31} inputMode="numeric" defaultValue={editing?.DAY ?? ""} className={inputCls} placeholder="12" />
              </div>
            )}
            {(cadence === "quarterly" || cadence === "yearly") && (
              <div>
                <label className={labelCls}>{cadence === "yearly" ? "Renewal month" : "First month of the cycle"}</label>
                <select name="month_of_year" defaultValue={editing?.MONTH_OF_YEAR ?? editing?.anchorMonth ?? ""} className={inputCls}>
                  <option value="">—</option>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>Category</label>
              <select name="category" defaultValue={editing?.CATEGORY ?? "subscriptions"} className={inputCls}>
                {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Group</label>
              <select name="group_id" defaultValue={editing?.GROUP_ID ?? ""} className={inputCls}>
                <option value="">No group</option>
                {groups.map((g) => <option key={g.ID} value={g.ID}>{g.NAME}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Trial ends</label>
              <input name="trial_ends" type="date" defaultValue={editing?.TRIAL_ENDS ?? ""} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Cancel link</label>
              <input name="cancel_url" type="url" defaultValue={editing?.CANCEL_URL ?? ""} className={inputCls} placeholder="https://…" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes / how to cancel</label>
              <textarea name="notes" rows={2} maxLength={500} defaultValue={editing?.NOTES ?? ""} className={inputCls} placeholder="Account under the family email; cancel from Settings → Membership" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl py-2.5 text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
              {editing ? "Save" : "Add"}
            </button>
            <button type="button" onClick={close} className="px-4 rounded-xl bg-white/5 text-[#9ca3c0] text-sm hover:bg-white/10 transition-colors">Cancel</button>
          </div>
        </form>
      ) : (
        <button onClick={openCreate} className="w-full card rounded-2xl p-4 border-dashed border-white/10 text-sm text-[#9ca3c0] hover:text-white hover:border-pink-500/30 transition-all flex items-center justify-center gap-2 group">
          <Plus size={16} className="group-hover:rotate-90 transition-transform duration-200" />
          Add subscription
        </button>
      )}
    </div>
  );
}

type SectionProps = {
  title: string; items: SubscriptionView[]; today: string; busy: boolean; muted?: boolean;
  onEdit: (s: SubscriptionView) => void; onStatus: (s: SubscriptionView, next: "active" | "paused" | "cancelled") => void; onRemove: (s: SubscriptionView) => void;
};

function Section({ title, items, today, busy, muted, onEdit, onStatus, onRemove }: SectionProps) {
  return (
    <div className="card rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">{title}</h2>
        <span className="text-[10px] text-[#5a6380]">{items.length}</span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {items.map((s) => {
          const colors = s.group ? (GROUP_COLOR_CLASSES[s.group.color] ?? GROUP_COLOR_CLASSES.blue) : null;
          const delta = s.previousAmount !== null ? s.AMOUNT - s.previousAmount : 0;
          const trialSoon = s.TRIAL_ENDS !== null && s.TRIAL_ENDS >= today;
          return (
            <div key={s.ID} className={`px-4 py-3 flex items-start gap-3 row-hover ${muted ? "opacity-60" : ""}`}>
              <CategoryIcon category={s.CATEGORY} size={18} className="text-[#9ca3c0] mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-white/90 font-medium truncate">{s.NAME}</span>
                  <span className="text-right shrink-0">
                    <span className="text-sm font-mono font-bold text-white/80 tabular-nums">{fmt(s.AMOUNT)} €</span>
                    <span className="text-[10px] text-[#5a6380]">/{CADENCE_SHORT[s.CADENCE]}</span>
                    {s.CADENCE !== "monthly" && <span className="block text-[9px] font-mono text-[#5a6380] tabular-nums">{fmt(s.monthly)} €/mo</span>}
                    {s.CADENCE === "monthly" && <span className="block text-[9px] font-mono text-[#5a6380] tabular-nums">{fmt(s.yearly)} €/yr</span>}
                  </span>
                </div>
                <div className="flex items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-[#5a6380] flex-wrap">
                  {s.group && <span className={`inline-flex items-center gap-1 ${colors?.text ?? ""}`}><Glyph name={s.group.icon} size={12} />{s.group.name}</span>}
                  {s.STATUS === "active" && s.nextDue && <span>next {dueLabel(s.nextDue, today)}</span>}
                  {s.STATUS === "paused" && <span className="text-amber-400/80">paused</span>}
                  {s.STATUS === "cancelled" && <span className="text-[#5a6380]">cancelled{s.lastCharge ? ` · last ${monthLabel(s.lastCharge.month, "short")}` : ""}</span>}
                  {s.charges > 0 && <span>{s.charges}× · {fmt(s.totalSpent)} € total</span>}
                  {s.previousAmount !== null && (
                    <span className={delta > 0 ? "text-red-400/80" : "text-teal-400/80"}>
                      {delta > 0 ? "▲" : "▼"} {fmt(Math.abs(delta))} € since {s.changedIn ? monthLabel(s.changedIn, "short") : "?"} (was {fmt(s.previousAmount)})
                    </span>
                  )}
                  {s.unused && <span className="inline-flex items-center gap-1 text-amber-400"><TriangleAlert size={10} /> looks unused</span>}
                  {trialSoon && <span className="inline-flex items-center gap-1 text-pink-400">trial ends {s.TRIAL_ENDS!.slice(5).replace("-", "/")}</span>}
                  {s.CANCEL_URL && <a href={s.CANCEL_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300"><ExternalLink size={10} /> cancel page</a>}
                </div>
                {s.NOTES && <p className="text-[10px] text-[#5a6380] mt-1 line-clamp-2">{s.NOTES}</p>}
              </div>
              <div className="flex items-center gap-0.5 shrink-0 -mr-1">
                <button onClick={() => onEdit(s)} disabled={busy} aria-label="Edit" className="p-1.5 rounded-lg text-[#5a6380] hover:text-white hover:bg-white/5 transition-colors"><Pencil size={13} /></button>
                {s.STATUS === "active" ? (
                  <>
                    <button onClick={() => onStatus(s, "paused")} disabled={busy} aria-label="Pause" title="Pause" className="p-1.5 rounded-lg text-[#5a6380] hover:text-amber-400 hover:bg-white/5 transition-colors"><Pause size={13} /></button>
                    <button onClick={() => onStatus(s, "cancelled")} disabled={busy} aria-label="Cancel subscription" title="Mark cancelled" className="p-1.5 rounded-lg text-[#5a6380] hover:text-red-400 hover:bg-white/5 transition-colors"><X size={13} /></button>
                  </>
                ) : (
                  <>
                    <button onClick={() => onStatus(s, "active")} disabled={busy} aria-label="Resume" title="Resume" className="p-1.5 rounded-lg text-[#5a6380] hover:text-teal-400 hover:bg-white/5 transition-colors">{s.STATUS === "paused" ? <Play size={13} /> : <Check size={13} />}</button>
                    <button onClick={() => onRemove(s)} disabled={busy} aria-label="Remove" title="Remove from the list" className="p-1.5 rounded-lg text-[#5a6380] hover:text-red-400 hover:bg-white/5 transition-colors"><Trash2 size={13} /></button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
