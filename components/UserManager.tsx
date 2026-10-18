"use client";

import { useState, useTransition } from "react";
import { adminDisable2fa, createUser, removeUser, renameUser, resetUserPin } from "@/app/users/actions";
import { KeyRound, MailX, UserMinus } from "lucide-react";
import { useToast } from "./Toast";
import { useDialog } from "./Dialog";
import { pinWeakness } from "@/lib/pin-policy";

type User = { ID: string; NAME: string; IS_ADMIN: number; REQUIRE_2FA?: number };

export default function UserManager({ users, currentUserId, isAdmin }: { users: User[]; currentUserId: string; isAdmin: boolean }) {
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const dialog = useDialog();
  const input = "border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 placeholder:text-[#5a6380]";

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const res = await createUser(data);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(`"${data.get("name")}" can now sign in with their PIN`);
      form.reset();
      setShowForm(false);
    });
  }

  async function rename(u: User) {
    const name = await dialog.prompt({ title: u.ID === currentUserId ? "Rename yourself" : `Rename ${u.NAME}`, label: "Name", defaultValue: u.NAME, maxLength: 40, confirmLabel: "Rename" });
    if (!name || name === u.NAME) return;
    startTransition(async () => {
      const res = await renameUser(u.ID, name);
      toast[res.ok ? "show" : "showError"](res.ok ? "Renamed" : res.error);
    });
  }

  async function resetPin(u: User) {
    const pin = await dialog.prompt({
      title: `Reset PIN for ${u.NAME}`,
      message: "They'll be signed out on every device and sign in with this PIN next time. Tell it to them in person.",
      label: "New 6-digit PIN",
      inputMode: "numeric",
      maxLength: 6,
      mono: true,
      confirmLabel: "Reset PIN",
      icon: KeyRound,
      validate: pinWeakness,
    });
    if (!pin) return;
    startTransition(async () => {
      const res = await resetUserPin(u.ID, pin.trim());
      toast[res.ok ? "show" : "showError"](res.ok ? `PIN reset for ${u.NAME}` : res.error);
    });
  }

  async function remove(u: User) {
    if (!(await dialog.confirm({ title: `Remove ${u.NAME}?`, message: "They can no longer sign in. Their ledger is kept.", confirmLabel: "Remove user", tone: "danger", icon: UserMinus }))) return;
    startTransition(async () => {
      const res = await removeUser(u.ID);
      toast[res.ok ? "show" : "showError"](res.ok ? `${u.NAME} removed` : res.error);
    });
  }

  async function disable2fa(u: User) {
    if (!(await dialog.confirm({ title: `Switch off the email check for ${u.NAME}?`, message: "Use this when they lost access to their mailbox. They sign in with the PIN alone until they turn it back on.", confirmLabel: "Switch off", tone: "danger", icon: MailX }))) return;
    startTransition(async () => {
      const res = await adminDisable2fa(u.ID);
      toast[res.ok ? "show" : "showError"](res.ok ? "Email check switched off" : res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {users.map((u) => (
          <div key={u.ID} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-white/[0.03] rounded-xl px-3 py-2">
            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500/30 to-purple-500/30 flex items-center justify-center text-sm font-bold text-white shrink-0">{u.NAME.charAt(0).toUpperCase()}</span>
            <div className="flex-1 min-w-[8rem]">
              <p className="text-sm text-white font-medium truncate">{u.NAME}{u.ID === currentUserId && <span className="text-[#5a6380] font-normal"> (you)</span>}</p>
              <p className="text-[10px] text-[#5a6380] whitespace-nowrap">{u.IS_ADMIN ? "Admin" : "Member"} · own ledger{u.REQUIRE_2FA ? " · email check on" : ""}</p>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 basis-full sm:basis-auto justify-end">
            {(isAdmin || u.ID === currentUserId) && (
              <button onClick={() => rename(u)} disabled={isPending} className="text-[10px] text-[#5a6380] hover:text-white transition-colors px-1">Rename</button>
            )}
            {isAdmin && u.ID !== currentUserId && (
              <>
                <button onClick={() => resetPin(u)} disabled={isPending} className="text-[10px] text-[#5a6380] hover:text-amber-400 transition-colors px-1">Reset PIN</button>
                {u.REQUIRE_2FA === 1 && (
                  <button onClick={() => disable2fa(u)} disabled={isPending} className="text-[10px] text-[#5a6380] hover:text-amber-400 transition-colors px-1">Disable email check</button>
                )}
                <button onClick={() => remove(u)} disabled={isPending} className="text-[10px] text-[#5a6380] hover:text-red-400 transition-colors px-1">Remove</button>
              </>
            )}
            </div>
          </div>
        ))}
      </div>

      {isAdmin && (showForm ? (
        <form onSubmit={handleCreate} className="bg-white/[0.03] rounded-xl p-4 space-y-3 animate-fade-in">
          <p className="text-xs font-bold text-white">New user</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input name="name" required maxLength={40} placeholder="Name" className={input} autoFocus />
            <input name="pin" required inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="Initial 6-digit PIN" className={`${input} font-mono tabular-nums`} />
          </div>
          <p className="text-[10px] text-[#5a6380]">They sign in with just this PIN (it must differ from everyone else&rsquo;s), land in their own empty ledger, and can change it from Settings.</p>
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="gradient-pink text-white rounded-xl px-5 py-2 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all btn-press">{isPending ? "Creating…" : "Create"}</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border border-white/[0.08] rounded-xl text-[#9ca3c0] hover:bg-white/5 transition-all">Cancel</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowForm(true)} className="w-full py-2.5 rounded-xl border border-dashed border-white/10 text-[#5a6380] text-xs font-medium hover:border-pink-500/30 hover:text-pink-400 transition-all btn-press">
          + Add user
        </button>
      ))}
    </div>
  );
}
