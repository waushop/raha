"use client";

import { useState, useTransition } from "react";
import { forgetAllDevicesAction, forgetDeviceAction, sendEmailVerification, setEmail, setRequire2fa, verifyEmail } from "@/app/users/actions";
import { useToast } from "./Toast";
import type { Device } from "@/lib/twofa";

type Props = { email: string | null; verified: boolean; require2fa: boolean; devices: Device[]; mailConfigured: boolean };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const input = "border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 placeholder:text-[#5a6380]";

export default function TwoFactorSettings({ email, verified, require2fa, devices, mailConfigured }: Props) {
  const [draft, setDraft] = useState(email ?? "");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { toast.showError(res.error ?? "Something went wrong"); return; }
      toast.show(okMsg);
      after?.();
    });

  return (
    <div className="space-y-4">
      {!mailConfigured && (
        <p className="text-[10px] text-amber-400/80 bg-amber-500/5 border border-amber-500/10 rounded-lg px-3 py-2">
          Email sending isn&rsquo;t configured on this server (SMTP_HOST / SMTP_FROM). In development, codes are printed to the server log.
        </p>
      )}

      {/* Email */}
      <form onSubmit={(e) => { e.preventDefault(); run(() => setEmail(draft), draft.trim() ? "Email saved — now verify it" : "Email removed", () => setCodeSent(false)); }} className="flex gap-2">
        <input type="email" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="you@example.com" className={`${input} flex-1`} />
        <button type="submit" disabled={isPending || draft.trim() === (email ?? "")} className="px-4 py-2 rounded-xl text-sm font-bold bg-white/5 border border-white/[0.08] text-[#9ca3c0] hover:text-white hover:bg-white/10 disabled:opacity-40 transition-all">
          Save
        </button>
      </form>

      {/* Verification */}
      {email && !verified && (
        <div className="bg-white/[0.03] rounded-xl p-3 space-y-2">
          <p className="text-xs text-white/80">Verify <span className="font-semibold">{email}</span> to switch on the sign-in check.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" disabled={isPending} onClick={() => run(() => sendEmailVerification(), "Code sent", () => setCodeSent(true))}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-500/15 text-purple-200 hover:bg-purple-500/25 disabled:opacity-40 transition-all">
              {codeSent ? "Send again" : "Send code"}
            </button>
            {codeSent && (
              <form onSubmit={(e) => { e.preventDefault(); run(() => verifyEmail(code), "Email verified — new devices now need a code", () => setCode("")); }} className="flex gap-2">
                <input inputMode="numeric" pattern="\\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\\D/g, ""))} placeholder="6-digit code" className={`${input} w-32 font-mono tabular-nums`} />
                <button type="submit" disabled={isPending || code.length !== 6} className="px-3 py-1.5 rounded-lg text-xs font-bold gradient-pink text-white disabled:opacity-40 transition-all">Verify</button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Toggle */}
      {email && verified && (
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input type="checkbox" checked={require2fa} disabled={isPending} onChange={(e) => run(() => setRequire2fa(e.target.checked), e.target.checked ? "New devices will be asked for a code" : "Email check switched off")} className="accent-pink-500 w-4 h-4" />
          <span className="text-xs text-white/80">Ask for an emailed code when signing in from a new device <span className="text-[#5a6380]">(verified: {email})</span></span>
        </label>
      )}

      {/* Devices */}
      {devices.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">Remembered devices</p>
            <button type="button" disabled={isPending} onClick={() => run(() => forgetAllDevicesAction(), "All devices forgotten")} className="text-[10px] text-[#5a6380] hover:text-red-400 transition-colors">Forget all</button>
          </div>
          <div className="space-y-1">
            {devices.map((d) => (
              <div key={d.ID} className="flex items-center gap-3 bg-white/[0.03] rounded-lg px-3 py-1.5 text-xs">
                <span className="text-white/80 flex-1">{d.NAME}</span>
                <span className="text-[#5a6380]">last seen {when(d.LAST_SEEN_AT)} · until {when(d.EXPIRES_AT)}</span>
                <button type="button" disabled={isPending} onClick={() => run(() => forgetDeviceAction(d.ID), "Device forgotten")} className="text-[10px] text-[#5a6380] hover:text-red-400 transition-colors">Forget</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
