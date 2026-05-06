"use client";

import { useRouter } from "next/navigation";

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function defaultMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

const MIN_MONTH = "2026-01";

export default function MonthNav({ month }: { month: string }) {
  const router = useRouter();
  const isCurrentMonth = month === defaultMonth();
  const isMinMonth = month <= MIN_MONTH;

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {!isCurrentMonth && (
        <button
          onClick={() => router.push("/")}
          className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 transition-all btn-press mr-1"
        >
          Today
        </button>
      )}
      <button
        onClick={() => !isMinMonth && router.push(`/?month=${addMonths(month, -1)}`)}
        disabled={isMinMonth}
        className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-pink-500/30 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press disabled:opacity-20 disabled:hover:bg-white/5 disabled:hover:border-white/10 disabled:hover:text-[#9ca3c0] disabled:cursor-not-allowed"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <span className="font-semibold text-xs sm:text-sm capitalize w-28 sm:w-40 text-center text-[#9ca3c0]">
        {formatLabel(month)}
      </span>
      <button
        onClick={() => router.push(`/?month=${addMonths(month, 1)}`)}
        className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-pink-500/30 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}
