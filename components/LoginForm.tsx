"use client";

import { useRef, useState } from "react";
import { login } from "@/app/login/actions";
import PinGrid, { type PinGridHandle } from "./PinGrid";

type User = { ID: string; NAME: string };

// Pick who you are, then your PIN. One user skips the picker; the last
// choice is remembered on this device.
export default function LoginForm({ users }: { users: User[] }) {
  const remembered = (() => { try { return localStorage.getItem("lastUser"); } catch { return null; } })();
  const [userId, setUserId] = useState<string | null>(
    users.length === 1 ? users[0].ID : users.some((u) => u.ID === remembered) ? remembered : null,
  );
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [filled, setFilled] = useState(0);
  const gridRef = useRef<PinGridHandle>(null);
  const user = users.find((u) => u.ID === userId) ?? null;

  function pick(id: string) {
    setUserId(id);
    setError("");
    try { localStorage.setItem("lastUser", id); } catch {}
    setTimeout(() => gridRef.current?.focus(), 50);
  }

  async function submitPin(pin: string) {
    if (!userId) return;
    setIsPending(true);
    setError("");
    const data = new FormData();
    data.set("user_id", userId);
    data.set("pin", pin);
    const result = await login(data);
    if (result?.error) {
      setError(result.error);
      gridRef.current?.reset();
      setFilled(0);
      navigator.vibrate?.(100);
    }
    setIsPending(false);
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="text-xs text-[#9ca3c0] mb-1">Who are you?</p>
        <div className="flex flex-wrap justify-center gap-2 max-w-sm">
          {users.map((u) => (
            <button key={u.ID} onClick={() => pick(u.ID)}
              className="px-5 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm font-semibold text-white hover:bg-white/10 hover:border-pink-500/30 transition-all btn-press">
              {u.NAME}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {users.length > 1 && (
        <button onClick={() => { setUserId(null); setFilled(0); gridRef.current?.reset(); }} className="text-xs text-[#9ca3c0] hover:text-white transition-colors mb-4">
          <span className="text-white font-semibold">{user.NAME}</span> · not you?
        </button>
      )}
      <div className="flex justify-center gap-2 mb-6">
        {Array(6).fill(0).map((_, i) => (
          <div key={i} className={`w-2 h-2 rounded-full transition-all duration-300 ${i < filled ? "bg-gradient-to-r from-pink-500 to-purple-500 scale-110" : "bg-white/10"}`} />
        ))}
      </div>

      <PinGrid ref={gridRef} onComplete={(pin) => { setFilled(6); submitPin(pin); }} disabled={isPending} shake={!!error} autoFocus />

      <div className="h-8 flex items-center justify-center mt-4">
        {error ? (
          <p className="text-xs text-red-400 font-medium animate-fade-in">{error}</p>
        ) : isPending ? (
          <svg className="animate-spin h-4 w-4 text-purple-400" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <p className="text-[11px] text-[#5a6380]/60">Enter PIN</p>
        )}
      </div>
    </>
  );
}
