"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { undoDeleteExpense } from "@/app/actions";
import { useToast } from "./Toast";

export default function RestoreButton({ id, name }: { id: string; name: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <button
      onClick={() => startTransition(async () => { await undoDeleteExpense(id); toast.show(`"${name}" restored`); router.refresh(); })}
      disabled={isPending}
      className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 disabled:opacity-50 transition-all btn-press shrink-0"
    >
      {isPending ? "…" : "Restore"}
    </button>
  );
}
