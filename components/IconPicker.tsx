"use client";

import { ICON_NAMES, type IconName } from "@/lib/icon-names";
import Glyph from "./Glyph";

type Props = {
  value: IconName;
  onChange: (name: IconName) => void;
  /** Form field name; a hidden input carries the value. */
  field?: string;
};

// Grid of the curated Lucide icons for groups and goals.
export default function IconPicker({ value, onChange, field = "icon" }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
      <input type="hidden" name={field} value={value} />
      {ICON_NAMES.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          aria-label={n.replace(/-\d$/, "").replace(/-/g, " ")}
          onClick={() => onChange(n)}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ${
            n === value
              ? "bg-purple-500/25 text-white ring-2 ring-purple-500/60 scale-110"
              : "bg-white/5 text-[#9ca3c0] hover:bg-white/10 hover:text-white"
          }`}
        >
          <Glyph name={n} size={18} />
        </button>
      ))}
    </div>
  );
}
