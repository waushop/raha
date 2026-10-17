"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Activity,
  ArrowLeftRight,
  Calendar,
  CalendarRange,
  ChartColumn,
  ClipboardList,
  Folder,
  LayoutDashboard,
  Repeat,
  Search,
  Settings,
  Target,
  Upload, ListChecks, ChartLine } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const NAV_ITEMS: Array<{ label: string; path: string; icon: LucideIcon }> = [
  { label: "This month", path: "/", icon: Calendar },
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Search", path: "/search", icon: Search },
  { label: "Groups", path: "/groups", icon: Folder },
  { label: "Goals", path: "/goals", icon: Target },
  { label: "Plan (zero-based)", path: "/plan", icon: ListChecks },
  { label: "Cash flow / safe to spend", path: "/cashflow", icon: ChartLine },
  { label: "Subscriptions", path: "/subscriptions", icon: Repeat },
  { label: "Activity", path: "/activity", icon: Activity },
  { label: "Monthly review", path: "/review", icon: ClipboardList },
  { label: "Analytics", path: "/analytics", icon: ChartColumn },
  { label: "Compare", path: "/compare", icon: ArrowLeftRight },
  { label: "Year overview", path: `/year?year=${new Date().getFullYear()}`, icon: CalendarRange },
  { label: "Import bank CSV", path: "/import", icon: Upload },
  { label: "Settings", path: "/settings", icon: Settings },
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
            <Search size={16} className="text-[#5a6380]" />
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
                <span className="text-base inline-flex items-center justify-center shrink-0"><item.icon size={16} className="text-[#9ca3c0]" /></span>
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
