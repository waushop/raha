"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Home, Users } from "lucide-react";
import { useToast } from "./Toast";
import { myWorkspaces, switchWorkspace } from "@/app/household/actions";
import { whoAmI } from "@/app/actions";
import { rememberOwner } from "@/lib/offline-queue";
import type { WorkspaceRow } from "@/lib/household";

// Sidebar pill: which ledger you are in, and a menu to switch when you
// belong to a household. Hidden when there is only the personal one.
export default function WorkspaceSwitcher({ current }: { current: { name: string; kind: "personal" | "shared" } | null }) {
  const [list, setList] = useState<WorkspaceRow[]>([]);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    myWorkspaces().then(setList).catch(() => {});
  }, [current?.name]);

  if (!current || list.length < 2) return null;

  function pick(id: string) {
    setOpen(false);
    startTransition(async () => {
      const res = await switchWorkspace(id);
      if (!res.ok) { toast.showError(res.error); return; }
      router.push("/dashboard");
      router.refresh();
      // Offline entries are tagged with the ledger they were made in.
      whoAmI().then((me) => rememberOwner(me ? { userId: me.userId, workspaceId: me.workspaceId } : null)).catch(() => {});
    });
  }

  return (
    <div className="relative mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-left transition-colors disabled:opacity-50"
      >
        {current.kind === "shared" ? <Users size={13} className="text-pink-400 shrink-0" /> : <Home size={13} className="text-[#9ca3c0] shrink-0" />}
        <span className="flex-1 min-w-0 text-xs font-semibold text-white/90 truncate">{current.name}</span>
        <ChevronDown size={12} className={`text-[#5a6380] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul role="listbox" className="absolute left-0 right-0 mt-1 panel border border-white/[0.1] rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] overflow-hidden z-50 animate-fade-in">
          {list.map((w) => {
            const active = w.NAME === current.name && w.KIND === current.kind;
            return (
              <li key={w.ID}>
                <button role="option" aria-selected={active} onClick={() => !active && pick(w.ID)} className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${active ? "text-white bg-white/5" : "text-[#9ca3c0] hover:text-white hover:bg-white/5"}`}>
                  {w.KIND === "shared" ? <Users size={12} className="text-pink-400 shrink-0" /> : <Home size={12} className="shrink-0" />}
                  <span className="flex-1 min-w-0 truncate">{w.NAME}</span>
                  {w.KIND === "shared" && <span className="text-[9px] text-[#5a6380]">{w.MEMBERS}</span>}
                  {active && <Check size={12} className="text-teal-400" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
