"use client";

import { useEffect, useRef } from "react";
import { CHROMELESS_PAGES } from "@/lib/public-pages";
import { usePathname } from "next/navigation";
import { splitHref, useNav } from "@/lib/use-nav";
import { Calendar, LayoutDashboard, Menu, Plus, Search } from "lucide-react";

// Thumb-reachable navigation for phones and tablets, in the same flat style
// as onebetwonder's bar: equal icon + label tabs on a translucent blurred
// strip, nothing raised. Above lg the sidebar is pinned and this is hidden.
// "Add" opens the form on the month page (navigating there first if needed);
// "Menu" opens the full sidebar drawer.
export const OPEN_ADD_EVENT = "open-add-expense";
export const OPEN_MENU_EVENT = "open-sidebar";

type Item = { label: string; path: string; match: (p: string) => boolean; icon: React.ReactNode };

const ITEMS: Item[] = [
  { label: "Month", path: "/", match: (p) => p === "/", icon: <Calendar size={20} /> },
  { label: "Dashboard", path: "/dashboard", match: (p) => p === "/dashboard", icon: <LayoutDashboard size={20} /> },
];
const ITEMS_RIGHT: Item[] = [
  { label: "Search", path: "/search", match: (p) => p === "/search", icon: <Search size={20} /> },
];

export default function BottomNav() {
  const pathname = usePathname();
  const { go, pending } = useNav();
  const shownPath = pending ? splitHref(pending).path : pathname;
  const pendingAdd = useRef(false);

  // "+" pressed on another page: open the form once the month page is there.
  useEffect(() => {
    if (pendingAdd.current && pathname === "/") {
      pendingAdd.current = false;
      window.dispatchEvent(new Event(OPEN_ADD_EVENT));
    }
  }, [pathname]);

  if (CHROMELESS_PAGES.has(pathname)) return null;

  function add() {
    navigator.vibrate?.(10);
    if (pathname === "/") window.dispatchEvent(new Event(OPEN_ADD_EVENT));
    else { pendingAdd.current = true; go("/"); }
  }

  const tab = (item: Item) => {
    const active = item.match(shownPath);
    return (
      <button key={item.path} onClick={() => go(item.path)} aria-label={item.label} aria-current={active ? "page" : undefined}
        className={`flex-1 flex items-center justify-center py-1.5 transition-colors ${active ? "text-white" : "text-[#5a6380] hover:text-[#9ca3c0]"}`}>
        <span className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-[18px] transition-all duration-300 ${active ? "nav-active" : ""}`}>
          {item.icon}
          <span className="text-[10px] font-semibold tracking-tight">{item.label}</span>
        </span>
      </button>
    );
  };

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-white/[0.08] bottom-bar" aria-label="Main" style={{ paddingBottom: "var(--sab, 0px)" }}>
      <div className="flex items-center justify-around px-1 h-16 max-w-xl mx-auto">
        {ITEMS.map(tab)}
        <button onClick={add} aria-label="Add expense" className="flex-1 flex items-center justify-center py-1 group">
          <span className="add-orb w-12 h-12 rounded-full flex items-center justify-center transition-transform duration-200 group-active:scale-95">
            <Plus size={22} strokeWidth={2.4} />
          </span>
        </button>
        {ITEMS_RIGHT.map(tab)}
        <button onClick={() => window.dispatchEvent(new Event(OPEN_MENU_EVENT))} aria-label="Menu"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-3 text-[#5a6380] hover:text-[#9ca3c0] transition-colors">
          <Menu size={20} />
          <span className="text-[10px] font-semibold tracking-tight">Menu</span>
        </button>
      </div>
    </nav>
  );
}
