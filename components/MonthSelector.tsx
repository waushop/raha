"use client";

import { useRouter } from "next/navigation";

type Props = {
  m1: string;
  m2: string;
  availableMonths: string[];
};

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
}

export default function MonthSelector({ m1, m2, availableMonths }: Props) {
  const router = useRouter();

  function update(field: "m1" | "m2", value: string) {
    const params = new URLSearchParams();
    params.set("m1", field === "m1" ? value : m1);
    params.set("m2", field === "m2" ? value : m2);
    router.push(`/compare?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-3">
      <select
        value={m1}
        onChange={e => update("m1", e.target.value)}
        className="bg-white/5 border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/30 appearance-none cursor-pointer"
      >
        {availableMonths.map(m => (
          <option key={m} value={m} className="panel">{monthLabel(m)}</option>
        ))}
      </select>
      <span className="text-xs text-[#5a6380] font-bold">vs</span>
      <select
        value={m2}
        onChange={e => update("m2", e.target.value)}
        className="bg-white/5 border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/30 appearance-none cursor-pointer"
      >
        {availableMonths.map(m => (
          <option key={m} value={m} className="panel">{monthLabel(m)}</option>
        ))}
      </select>
    </div>
  );
}
