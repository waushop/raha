"use client";

import { useState, useEffect } from "react";

const shortcuts = [
  { key: "N", desc: "Add expense" },
  { key: "⌘K", desc: "Navigate" },
  { key: "?", desc: "Shortcuts" },
  { key: "Esc", desc: "Close" },
];

export default function KeyboardHints() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setShow(s => !s);
      }
      if (e.key === "Escape" && show) setShow(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [show]);

  if (!show) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50 animate-backdrop" onClick={() => setShow(false)} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 card rounded-2xl p-6 w-72 animate-fade-up">
        <h3 className="text-sm font-bold text-white mb-4">Shortcuts</h3>
        <div className="space-y-2.5">
          {shortcuts.map(({ key, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-[#9ca3c0]">{desc}</span>
              <kbd className="text-[10px] font-mono font-bold bg-white/5 text-[#9ca3c0] border border-white/10 rounded px-2 py-1">{key}</kbd>
            </div>
          ))}
        </div>
        <button onClick={() => setShow(false)} className="mt-4 w-full text-xs text-[#5a6380] hover:text-white transition-colors text-center py-1">
          Close
        </button>
      </div>
    </>
  );
}
