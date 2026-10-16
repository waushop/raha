"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "This month", path: "/", icon: "🗓️" },
  { label: "Dashboard", path: "/dashboard", icon: "📊" },
  { label: "Search", path: "/search", icon: "🔍" },
  { label: "Groups", path: "/groups", icon: "📁" },
  { label: "Goals", path: "/goals", icon: "🎯" },
  { label: "Recurring", path: "/recurring", icon: "🔄" },
  { label: "Activity", path: "/activity", icon: "📝" },
  { label: "Monthly review", path: "/review", icon: "📝" },
  { label: "Analytics", path: "/analytics", icon: "📈" },
  { label: "Compare", path: "/compare", icon: "⚖️" },
  { label: "Year overview", path: `/year?year=${new Date().getFullYear()}`, icon: "📅" },
  { label: "Import bank CSV", path: "/import", icon: "📥" },
  { label: "Settings", path: "/settings", icon: "⚙️" },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
        setQuery("");
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Close on navigation (state adjusted during render, not in an effect)
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  if (!open) return null;

  const filtered = query
    ? NAV_ITEMS.filter(item => item.label.toLowerCase().includes(query.toLowerCase()))
    : NAV_ITEMS;

  function navigate(path: string) {
    router.push(path);
    setOpen(false);
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 animate-backdrop" onClick={() => setOpen(false)} />
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
        <div className="rounded-2xl panel border border-white/[0.08] shadow-[0_24px_80px_rgba(0,0,0,0.6)] overflow-hidden animate-fade-up">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5a6380" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Navigate to..."
              className="flex-1 bg-transparent text-sm text-white placeholder:text-[#5a6380] focus:outline-none"
            />
            <kbd className="text-[9px] text-[#5a6380] bg-white/5 border border-white/[0.06] rounded px-1.5 py-0.5 font-mono">ESC</kbd>
          </div>

          {/* Results */}
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map(item => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  pathname === item.path.split("?")[0] ? "bg-purple-500/10 text-white" : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span className="text-sm font-medium">{item.label}</span>
                {pathname === item.path.split("?")[0] && (
                  <span className="text-[9px] text-purple-400 ml-auto">Current</span>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-[#5a6380]">No results</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
