"use client";

import { useState, useEffect } from "react";
import NotificationBell from "./NotificationBell";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { logout } from "@/app/login/actions";
import { listMonths, whoAmI } from "@/app/actions";
import { addMonths, currentMonth, monthLabel } from "@/lib/months";
import { Activity, ArrowLeftRight, CalendarRange, ChartColumn, ClipboardList, Download, Folder, LayoutDashboard, LogOut, Repeat, Search, Settings, Target, Upload, X, ListChecks, ChartLine, Landmark } from "lucide-react";
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
  const [workspace, setWorkspace] = useState<{ name: string; kind: "personal" | "shared" } | null>(null);
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
    whoAmI().then((u) => { setUserName(u?.name ?? null); setWorkspace(u ? { name: u.workspaceName, kind: u.workspaceKind } : null); }).catch(() => {});
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
            <div className="flex items-center gap-1">
              <NotificationBell />
              <button
                onClick={() => setOpen(false)}
                className="lg:hidden w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-[#5a6380] hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <WorkspaceSwitcher current={workspace} />
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
              <LayoutDashboard size={14} />
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
              <Search size={14} />
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
              <Activity size={14} />
              Activity
            </button>
            <button
              onClick={() => router.push("/subscriptions")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 mb-0.5 ${
                pathname === "/subscriptions"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <Repeat size={14} strokeWidth={2.5} />
              Subscriptions
            </button>
            <button
              onClick={() => router.push("/groups")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                pathname === "/groups"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <Folder size={14} />
              Groups
            </button>
            <button
              onClick={() => router.push("/plan")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 mt-0.5 ${
                pathname === "/plan"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <ListChecks size={14} />
              Plan
            </button>
            <button
              onClick={() => router.push("/cashflow")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 mt-0.5 ${
                pathname === "/cashflow"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <ChartLine size={14} />
              Cash flow
            </button>
            <button
              onClick={() => router.push("/networth")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 mt-0.5 ${
                pathname === "/networth"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <Landmark size={14} />
              Net worth
            </button>
            <button
              onClick={() => router.push("/goals")}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 mt-0.5 ${
                pathname === "/goals"
                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 text-white border border-pink-500/20"
                  : "text-[#9ca3c0] hover:bg-white/5 hover:text-white"
              }`}
            >
              <Target size={14} />
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
              <Upload size={14} />
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
                <ClipboardList size={14} />
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
                <CalendarRange size={14} />
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
                <ChartColumn size={14} />
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
                <ArrowLeftRight size={14} />
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
              <Download size={14} />
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
            <Settings size={14} />
            Settings
          </button>
          <ThemeToggle />
          <button
            onClick={() => logout()}
            className="w-full text-left px-3 py-2 rounded-xl text-sm font-medium text-[#5a6380] hover:bg-red-500/10 hover:text-red-400 transition-all flex items-center gap-2"
          >
            <LogOut size={14} />
            Log out{userName && <span className="text-[#5a6380]/70 font-normal ml-auto truncate max-w-[7rem]">{userName}</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
