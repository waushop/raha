"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Plus, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import { useToast } from "./Toast";
import { useDialog } from "./Dialog";
import type { ConfirmOptions } from "./Dialog";
import { addMember, createHousehold, deleteHousehold, leaveHousehold, removeMember, renameHousehold } from "@/app/household/actions";
import type { MemberRow, WorkspaceRow } from "@/lib/household";

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#5a6380] focus:outline-none focus:border-purple-500/50";
const labelCls = "block text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1";

type Props = {
  current: { id: string; name: string; kind: "personal" | "shared" };
  meId: string;
  workspaces: WorkspaceRow[];
  members: MemberRow[];
  others: Array<{ ID: string; NAME: string }>;
};

// Settings card: create a household, manage its members, switch between
// ledgers. In a household every expense carries a payer and the month view
// shows who owes whom.
export default function HouseholdSettings({ current, meId, workspaces, members, others }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState(current.name);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  const amOwner = members.find((m) => m.ID === meId)?.ROLE === "owner";
  const candidates = others.filter((o) => !members.some((m) => m.ID === o.ID));

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, ask?: ConfirmOptions) {
    if (ask && !(await dialog.confirm(ask))) return;
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(done);
      router.refresh();
    });
  }

  function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createHousehold(data);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show("Household created — you are now in it");
      setShowCreate(false);
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="card rounded-2xl p-5">
      <h2 className="text-sm font-bold text-white mb-1 flex items-center gap-2"><Users size={14} className="text-pink-400" /> Household</h2>
      <p className="text-xs text-[#5a6380] mb-4">A shared ledger for the people you live with. Everyone sees the same months, plan and subscriptions; each expense records who paid, and the month view shows who owes whom.</p>

      {current.kind === "shared" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[10rem]">
              <label className={labelCls}>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={!amOwner} maxLength={40} className={inputCls} />
            </div>
            {amOwner && name.trim() !== current.name && (
              <button onClick={() => run(() => renameHousehold(name), "Renamed")} disabled={isPending} className="text-xs font-semibold rounded-xl px-3 py-2 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 disabled:opacity-50">Save</button>
            )}
          </div>
          <div>
            <p className={labelCls}>Members</p>
            <ul className="divide-y divide-white/[0.04]">
              {members.map((m) => (
                <li key={m.ID} className="py-2 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-500/30 to-purple-500/30 text-white text-xs font-bold flex items-center justify-center">{m.NAME.slice(0, 1).toUpperCase()}</span>
                  <span className="flex-1 text-sm text-white/90">{m.NAME}{m.ID === meId && <span className="text-[#5a6380]"> (you)</span>}</span>
                  <span className="text-[10px] uppercase tracking-wider text-[#5a6380]">{m.ROLE}</span>
                  {amOwner && m.ROLE !== "owner" && (
                    <button onClick={() => run(() => removeMember(m.ID), `${m.NAME} removed`, { title: `Remove ${m.NAME} from ${current.name}?`, message: "They lose access to this shared ledger. Expenses already recorded stay as they are.", confirmLabel: "Remove", tone: "danger", icon: UserMinus })} disabled={isPending} aria-label={`Remove ${m.NAME}`} className="p-1.5 rounded-lg text-[#5a6380] hover:text-red-400 hover:bg-white/5"><UserMinus size={13} /></button>
                  )}
                </li>
              ))}
            </ul>
            {amOwner && candidates.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {candidates.map((c) => (
                  <button key={c.ID} onClick={() => run(() => addMember(c.ID), `${c.NAME} added`)} disabled={isPending} className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 disabled:opacity-50"><UserPlus size={11} /> {c.NAME}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {amOwner ? (
              <button onClick={() => run(() => deleteHousehold(), "Household deleted", { title: `Delete ${current.name}?`, message: "Every member loses this shared ledger: its months, plan, subscriptions and goals. Personal ledgers are not touched.", confirmLabel: "Delete household", tone: "danger", icon: Trash2 })} disabled={isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50"><Trash2 size={12} /> Delete household</button>
            ) : (
              <button onClick={() => run(() => leaveHousehold(), "You left the household", { title: `Leave ${current.name}?`, message: "You lose access to this shared ledger until an owner adds you again.", confirmLabel: "Leave", tone: "danger", icon: LogOut })} disabled={isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 disabled:opacity-50"><LogOut size={12} /> Leave household</button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {workspaces.filter((w) => w.KIND === "shared").length > 0 && (
            <p className="text-xs text-[#9ca3c0]">You belong to {workspaces.filter((w) => w.KIND === "shared").map((w) => w.NAME).join(", ")}. Switch from the sidebar to manage it.</p>
          )}
          {showCreate ? (
            <form onSubmit={create} className="space-y-3 animate-fade-in">
              <div>
                <label className={labelCls}>Household name</label>
                <input name="name" required maxLength={40} autoFocus className={inputCls} placeholder="Home" />
              </div>
              <div>
                <p className={labelCls}>Members</p>
                {others.length === 0 ? (
                  <p className="text-xs text-[#5a6380]">No other users yet. Add them in the Users card first.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {others.map((o) => (
                      <label key={o.ID} className="inline-flex items-center gap-1.5 text-xs text-white/90 bg-white/5 rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-white/10">
                        <input type="checkbox" name="members" value={o.ID} defaultChecked className="accent-pink-500" /> {o.NAME}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={isPending} className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold rounded-xl py-2 text-sm disabled:opacity-50">Create</button>
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 rounded-xl bg-white/5 text-[#9ca3c0] text-sm">Cancel</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-white hover:from-pink-500/30 hover:to-purple-500/30"><Plus size={12} /> Create a household</button>
          )}
        </div>
      )}
    </div>
  );
}
