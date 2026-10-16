"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { logout } from "@/app/login/actions";
import { listMonths, whoAmI } from "@/app/actions";
import { addMonths, currentMonth, monthLabel } from "@/lib/months";
import ThemeToggle from "./ThemeToggle";
import { OPEN_MENU_EVENT } from "./BottomNav";

// Current month back to the oldest month with data, newest first. A fresh
// ledger shows just the current month; the list grows as entries are added
// (earlier months are still reachable with the arrows on the month page).
function generateMonths(oldestMonth: string): { value: string; label: string }[] {
  const months: { value: string; label: string }[] = [];
  const floor = oldestMonth < currentMonth() ? oldestMonth : currentMonth();
  for (let m = currentMonth(); m >= floor; m = addMonths(m, -1)) {
    months.push({ value: m, label: monthLabel(m) });
  }
  return months;
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const [oldestMonth, setOldestMonth] = useState<string>(currentMonth());
  const [userName, setUserName] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Close on route change. Adjusting state during render (instead of in an
  // effect) avoids an extra render pass and satisfies the hooks lint rules.
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [seenRouteKey, setSeenRouteKey] = useState(routeKey);
  if (seenRouteKey !== routeKey) {
    setSeenRouteKey(routeKey);
    setOpen(false);
  }

  // Close on Escape; open from the bottom bar's Menu button
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onOpen() { setOpen(true); }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_MENU_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_MENU_EVENT, onOpen);
    };
  }, []);

  // Oldest month with data decides how far back the month list goes. Not on
  // /login: the action requires auth.
  useEffect(() => {
    if (pathname === "/login") return;
    listMonths().then((ms) => { const oldest = ms.at(-1); if (oldest) setOldestMonth(oldest); }).catch(() => {});
    whoAmI().then((u) => setUserName(u?.name ?? null)).catch(() => {});
  }, [pathname]);

  // Hooks above this line must run on every render, including on /login.
  if (pathname === "/login") return null;

  const activeMonth = searchParams.get("month") ?? currentMonth();
  const isYearPage = pathname === "/year";
  const currentYear = searchParams.get("year") ?? String(new Date().getFullYear());
  const months = generateMonths(oldestMonth);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40 animate-backdrop" onClick={() => setOpen(false)} />
      )}

      {/* Sidebar panel */}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-50 w-72 panel border-r border-white/[0.08] flex flex-col transition-transform duration-300 ease-out lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="px-5 pt-6 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center justify-between">
            <h2
              className="text-2xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent"
              style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}
            >
              Empty Wallet
            </h2>
            <button
              onClick={() => setOpen(false)}
              className="lg:hidden w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-[#5a6380] hover:text-white transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {/* Dashboard */}
          <div>
            <button
              onClick={() => router.push("/dashboard")}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                pathname === "/dashboard"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
              </svg>
              Dashboard
            </button>
          </div>

          {/* Months */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#5a6380] px-2 mb-2">Months</p>
            <div className="space-y-0.5">
              {months.map(({ value, label }) => {
                const isActive = !isYearPage && activeMonth === value;
                return (
                  <button
                    key={value}
                    onClick={() => router.push(`/?month=${value}`)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                      isActive
                        ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                        : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span className="capitalize">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Manage */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#5a6380] px-2 mb-2">Manage</p>
            <button
              onClick={() => router.push("/search")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 mb-0.5 ${
                pathname === "/search"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              Search
            </button>
            <button
              onClick={() => router.push("/activity")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 mb-0.5 ${
                pathname === "/activity"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              Activity
            </button>
            <button
              onClick={() => router.push("/recurring")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 mb-0.5 ${
                pathname === "/recurring"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
              </svg>
              Recurring
            </button>
            <button
              onClick={() => router.push("/groups")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                pathname === "/groups"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              Groups
            </button>
            <button
              onClick={() => router.push("/goals")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 mt-0.5 ${
                pathname === "/goals"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
              </svg>
              Goals
            </button>
            <button
              onClick={() => router.push("/import")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 mt-0.5 ${
                pathname === "/import"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Import
            </button>
          </div>

          {/* Overviews */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#5a6380] px-2 mb-2">Overview</p>
            <div className="space-y-0.5">
              <button
                onClick={() => router.push("/review")}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                  pathname === "/review"
                    ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                    : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                Monthly review
              </button>
              <button
                onClick={() => router.push(`/year?year=${currentYear}`)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                  isYearPage
                    ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                    : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Year {currentYear}
              </button>
              <button
                onClick={() => router.push("/analytics")}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                  pathname === "/analytics"
                    ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                    : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 20V10M12 20V4M6 20v-6" />
                </svg>
                Analytics
              </button>
              <button
                onClick={() => router.push("/compare")}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                  pathname === "/compare"
                    ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                    : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
                </svg>
                Compare
              </button>
            </div>
          </div>

          {/* Export */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#5a6380] px-2 mb-2">Export</p>
            <a
              href={`/api/export?month=${activeMonth}`}
              className="w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 text-[#9ca3c0] hover:bg-white/5 hover:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download CSV
            </a>
          </div>
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-white/[0.06] space-y-0.5">
          <button
            onClick={() => router.push("/settings")}
            className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
              pathname === "/settings"
                ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                : "text-[#5a6380] hover:bg-white/5 hover:text-[#9ca3c0]"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            Settings
          </button>
          <ThemeToggle />
          <button
            onClick={() => logout()}
            className="w-full text-left px-3 py-2 rounded-xl text-sm font-medium text-[#5a6380] hover:bg-red-500/10 hover:text-red-400 transition-all flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Log out{userName && <span className="text-[#5a6380]/70 font-normal ml-auto truncate max-w-[7rem]">{userName}</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
