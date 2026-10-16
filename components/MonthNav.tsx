"use client";

import { useRouter } from "next/navigation";
import { addMonths, currentMonth, monthLabel } from "@/lib/months";

export default function MonthNav({ month }: { month: string }) {
  const router = useRouter();
  const isCurrentMonth = month === currentMonth();

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {!isCurrentMonth && (
        <button
          onClick={() => router.push("/")}
          className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2 sm:px-2.5 py-1.5 rounded-lg bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 transition-all btn-press mr-0.5 sm:mr-1"
        >
          Today
        </button>
      )}
      <button
        onClick={() => router.push(`/?month=${addMonths(month, -1)}`)}
        aria-label="Previous month"
        className="w-7 h-7 sm:w-9 sm:h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-pink-500/30 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <span className="font-semibold text-[11px] sm:text-sm capitalize w-[4.5rem] sm:w-40 text-center text-[#9ca3c0] leading-tight">
        {monthLabel(month)}
      </span>
      <button
        onClick={() => router.push(`/?month=${addMonths(month, 1)}`)}
        aria-label="Next month"
        className="w-7 h-7 sm:w-9 sm:h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-pink-500/30 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}
