"use client";

import { splitHref, useNav } from "@/lib/use-nav";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, currentMonth, monthLabel } from "@/lib/months";

export default function MonthNav({ month }: { month: string }) {
  const { go, pending } = useNav();
  // Show the month being opened straight away; the page follows when ready.
  const shown = pending ? (splitHref(pending).params.get("month") ?? currentMonth()) : month;
  const isCurrentMonth = shown === currentMonth();

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {!isCurrentMonth && (
        <button
          onClick={() => go("/")}
          className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2 sm:px-2.5 py-1.5 rounded-lg bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 transition-all btn-press mr-0.5 sm:mr-1"
        >
          Today
        </button>
      )}
      <button
        onClick={() => go(`/?month=${addMonths(shown, -1)}`)}
        aria-label="Previous month"
        className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-pink-500/30 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="font-semibold text-xs sm:text-sm capitalize w-28 sm:w-40 text-center text-white/85 leading-tight whitespace-nowrap">
        {monthLabel(shown)}
      </span>
      <button
        onClick={() => go(`/?month=${addMonths(shown, 1)}`)}
        aria-label="Next month"
        className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-pink-500/30 flex items-center justify-center text-[#9ca3c0] hover:text-pink-400 transition-all btn-press"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
