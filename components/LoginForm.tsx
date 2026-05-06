"use client";

import { useRef, useState } from "react";
import { login } from "@/app/login/actions";
import PinGrid, { type PinGridHandle } from "./PinGrid";

export default function LoginForm() {
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [filled, setFilled] = useState(0);
  const gridRef = useRef<PinGridHandle>(null);

  async function submitPin(pin: string) {
    setIsPending(true);
    setError("");
    const data = new FormData();
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

  return (
    <>
      <div className="flex justify-center gap-2 mb-6">
        {Array(6)
          .fill(0)
          .map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                i < filled
                  ? "bg-gradient-to-r from-pink-500 to-purple-500 scale-110"
                  : "bg-white/10"
              }`}
            />
          ))}
      </div>

      <PinGrid
        ref={gridRef}
        onComplete={(pin) => {
          setFilled(6);
          submitPin(pin);
        }}
        disabled={isPending}
        shake={!!error}
        autoFocus
      />

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
