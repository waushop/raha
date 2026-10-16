"use client";

import { useRef, useState } from "react";
import { cancelPending, resendCode, verifyCode } from "@/app/login/actions";
import PinGrid, { type PinGridHandle } from "./PinGrid";

// Second step of sign-in on a browser this user hasn't remembered: the
// six-digit code that was just emailed.
export default function CodeForm({ email }: { email: string }) {
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [remember, setRemember] = useState(true);
  const gridRef = useRef<PinGridHandle>(null);

  async function submit(code: string) {
    setIsPending(true);
    setError("");
    const data = new FormData();
    data.set("code", code);
    data.set("remember", remember ? "1" : "0");
    const result = await verifyCode(data);
    if (result?.error) {
      setError(result.error);
      gridRef.current?.reset();
      navigator.vibrate?.(100);
      if (result.restart) setTimeout(() => cancelPending(), 1500);
    }
    setIsPending(false);
  }

  async function resend() {
    setIsPending(true);
    setError("");
    setInfo("");
    const result = await resendCode();
    if ("error" in result) { setError(result.error); if (result.restart) setTimeout(() => cancelPending(), 1500); }
    else setInfo("New code sent");
    setIsPending(false);
  }

  return (
    <>
      <p className="text-xs text-[#9ca3c0] mb-1">New browser — we emailed a code to <span className="text-white">{email}</span></p>
      <p className="text-[10px] text-[#5a6380] mb-4">It expires in 10 minutes</p>

      <PinGrid ref={gridRef} onComplete={submit} disabled={isPending} shake={!!error} autoFocus />

      <label className="flex items-center justify-center gap-2 mt-4 text-xs text-[#9ca3c0] cursor-pointer select-none">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-pink-500" />
        Remember this device for 30 days
      </label>

      <div className="h-8 flex items-center justify-center mt-3">
        {error ? (
          <p className="text-xs text-red-400 font-medium animate-fade-in">{error}</p>
        ) : info ? (
          <p className="text-xs text-teal-400 font-medium animate-fade-in">{info}</p>
        ) : isPending ? (
          <svg className="animate-spin h-4 w-4 text-purple-400" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <p className="text-[11px] text-[#5a6380]/60">Enter the code</p>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 mt-1 text-[10px]">
        <button onClick={resend} disabled={isPending} className="text-[#5a6380] hover:text-pink-400 transition-colors disabled:opacity-50">Send a new code</button>
        <span className="text-[#5a6380]/40">·</span>
        <button onClick={() => cancelPending()} disabled={isPending} className="text-[#5a6380] hover:text-pink-400 transition-colors disabled:opacity-50">← Start over</button>
      </div>
    </>
  );
}
