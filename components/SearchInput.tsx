"use client";

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";

export default function SearchInput({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();
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
        router.push(`/search?q=${encodeURIComponent(value.trim())}`);
      } else if (value.trim().length === 0) {
        router.push("/search");
      }
    }, 300);
  }

  return (
    <div className="relative">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5a6380]">
        <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        ref={inputRef}
        value={query}
        onChange={e => handleChange(e.target.value)}
        placeholder="Search expenses by name, notes, or tags..."
        className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-white/5 border border-white/[0.08] text-sm text-white placeholder:text-[#5a6380] focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500/30 transition-all"
      />
      {query && (
        <button onClick={() => { setQuery(""); router.push("/search"); inputRef.current?.focus(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[#5a6380] hover:text-white transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      )}
    </div>
  );
}
