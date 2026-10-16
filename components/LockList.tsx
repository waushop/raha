"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { unlockClient } from "@/app/users/actions";
import { useToast } from "./Toast";
import type { LockInfo } from "@/lib/ratelimit";

const span = (ms: number) => (ms >= 3_600_000 ? `${Math.ceil(ms / 3_600_000)} h` : `${Math.ceil(ms / 60_000)} min`);

export default function LockList({ locks }: { locks: LockInfo[] }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();
  if (locks.length === 0) return <p className="text-[10px] text-[#5a6380]">No locked clients right now.</p>;
  return (
    <div className="space-y-1.5">
      {locks.map((l) => (
        <div key={l.key} className="flex items-center gap-3 bg-white/[0.03] rounded-xl px-3 py-2 text-xs">
          <span className="font-mono text-white/80">{l.key}</span>
          <span className={`flex-1 ${l.hard ? "text-red-400" : "text-amber-400"}`}>{l.hard ? "hard lock" : "locked"} · {span(l.remainingMs)} left</span>
          <button disabled={isPending} onClick={() => startTransition(async () => { await unlockClient(l.key); toast.show(`${l.key} unlocked`); router.refresh(); })}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 disabled:opacity-50 transition-all btn-press">
            Unlock
          </button>
        </div>
      ))}
    </div>
  );
}
