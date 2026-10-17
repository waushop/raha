"use client";

import { useState, useTransition } from "react";
import { Landmark, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useToast } from "./Toast";
import { addAccount, deleteAccount, snapshotAll, updateAccount } from "@/app/networth/actions";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/networth";
import type { AccountView } from "@/lib/networth-db";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#5a6380] focus:outline-none focus:border-purple-500/50";
const labelCls = "block text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1";
const TYPE_TONE: Record<AccountType, string> = {
  cash: "bg-teal-500/15 text-teal-300", savings: "bg-blue-500/15 text-blue-300", investment: "bg-purple-500/15 text-purple-300",
  property: "bg-amber-500/15 text-amber-300", debt: "bg-red-500/15 text-red-300",
};

type Props = { accounts: AccountView[]; month: string; monthName: string };

export default function NetWorthEditor({ accounts, month, monthName }: Props) {
  const [editing, setEditing] = useState<AccountView | null>(null);
  const [showAccount, setShowAccount] = useState(accounts.length === 0);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function submitBalances(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const balances = accounts.map((a) => ({ accountId: a.ID, balance: String(data.get(`balance-${a.ID}`) ?? "") }));
    startTransition(async () => {
      const res = await snapshotAll(month, balances);
      if (!res.ok) { toast.showError(res.error); return; }
      navigator.vibrate?.(10);
      toast.show(`${res.saved} balance${res.saved === 1 ? "" : "s"} saved for ${monthName}`);
    });
  }

  function submitAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    data.set("month", month);
    startTransition(async () => {
      const res = editing ? await updateAccount(editing.ID, data) : await addAccount(data);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(editing ? "Account updated" : "Account added");
      setShowAccount(false); setEditing(null);
    });
  }

  function remove(a: AccountView) {
    startTransition(async () => {
      const res = await deleteAccount(a.ID);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(`"${a.NAME}" removed`);
    });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Update balances */}
      <div className="card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw size={14} className="text-teal-400" />
          <h2 className="text-sm font-bold text-white">Update balances for {monthName}</h2>
        </div>
        {accounts.length === 0 ? (
          <p className="text-xs text-[#5a6380]">Add an account first, then record its balance here once a month.</p>
        ) : (
          <form onSubmit={submitBalances} className="space-y-3">
            <p className="text-xs text-[#5a6380]">What is in each account right now? Debts are entered as the amount still owed. Leave a field blank to keep the last value.</p>
            <div className="space-y-2">
              {accounts.map((a) => (
                <div key={a.ID} className="flex items-center gap-3">
                  <label htmlFor={`balance-${a.ID}`} className="flex-1 min-w-0">
                    <span className="block text-sm text-white/90 truncate">{a.NAME}</span>
                    <span className="block text-[10px] text-[#5a6380]">{ACCOUNT_TYPE_LABEL[a.TYPE]}{a.asOf ? ` · last ${a.asOf}` : " · no balance yet"}</span>
                  </label>
                  <div className="relative w-36">
                    <input id={`balance-${a.ID}`} name={`balance-${a.ID}`} type="number" step="0.01" inputMode="decimal" defaultValue={a.balance ?? ""} placeholder="0.00" className={`${inputCls} pr-7 text-right font-mono tabular-nums`} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#5a6380]">€</span>
                  </div>
                </div>
              ))}
            </div>
            <button type="submit" disabled={isPending} className="w-full bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl py-2 text-sm disabled:opacity-50">Save balances</button>
          </form>
        )}
      </div>

      {/* Accounts */}
      <div className="card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Landmark size={14} className="text-pink-400" />
          <h2 className="text-sm font-bold text-white">Accounts</h2>
          {!showAccount && (
            <button onClick={() => { setEditing(null); setShowAccount(true); }} className="ml-auto text-[10px] font-semibold text-purple-400 hover:text-purple-300 inline-flex items-center gap-1"><Plus size={10} /> Add</button>
          )}
        </div>
        {accounts.length === 0 && !showAccount && <p className="text-xs text-[#5a6380]">Bank accounts, savings, investments, property and loans.</p>}
        <div className="divide-y divide-white/[0.04]">
          {accounts.map((a) => (
            <div key={a.ID} className="py-2 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/90 truncate">{a.NAME}</p>
                <span className={`inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${TYPE_TONE[a.TYPE]}`}>{ACCOUNT_TYPE_LABEL[a.TYPE]}</span>
              </div>
              <span className={`text-sm font-mono font-bold tabular-nums ${a.TYPE === "debt" ? "text-red-400" : "text-white/80"}`}>{a.balance === null ? "—" : `${a.TYPE === "debt" ? "−" : ""}${fmt(a.balance)} €`}</span>
              <button onClick={() => { setEditing(a); setShowAccount(true); }} aria-label="Edit account" className="p-1.5 rounded-lg text-[#5a6380] hover:text-white hover:bg-white/5"><Pencil size={12} /></button>
              <button onClick={() => remove(a)} disabled={isPending} aria-label="Remove account" className="p-1.5 rounded-lg text-[#5a6380] hover:text-red-400 hover:bg-white/5"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
        {showAccount && (
          <form key={editing?.ID ?? "new"} onSubmit={submitAccount} className="mt-3 space-y-3 animate-fade-in">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Name</label>
                <input name="name" required maxLength={60} defaultValue={editing?.NAME ?? ""} autoFocus className={inputCls} placeholder="Main account" />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select name="type" defaultValue={editing?.TYPE ?? "cash"} className={inputCls}>
                  {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
                </select>
              </div>
              {!editing && (
                <div>
                  <label className={labelCls}>Balance now €</label>
                  <input name="balance" type="number" step="0.01" inputMode="decimal" className={inputCls} placeholder="optional" />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={isPending} className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl py-2 text-sm disabled:opacity-50">{editing ? "Save" : "Add"}</button>
              <button type="button" onClick={() => { setShowAccount(false); setEditing(null); }} className="px-4 rounded-xl bg-white/5 text-[#9ca3c0] text-sm">Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
