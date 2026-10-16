"use client";

import { useRef, useState } from "react";
import { setupInitialUser } from "@/app/login/actions";
import PinGrid, { type PinGridHandle } from "./PinGrid";

type Step = "name" | "choose" | "confirm";

export default function SetupForm() {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [chosenPin, setChosenPin] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const gridRef = useRef<PinGridHandle>(null);

  async function submit(confirmPin: string) {
    setIsPending(true);
    setError("");
    const data = new FormData();
    data.set("name", name);
    data.set("pin", chosenPin);
    data.set("confirm", confirmPin);
    const result = await setupInitialUser(data);
    if (result?.error) {
      setError(result.error);
      setChosenPin("");
      setStep("choose");
      gridRef.current?.reset();
      navigator.vibrate?.(100);
    }
    setIsPending(false);
  }

  function handleComplete(pin: string) {
    if (step === "choose") {
      setChosenPin(pin);
      setStep("confirm");
      setTimeout(() => gridRef.current?.reset(), 150);
    } else {
      submit(pin);
    }
  }

  if (step === "name") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) setStep("choose"); }} className="flex flex-col items-center gap-3">
        <p className="text-xs text-[#9ca3c0]">First, what should we call you?</p>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Your name"
          className="w-56 text-center border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 placeholder:text-[#5a6380]" />
        <button type="submit" disabled={!name.trim()} className="gradient-pink text-white rounded-xl px-6 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-40 transition-all btn-press">
          Continue
        </button>
      </form>
    );
  }

  return (
    <>
      <p className="text-xs text-[#9ca3c0] mb-1">
        {step === "choose" ? `Hi ${name.trim()}, choose a 6-digit PIN` : "Confirm PIN"}
      </p>
      {step === "choose" && <p className="text-[10px] text-[#5a6380] mb-4">Not a sequence, a repeat, a pattern or a date.</p>}

      <PinGrid ref={gridRef} onComplete={handleComplete} disabled={isPending} shake={!!error} autoFocus />

      <div className="h-8 flex items-center justify-center mt-4">
        {error ? (
          <p className="text-xs text-red-400 font-medium animate-fade-in">{error}</p>
        ) : isPending ? (
          <svg className="animate-spin h-4 w-4 text-purple-400" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <p className="text-[11px] text-[#5a6380]/60">{step === "choose" ? "Pick a PIN you'll remember" : "Enter it again to confirm"}</p>
        )}
      </div>

      {!isPending && (
        <button onClick={() => { setChosenPin(""); setError(""); setStep("name"); gridRef.current?.reset(); }} className="mt-2 text-[10px] text-[#5a6380] hover:text-pink-400 transition-colors">
          ← Start over
        </button>
      )}
    </>
  );
}
