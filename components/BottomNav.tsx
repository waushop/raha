"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

// Thumb-reachable navigation for phones and tablets. Above lg the sidebar is
// pinned and this bar is hidden. "+" opens the add form on the month page
// (navigating there first if needed); "Menu" opens the full sidebar drawer.
export const OPEN_ADD_EVENT = "open-add-expense";
export const OPEN_MENU_EVENT = "open-sidebar";

type Item = { label: string; path: string; match: (p: string) => boolean; icon: React.ReactNode };

const ICON = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const ITEMS: Item[] = [
  { label: "Month", path: "/", match: (p) => p === "/", icon: <svg {...ICON}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg> },
  { label: "Dashboard", path: "/dashboard", match: (p) => p === "/dashboard", icon: <svg {...ICON}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg> },
];
const ITEMS_RIGHT: Item[] = [
  { label: "Search", path: "/search", match: (p) => p === "/search", icon: <svg {...ICON}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg> },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const pendingAdd = useRef(false);

  // "+" pressed on another page: open the form once the month page is there.
  useEffect(() => {
    if (pendingAdd.current && pathname === "/") {
      pendingAdd.current = false;
      window.dispatchEvent(new Event(OPEN_ADD_EVENT));
    }
  }, [pathname]);

  if (pathname === "/login") return null;

  function add() {
    navigator.vibrate?.(10);
    if (pathname === "/") window.dispatchEvent(new Event(OPEN_ADD_EVENT));
    else { pendingAdd.current = true; router.push("/"); }
  }

  const tab = (item: Item) => {
    const active = item.match(pathname);
    return (
      <button key={item.path} onClick={() => router.push(item.path)} aria-label={item.label} aria-current={active ? "page" : undefined}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${active ? "text-pink-400" : "text-[#5a6380] hover:text-[#9ca3c0]"}`}>
        {item.icon}
        <span className="text-[9px] font-semibold">{item.label}</span>
      </button>
    );
  };

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 panel border-t border-white/[0.08] pb-[env(safe-area-inset-bottom)]" aria-label="Main">
      <div className="flex items-stretch h-16 max-w-xl mx-auto">
        {ITEMS.map(tab)}
        <button onClick={add} aria-label="Add expense" className="flex-1 flex items-center justify-center">
          <span className="-mt-6 w-14 h-14 rounded-2xl gradient-pink shadow-xl shadow-pink-500/30 flex items-center justify-center btn-press">
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
          </span>
        </button>
        {ITEMS_RIGHT.map(tab)}
        <button onClick={() => window.dispatchEvent(new Event(OPEN_MENU_EVENT))} aria-label="Menu"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[#5a6380] hover:text-[#9ca3c0] transition-colors">
          <svg {...ICON}><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          <span className="text-[9px] font-semibold">Menu</span>
        </button>
      </div>
    </nav>
  );
}
