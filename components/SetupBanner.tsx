"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { useToast } from "./Toast";
import { finishOnboarding } from "@/app/welcome/actions";

// Dashboard nudge into /welcome, shown until the workspace finishes or dismisses setup.
export default function SetupBanner() {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function dismiss() {
    navigator.vibrate?.(10);
    startTransition(async () => {
      const res = await finishOnboarding();
      if (!res.ok) toast.showError(res.error);
    });
  }

  return (
    <div className="card rounded-2xl p-4 flex items-center gap-3 animate-fade-up border border-pink-500/20">
      <span className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center shrink-0">
        <Sparkles size={18} className="text-pink-400" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white">Set up Empty Wallet</p>
        <p className="text-xs text-[#9ca3c0]">Groups, payday, subscriptions and a first plan in five quick steps.</p>
      </div>
      <Link href="/welcome" className="gradient-pink text-white rounded-xl px-4 py-2 text-xs font-bold hover:opacity-90 transition-all btn-press shadow-lg shadow-pink-500/20 shrink-0">
        Start
      </Link>
      <button type="button" onClick={dismiss} disabled={isPending} aria-label="Dismiss setup" className="p-1.5 rounded-lg text-[#5a6380] hover:text-white hover:bg-white/5 transition-colors shrink-0">
        <X size={14} />
      </button>
    </div>
  );
}
