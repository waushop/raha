"use client";

import { useState } from "react";

const fmt = (n: number) =>
  n.toLocaleString("et-EE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CopyAmount({ amount }: { amount: number }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(fmt(amount));
    setCopied(true);
    navigator.vibrate?.(10);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="text-2xl font-bold text-amber-400 font-mono tabular-nums mt-1 hover:text-amber-300 transition-colors cursor-pointer group relative inline-flex items-center gap-2"
      title="Kopeeri summa"
    >
      {fmt(amount)} €
      <span className={`text-xs transition-all duration-200 ${copied ? "opacity-100 text-teal-400" : "opacity-0 group-hover:opacity-50 text-[#4a5568]"}`}>
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        )}
      </span>
    </button>
  );
}
