"use client";

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

export type PinGridHandle = {
  reset: () => void;
  focus: () => void;
};

type Props = {
  onComplete: (pin: string) => void;
  disabled?: boolean;
  shake?: boolean;
  autoFocus?: boolean;
};

const PinGrid = forwardRef<PinGridHandle, Props>(function PinGrid(
  { onComplete, disabled, shake, autoFocus },
  ref,
) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useImperativeHandle(ref, () => ({
    reset: () => {
      setDigits(Array(6).fill(""));
      inputRefs.current[0]?.focus();
    },
    focus: () => inputRefs.current[0]?.focus(),
  }));

  useEffect(() => {
    if (autoFocus) inputRefs.current[0]?.focus();
  }, [autoFocus]);

  function handleChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
    if (digit && index === 5 && newDigits.every((d) => d !== "")) {
      onComplete(newDigits.join(""));
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
    for (let i = 0; i < pasted.length; i++) newDigits[i] = pasted[i];
    setDigits(newDigits);
    if (pasted.length === 6) {
      onComplete(pasted);
    } else {
      inputRefs.current[pasted.length]?.focus();
    }
  }

  return (
    <div className="flex justify-center items-center gap-1.5 sm:gap-2" onPaste={handlePaste}>
      {[0, 1, 2].map((i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={digits[i]}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          className={`w-10 h-12 text-xl sm:w-14 sm:h-16 sm:text-2xl text-center font-mono font-bold rounded-2xl border-2 bg-white/[0.03] text-white appearance-none focus:outline-none transition-[border-color,background-color,box-shadow] duration-200 ${
            shake
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
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={digits[i]}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          className={`w-10 h-12 text-xl sm:w-14 sm:h-16 sm:text-2xl text-center font-mono font-bold rounded-2xl border-2 bg-white/[0.03] text-white appearance-none focus:outline-none transition-[border-color,background-color,box-shadow] duration-200 ${
            shake
              ? "border-red-500/60 shake"
              : digits[i]
                ? "border-purple-500/60 bg-purple-500/10 shadow-lg shadow-purple-500/10"
                : "border-white/[0.08] focus:border-purple-500/50 focus:bg-purple-500/5"
          } disabled:opacity-40`}
        />
      ))}
    </div>
  );
});

export default PinGrid;
