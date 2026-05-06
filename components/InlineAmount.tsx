"use client";

import { useState, useRef, useTransition, useEffect } from "react";
import { updateExpenseAmount } from "@/app/actions";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
  expenseId: string;
  amount: number;
};

export default function InlineAmount({ expenseId, amount }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(amount.toString());
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function save() {
    const newAmount = parseFloat(value);
    if (isNaN(newAmount) || newAmount === amount) {
      setEditing(false);
      setValue(amount.toString());
      return;
    }
    startTransition(async () => {
      await updateExpenseAmount(expenseId, newAmount);
      setEditing(false);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") { setEditing(false); setValue(amount.toString()); }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        type="number"
        step="0.01"
        className="w-20 text-right text-sm font-mono font-semibold bg-purple-500/10 border border-purple-500/30 rounded-lg px-2 py-0.5 text-white focus:outline-none tabular-nums"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-sm font-mono font-semibold text-white/80 tabular-nums hover:text-purple-400 transition-colors cursor-text"
      title="Click to edit"
    >
      {fmt(amount)} €
    </button>
  );
}
