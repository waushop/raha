"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { useToast } from "./Toast";
import { addPayday, deletePayday, setBalance, updatePayday } from "@/app/cashflow/actions";
import { PAYDAY_CADENCES, PAYDAY_CADENCE_LABEL, type Payday, type PaydayCadence } from "@/lib/cashflow";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#5a6380] focus:outline-none focus:border-purple-500/50";
const labelCls = "block text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1";

type Props = { paydays: Payday[]; checkpoint: { DATE: string; AMOUNT: number } | null; balanceToday: number | null; today: string };

export default function CashflowSetup({ paydays, checkpoint, balanceToday, today }: Props) {
  const [editing, setEditing] = useState<Payday | null>(null);
  const [showPayday, setShowPayday] = useState(false);
  const [showBalance, setShowBalance] = useState(checkpoint === null);
  const [cadence, setCadence] = useState<PaydayCadence>("monthly");
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function submitPayday(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = editing ? await updatePayday(editing.ID, data) : await addPayday(data);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(editing ? "Payday updated" : "Payday added");
      setShowPayday(false); setEditing(null);
    });
  }

  function submitBalance(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await setBalance(data);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show("Balance saved");
      setShowBalance(false);
    });
  }

  function remove(p: Payday) {
    startTransition(async () => {
      const res = await deletePayday(p.ID);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(`"${p.LABEL}" removed`);
    });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Balance */}
      <div className="card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Wallet size={14} className="text-teal-400" />
          <h2 className="text-sm font-bold text-white">Account balance</h2>
          {checkpoint && !showBalance && (
            <button onClick={() => setShowBalance(true)} className="ml-auto text-[10px] font-semibold text-purple-400 hover:text-purple-300">Update</button>
          )}
        </div>
        {checkpoint && (
          <p className="text-xs text-[#9ca3c0] mb-3">
            Last set to <span className="font-mono text-white/90">{fmt(checkpoint.AMOUNT)} €</span> on {checkpoint.DATE}
            {balanceToday !== null && checkpoint.DATE !== today && <> · rolled forward with your entries to <span className="font-mono text-white/90">{fmt(balanceToday)} €</span></>}
          </p>
        )}
        {showBalance ? (
          <form onSubmit={submitBalance} className="space-y-3">
            <p className="text-xs text-[#5a6380]">What is in your main account right now? Entries you add afterwards roll it forward automatically.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Balance €</label>
                <input name="amount" type="number" step="0.01" inputMode="decimal" required autoFocus className={inputCls} placeholder="1850.00" />
              </div>
              <div>
                <label className={labelCls}>As of</label>
                <input name="date" type="date" defaultValue={today} max={today} className={inputCls} />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={isPending} className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl py-2 text-sm disabled:opacity-50">Save</button>
              {checkpoint && <button type="button" onClick={() => setShowBalance(false)} className="px-4 rounded-xl bg-white/5 text-[#9ca3c0] text-sm">Cancel</button>}
            </div>
          </form>
        ) : null}
      </div>

      {/* Paydays */}
      <div className="card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Plus size={14} className="text-pink-400" />
          <h2 className="text-sm font-bold text-white">Paydays</h2>
          {!showPayday && (
            <button onClick={() => { setEditing(null); setCadence("monthly"); setShowPayday(true); }} className="ml-auto text-[10px] font-semibold text-purple-400 hover:text-purple-300">Add</button>
          )}
        </div>
        {paydays.length === 0 && !showPayday && <p className="text-xs text-[#5a6380]">Add when money comes in so the projection knows when you get topped up.</p>}
        <div className="divide-y divide-white/[0.04]">
          {paydays.map((p) => (
            <div key={p.ID} className="py-2 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/90 truncate">{p.LABEL}</p>
                <p className="text-[10px] text-[#5a6380]">
                  {PAYDAY_CADENCE_LABEL[p.CADENCE]}{p.CADENCE === "monthly" ? ` on the ${p.DAY}` : p.START_DATE ? ` from ${p.START_DATE}` : ""}
                </p>
              </div>
              <span className="text-sm font-mono font-bold text-teal-400 tabular-nums">+{fmt(p.AMOUNT)} €</span>
              <button onClick={() => { setEditing(p); setCadence(p.CADENCE); setShowPayday(true); }} aria-label="Edit payday" className="p-1.5 rounded-lg text-[#5a6380] hover:text-white hover:bg-white/5"><Pencil size={12} /></button>
              <button onClick={() => remove(p)} disabled={isPending} aria-label="Remove payday" className="p-1.5 rounded-lg text-[#5a6380] hover:text-red-400 hover:bg-white/5"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
        {showPayday && (
          <form onSubmit={submitPayday} className="mt-3 space-y-3 animate-fade-in">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Label</label>
                <input name="label" required maxLength={60} defaultValue={editing?.LABEL ?? ""} className={inputCls} placeholder="Salary" />
              </div>
              <div>
                <label className={labelCls}>Amount €</label>
                <input name="amount" type="number" step="0.01" min="0.01" inputMode="decimal" required defaultValue={editing?.AMOUNT ?? ""} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Cadence</label>
                <select name="cadence" value={cadence} onChange={(e) => setCadence(e.target.value as PaydayCadence)} className={inputCls}>
                  {PAYDAY_CADENCES.map((c) => <option key={c} value={c}>{PAYDAY_CADENCE_LABEL[c]}</option>)}
                </select>
              </div>
              {cadence === "monthly" ? (
                <div>
                  <label className={labelCls}>Day of month</label>
                  <input name="day" type="number" min={1} max={31} inputMode="numeric" defaultValue={editing?.DAY ?? 1} className={inputCls} />
                </div>
              ) : (
                <div>
                  <label className={labelCls}>{cadence === "once" ? "Date" : "First payday"}</label>
                  <input name="start_date" type="date" required defaultValue={editing?.START_DATE ?? ""} className={inputCls} />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={isPending} className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl py-2 text-sm disabled:opacity-50">{editing ? "Save" : "Add"}</button>
              <button type="button" onClick={() => { setShowPayday(false); setEditing(null); }} className="px-4 rounded-xl bg-white/5 text-[#9ca3c0] text-sm">Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
