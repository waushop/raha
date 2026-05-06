"use client";

import { useRef, useState } from "react";
import { changePin } from "@/app/login/actions";
import PinGrid, { type PinGridHandle } from "./PinGrid";

type Step = "current" | "next" | "confirm";

const STEP_LABEL: Record<Step, string> = {
  current: "Current PIN",
  next: "New PIN",
  confirm: "Confirm new PIN",
};

export default function ChangePin() {
  const [step, setStep] = useState<Step>("current");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const gridRef = useRef<PinGridHandle>(null);

  function reset(toStep: Step = "current") {
    setCurrent("");
    setNext("");
    setError("");
    setStep(toStep);
    setTimeout(() => gridRef.current?.reset(), 50);
  }

  async function submit(confirmPin: string) {
    setIsPending(true);
    setError("");
    const data = new FormData();
    data.set("current", current);
    data.set("next", next);
    data.set("confirm", confirmPin);
    const result = await changePin(data);
    if (result?.error) {
      setError(result.error);
      reset();
      navigator.vibrate?.(100);
    } else if (result?.ok) {
      setSuccess(true);
      reset();
      // Auto-clear the success banner after a few seconds.
      setTimeout(() => setSuccess(false), 4000);
    }
    setIsPending(false);
  }

  function handleComplete(pin: string) {
    if (step === "current") {
      setCurrent(pin);
      setStep("next");
      setTimeout(() => gridRef.current?.reset(), 150);
    } else if (step === "next") {
      setNext(pin);
      setStep("confirm");
      setTimeout(() => gridRef.current?.reset(), 150);
    } else {
      submit(pin);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <p className="text-xs text-[#9ca3c0] mb-3">{STEP_LABEL[step]}</p>

      <PinGrid
        ref={gridRef}
        onComplete={handleComplete}
        disabled={isPending}
        shake={!!error}
      />

      <div className="h-7 flex items-center justify-center mt-3">
        {error ? (
          <p className="text-xs text-red-400 font-medium animate-fade-in">{error}</p>
        ) : success ? (
          <p className="text-xs text-teal-400 font-medium animate-fade-in">PIN changed</p>
        ) : isPending ? (
          <svg className="animate-spin h-4 w-4 text-purple-400" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <p className="text-[10px] text-[#5a6380]/60">
            Step {step === "current" ? 1 : step === "next" ? 2 : 3} of 3
          </p>
        )}
      </div>

      {step !== "current" && !isPending && !success && (
        <button
          onClick={() => reset()}
          className="mt-1 text-[10px] text-[#5a6380] hover:text-pink-400 transition-colors"
        >
          ← Start over
        </button>
      )}
    </div>
  );
}
