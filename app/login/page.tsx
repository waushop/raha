"use client";

import { useRef, useState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  function handleChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    setError("");

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (digit && index === 5 && newDigits.every(d => d !== "")) {
      submitPin(newDigits.join(""));
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const newDigits = Array(6).fill("");
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i];
    }
    setDigits(newDigits);
    if (pasted.length === 6) {
      submitPin(pasted);
    } else {
      inputRefs.current[pasted.length]?.focus();
    }
  }

  async function submitPin(pin: string) {
    setIsPending(true);
    const data = new FormData();
    data.set("pin", pin);
    const result = await login(data);
    if (result?.error) {
      setError(result.error);
      setDigits(Array(6).fill(""));
      inputRefs.current[0]?.focus();
      navigator.vibrate?.(100);
    }
    setIsPending(false);
  }

  const filled = digits.filter(d => d !== "").length;

  return (
    <main className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Decorative blurred circles */}
      <div className="absolute top-1/4 -left-32 w-64 h-64 rounded-full bg-purple-500/10 blur-[100px]" />
      <div className="absolute bottom-1/4 -right-32 w-64 h-64 rounded-full bg-pink-500/10 blur-[100px]" />

      <div className="animate-fade-up text-center">
        {/* Logo area */}
        <div className="mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-pink-500/20 to-purple-500/20 border border-white/10 mb-6 shadow-2xl shadow-purple-500/10">
            <span className="text-4xl">💸</span>
          </div>
          <h1
            className="text-5xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight"
            style={{ fontFamily: "'Caveat', cursive", fontWeight: 700 }}
          >
            Tühi Rahakott
          </h1>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-6">
          {Array(6).fill(0).map((_, i) => (
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

        {/* PIN inputs — no card wrapper, just floating */}
        <div className="flex justify-center items-center gap-2" onPaste={handlePaste}>
          {[0, 1, 2].map((i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={digits[i]}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              autoFocus={i === 0}
              disabled={isPending}
              className={`w-14 h-16 text-center text-2xl font-mono font-bold rounded-2xl border-2 bg-white/[0.03] backdrop-blur-sm text-white focus:outline-none transition-all duration-200 ${
                error
                  ? "border-red-500/60 shake"
                  : digits[i]
                  ? "border-purple-500/60 bg-purple-500/10 shadow-lg shadow-purple-500/10"
                  : "border-white/[0.08] focus:border-purple-500/50 focus:bg-purple-500/5"
              } disabled:opacity-40`}
            />
          ))}

          <span className="text-xl font-bold text-white/10">—</span>

          {[3, 4, 5].map((i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={digits[i]}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={isPending}
              className={`w-14 h-16 text-center text-2xl font-mono font-bold rounded-2xl border-2 bg-white/[0.03] backdrop-blur-sm text-white focus:outline-none transition-all duration-200 ${
                error
                  ? "border-red-500/60 shake"
                  : digits[i]
                  ? "border-purple-500/60 bg-purple-500/10 shadow-lg shadow-purple-500/10"
                  : "border-white/[0.08] focus:border-purple-500/50 focus:bg-purple-500/5"
              } disabled:opacity-40`}
            />
          ))}
        </div>

        {/* Error / Status */}
        <div className="h-8 flex items-center justify-center mt-4">
          {error ? (
            <p className="text-xs text-red-400 font-medium animate-fade-in">{error}</p>
          ) : isPending ? (
            <svg className="animate-spin h-4 w-4 text-purple-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <p className="text-[11px] text-[#4a5568]/60">Sisesta PIN</p>
          )}
        </div>
      </div>
    </main>
  );
}
