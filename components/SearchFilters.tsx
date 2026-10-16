"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CATEGORIES, CATEGORY_KEYS, type ExpenseGroup } from "@/types/expense";

type Props = { groups: ExpenseGroup[]; tags: string[] };

const FIELDS = ["kind", "category", "group", "tag", "min", "max", "from", "to"] as const;
export type FilterKey = (typeof FIELDS)[number];

const select = "bg-white/5 border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-purple-500/30";
const input = `${select} w-24 font-mono tabular-nums placeholder:text-[#5a6380]`;

// Filters live in the URL so results are shareable and the back button works.
export default function SearchFilters({ groups, tags }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const get = (k: FilterKey) => params.get(k) ?? "";
  const active = FIELDS.filter((k) => get(k)).length;

  function update(changes: Partial<Record<FilterKey, string>>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`/search?${next.toString()}`);
  }

  function clear() {
    const q = params.get("q");
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  return (
    <div className="card rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Kind" value={get("kind")} onChange={(e) => update({ kind: e.target.value })} className={`${select} panel`}>
          <option value="">Expenses + income</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
        </select>
        <select aria-label="Category" value={get("category")} onChange={(e) => update({ category: e.target.value })} className={`${select} panel`}>
          <option value="">Any category</option>
          {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORIES[k].icon} {CATEGORIES[k].label}</option>)}
        </select>
        {groups.length > 0 && (
          <select aria-label="Group" value={get("group")} onChange={(e) => update({ group: e.target.value })} className={`${select} panel`}>
            <option value="">Any group</option>
            {groups.map((g) => <option key={g.ID} value={g.ID}>{g.EMOJI} {g.NAME}</option>)}
            <option value="none">Ungrouped</option>
          </select>
        )}
        <span className="inline-flex items-center gap-1">
          <input aria-label="Minimum amount" inputMode="decimal" placeholder="min €" defaultValue={get("min")} key={`min-${get("min")}`}
            onBlur={(e) => { if (e.target.value !== get("min")) update({ min: e.target.value }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={input} />
          <span className="text-[#5a6380] text-xs">–</span>
          <input aria-label="Maximum amount" inputMode="decimal" placeholder="max €" defaultValue={get("max")} key={`max-${get("max")}`}
            onBlur={(e) => { if (e.target.value !== get("max")) update({ max: e.target.value }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={input} />
        </span>
        <span className="inline-flex items-center gap-1">
          <input aria-label="From month" type="month" value={get("from")} onChange={(e) => update({ from: e.target.value })} className={`${input} w-36`} />
          <span className="text-[#5a6380] text-xs">→</span>
          <input aria-label="To month" type="month" value={get("to")} onChange={(e) => update({ to: e.target.value })} className={`${input} w-36`} />
        </span>
        {active > 0 && (
          <button onClick={clear} className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors px-2">Clear filters</button>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => {
            const on = get("tag") === t;
            return (
              <button key={t} onClick={() => update({ tag: on ? "" : t })}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${on ? "bg-purple-500/20 border-purple-500/40 text-purple-200" : "bg-white/5 border-white/[0.06] text-[#9ca3c0] hover:text-white"}`}>
                #{t}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
