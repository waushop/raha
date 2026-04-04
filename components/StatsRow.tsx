"use client";

import AnimatedNumber from "./AnimatedNumber";

type Props = {
  total: number;
  siimPaid: number;
  jannePaid: number;
  prevTotal?: number;
  prevSiimPaid?: number;
  prevJannePaid?: number;
};

function Delta({ current, previous }: { current: number; previous: number }) {
  if (!previous || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const isUp = pct > 0;
  const abs = Math.abs(pct);
  if (abs < 0.5) return null;

  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${isUp ? "text-red-400/70" : "text-teal-400/70"}`}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className={isUp ? "" : "rotate-180"}>
        <path d="M4 1L7 5H1L4 1Z" />
      </svg>
      {abs.toFixed(0)}%
    </span>
  );
}

export default function StatsRow({ total, siimPaid, jannePaid, prevTotal = 0, prevSiimPaid = 0, prevJannePaid = 0 }: Props) {
  return (
    <div className="flex gap-3 overflow-x-auto stats-scroll sm:grid sm:grid-cols-3 sm:gap-4">
      <div className="card rounded-2xl p-4 sm:p-5 card-hover min-w-[60vw] sm:min-w-0 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-[#8892b0]">Kulud kokku</p>
          <Delta current={total} previous={prevTotal} />
        </div>
        <p className="text-xl sm:text-2xl font-bold text-white">
          <AnimatedNumber value={total} />
          <span className="text-sm text-[#4a5568] ml-1">€</span>
        </p>
        <div className="mt-2.5 h-1 w-full rounded-full overflow-hidden bg-white/5">
          <div className="h-full gradient-pink rounded-full transition-all duration-700" style={{ width: total > 0 ? "100%" : "0%" }} />
        </div>
      </div>
      <div className="card rounded-2xl p-4 sm:p-5 card-hover min-w-[60vw] sm:min-w-0 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-[#8892b0]">Siim maksis</p>
          <Delta current={siimPaid} previous={prevSiimPaid} />
        </div>
        <p className="text-xl sm:text-2xl font-bold text-white">
          <AnimatedNumber value={siimPaid} />
          <span className="text-sm text-[#4a5568] ml-1">€</span>
        </p>
        <div className="mt-2.5 h-1 w-full rounded-full overflow-hidden bg-white/5">
          <div className="h-full gradient-purple rounded-full transition-all duration-700" style={{ width: total > 0 ? `${(siimPaid / total * 100)}%` : "0%" }} />
        </div>
      </div>
      <div className="card rounded-2xl p-4 sm:p-5 card-hover min-w-[60vw] sm:min-w-0 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-[#8892b0]">Janne maksis</p>
          <Delta current={jannePaid} previous={prevJannePaid} />
        </div>
        <p className="text-xl sm:text-2xl font-bold text-white">
          <AnimatedNumber value={jannePaid} />
          <span className="text-sm text-[#4a5568] ml-1">€</span>
        </p>
        <div className="mt-2.5 h-1 w-full rounded-full overflow-hidden bg-white/5">
          <div className="h-full gradient-teal rounded-full transition-all duration-700" style={{ width: total > 0 ? `${(jannePaid / total * 100)}%` : "0%" }} />
        </div>
      </div>
    </div>
  );
}
