"use client";

import { useRef, useState } from "react";
import { setupInitialPin } from "@/app/login/actions";
import PinGrid, { type PinGridHandle } from "./PinGrid";

type Step = "choose" | "confirm";

export default function SetupForm() {
  const [step, setStep] = useState<Step>("choose");
  const [chosenPin, setChosenPin] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);
  const gridRef = useRef<PinGridHandle>(null);

  async function submit(confirmPin: string) {
    setIsPending(true);
    setError("");
    const data = new FormData();
    data.set("pin", chosenPin);
    data.set("confirm", confirmPin);
    const result = await setupInitialPin(data);
    if (result?.error) {
      setError(result.error);
      // Reset to step 1 so the user re-enters from scratch.
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
      // Slight delay so the user sees the dots fill before the grid resets.
      setTimeout(() => gridRef.current?.reset(), 150);
    } else {
      submit(pin);
    }
  }

  return (
    <>
      <p className="text-xs text-[#9ca3c0] mb-4">
        {step === "choose" ? "Choose a 6-digit PIN" : "Confirm PIN"}
      </p>

      <PinGrid
        ref={gridRef}
        onComplete={handleComplete}
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
          <p className="text-[11px] text-[#5a6380]/60">
            {step === "choose" ? "Pick a PIN you'll remember" : "Enter it again to confirm"}
          </p>
        )}
      </div>

      {step === "confirm" && !isPending && (
        <button
          onClick={() => {
            setChosenPin("");
            setError("");
            setStep("choose");
            gridRef.current?.reset();
          }}
          className="mt-2 text-[10px] text-[#5a6380] hover:text-pink-400 transition-colors"
        >
          ← Start over
        </button>
      )}
    </>
  );
}
