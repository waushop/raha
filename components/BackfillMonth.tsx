"use client";

import { useState, useTransition } from "react";
import { backfillMonth } from "@/app/actions";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function lastNMonths(n: number, anchor: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function fmt(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

type Props = {
  existingMonths: string[];
};

export default function BackfillMonth({ existingMonths }: Props) {
  // Source defaults to the most recent month with data.
  const [source, setSource] = useState<string>(existingMonths[0] ?? "");
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string>("");
  const [pending, startTransition] = useTransition();

  // Show the current calendar year + last 24 months as candidate targets, minus
  // any month that already has data (avoid accidental dupes).
  const candidateMonths = Array.from(
    new Set([...lastNMonths(24), ...existingMonths]),
  )
    .sort()
    .reverse()
    .filter((m) => !existingMonths.includes(m) || m === source);

  function toggle(month: string) {
    const next = new Set(targets);
    if (next.has(month)) next.delete(month);
    else next.add(month);
    setTargets(next);
  }

  function submit() {
    if (!source || targets.size === 0) return;
    setResult("");
    startTransition(async () => {
      const list = Array.from(targets).filter((m) => m !== source);
      const count = await backfillMonth(source, list);
      setResult(
        count === 0
          ? "Nothing inserted (target months already have matching entries)."
          : `Copied ${count} ${count === 1 ? "entry" : "entries"} into ${list.length} ${list.length === 1 ? "month" : "months"}.`,
      );
      setTargets(new Set());
    });
  }

  if (existingMonths.length === 0) {
    return (
      <p className="text-xs text-[#5a6380]">Add some expenses first, then come back here to clone them into other months.</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Source */}
      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">From</span>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          disabled={pending}
          className="mt-1 w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50 disabled:opacity-40"
        >
          {existingMonths.map((m) => (
            <option key={m} value={m} className="bg-[#1a1a2e]">
              {fmt(m)}
            </option>
          ))}
        </select>
      </label>

      {/* Targets */}
      <div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">To</span>
        <p className="text-[10px] text-[#5a6380]/70 mt-0.5 mb-2">
          Months that already have entries are hidden to avoid accidental duplicates.
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {candidateMonths
            .filter((m) => m !== source)
            .map((m) => {
              const checked = targets.has(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggle(m)}
                  disabled={pending}
                  className={`px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                    checked
                      ? "bg-purple-500/20 border-purple-500/50 text-white"
                      : "bg-white/[0.03] border-white/[0.08] text-[#9ca3c0] hover:bg-white/5 hover:text-white"
                  } disabled:opacity-40`}
                >
                  {fmt(m)}
                </button>
              );
            })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={pending || !source || targets.size === 0}
          className="px-4 py-2 rounded-xl gradient-pink text-white text-xs font-bold shadow-lg shadow-pink-500/20 btn-press hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? "Copying…" : `Copy to ${targets.size} ${targets.size === 1 ? "month" : "months"}`}
        </button>
        {result && (
          <p className="text-xs text-teal-400 font-medium animate-fade-in">{result}</p>
        )}
      </div>
    </div>
  );
}
