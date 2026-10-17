"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "dark" | "light";

const STORAGE_KEY = "theme";
const CHANGE_EVENT = "themechange";

function readTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

// localStorage is the source of truth; the inline script in app/layout.tsx
// applies it before paint, and this component just mirrors it. Using an
// external store (rather than setState in an effect) keeps hydration clean:
// the server snapshot is always "dark".
export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode or storage disabled: still switch for this page view.
    }
    if (next === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#e7e5e1" : "#111112");
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <button
      onClick={toggle}
      className="w-full text-left px-3 py-2 rounded-xl text-sm font-medium text-[#5a6380] hover:bg-white/5 hover:text-[#9ca3c0] transition-all flex items-center gap-2"
    >
      {theme === "dark" ? (
        <Sun size={14} />
      ) : (
        <Moon size={14} />
      )}
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
