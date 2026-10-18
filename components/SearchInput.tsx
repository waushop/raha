"use client";

import { useNav } from "@/lib/use-nav";
import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";

export default function SearchInput({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const { go } = useNav();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (value.trim().length >= 2) {
        go(`/search?q=${encodeURIComponent(value.trim())}`, { replace: true });
      } else if (value.trim().length === 0) {
        go("/search", { replace: true });
      }
    }, 300);
  }

  return (
    <div className="relative">
      <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5a6380]" />
      <input
        ref={inputRef}
        value={query}
        onChange={e => handleChange(e.target.value)}
        placeholder="Search expenses by name, notes, or tags..."
        className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-white/5 border border-white/[0.08] text-sm text-white placeholder:text-[#5a6380] focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500/30 transition-all"
      />
      {query && (
        <button onClick={() => { setQuery(""); go("/search", { replace: true }); inputRef.current?.focus(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[#5a6380] hover:text-white transition-colors">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
