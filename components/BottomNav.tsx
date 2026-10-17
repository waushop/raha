"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Calendar, CirclePlus, LayoutDashboard, Menu, Search } from "lucide-react";

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
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-white/[0.08] bottom-bar" aria-label="Main" style={{ paddingBottom: "var(--sab, 0px)" }}>
      <div className="flex items-center justify-around px-1 h-14 max-w-xl mx-auto">
        {ITEMS.map(tab)}
        <button onClick={add} aria-label="Add expense" className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-pink-400 hover:text-pink-300 transition-colors">
          <CirclePlus size={20} />
          <span className="text-[9px] font-semibold">Add</span>
        </button>
        {ITEMS_RIGHT.map(tab)}
        <button onClick={() => window.dispatchEvent(new Event(OPEN_MENU_EVENT))} aria-label="Menu"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[#5a6380] hover:text-[#9ca3c0] transition-colors">
          <Menu size={20} />
          <span className="text-[9px] font-semibold">Menu</span>
        </button>
      </div>
    </nav>
  );
}
