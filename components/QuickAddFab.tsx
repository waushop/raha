"use client";

import { useState, useEffect } from "react";

export default function QuickAddFab({ onAdd }: { onAdd: () => void }) {
  const [visible, setVisible] = useState(false);

  // Show FAB after a short delay and only when scrolled down a bit
  useEffect(() => {
    let scrollY = 0;
    function onScroll() {
      scrollY = window.scrollY;
      setVisible(scrollY > 200);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={onAdd}
      className="sm:hidden fixed bottom-6 right-6 z-30 w-14 h-14 rounded-2xl gradient-pink shadow-xl shadow-pink-500/30 flex items-center justify-center btn-press animate-fade-up"
      aria-label="Lisa kulu"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}
