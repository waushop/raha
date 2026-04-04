"use client";

import { useToast } from "./Toast";

export default function ShareButton({ text }: { text: string }) {
  const toast = useToast();

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // User cancelled or not supported, fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(text);
    toast.show("Kokkuvõte kopeeritud");
  }

  return (
    <button
      onClick={handleShare}
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#4a5568] hover:text-white/70 transition-colors"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
        <polyline points="16 6 12 2 8 6" />
        <line x1="12" y1="2" x2="12" y2="15" />
      </svg>
      Jaga
    </button>
  );
}
