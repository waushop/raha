"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  header: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export default function CollapsibleCard({ header, children, defaultOpen = true, className = "" }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (contentRef.current) {
      setHeight(contentRef.current.scrollHeight);
    }
  }, [children]);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 border-b border-white/[0.06] flex items-center justify-between cursor-pointer select-none"
      >
        {header}
        <ChevronDown size={12} strokeWidth={2.5} className={`text-[#5a6380] transition-transform duration-300 ml-2 shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        ref={contentRef}
        className="transition-all duration-300 ease-out overflow-hidden"
        style={{
          maxHeight: open ? (height ?? 2000) : 0,
          opacity: open ? 1 : 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
