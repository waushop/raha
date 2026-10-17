"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePreferences } from "@/app/settings/preferences-actions";
import { SAFE_BUFFER_MAX, SIDEBAR_MONTHS_MAX, SIDEBAR_MONTHS_MIN, type Preferences } from "@/lib/preferences";
import { useToast } from "./Toast";

type Props = { initial: Preferences };

const input = "w-full border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40";
const label = "block text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-1.5";
const hint = "text-[10px] text-[#5a6380] mt-1";

export default function PreferencesForm({ initial }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    navigator.vibrate?.(10);
    startTransition(async () => {
      const res = await savePreferences(data);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show("Preferences saved");
      router.refresh();
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="pref-landing" className={label}>Start page after sign-in</label>
          <select id="pref-landing" name="landing" defaultValue={initial.landing} className={input}>
            <option value="dashboard">Dashboard</option>
            <option value="month">This month</option>
            <option value="plan">Plan</option>
            <option value="subscriptions">Subscriptions</option>
          </select>
        </div>
        <div>
          <label htmlFor="pref-week" className={label}>Week starts on</label>
          <select id="pref-week" name="weekStart" defaultValue={initial.weekStart} className={input}>
            <option value="mon">Monday</option>
            <option value="sun">Sunday</option>
          </select>
          <p className={hint}>Daily calendar and weekday charts.</p>
        </div>
        <div>
          <label htmlFor="pref-months" className={label}>Months in the sidebar</label>
          <input id="pref-months" name="sidebarMonths" type="number" inputMode="numeric" min={SIDEBAR_MONTHS_MIN} max={SIDEBAR_MONTHS_MAX} step={1} defaultValue={initial.sidebarMonths} className={`${input} tabular-nums`} />
          <p className={hint}>{SIDEBAR_MONTHS_MIN}–{SIDEBAR_MONTHS_MAX}. Older months stay reachable with the arrows.</p>
        </div>
        <div>
          <label htmlFor="pref-buffer" className={label}>Safe-to-spend buffer (€)</label>
          <input id="pref-buffer" name="safeBuffer" type="number" inputMode="decimal" min={0} max={SAFE_BUFFER_MAX} step="0.01" defaultValue={initial.safeBuffer} className={`${input} font-mono tabular-nums`} />
          <p className={hint}>Kept aside before cash flow calls money safe to spend.</p>
        </div>
      </div>
      <button type="submit" disabled={isPending} className="px-4 py-2 rounded-xl text-sm font-bold gradient-pink text-white disabled:opacity-40 transition-all">
        {isPending ? "Saving…" : "Save preferences"}
      </button>
    </form>
  );
}
