"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, CheckCheck, ChartLine, ClipboardList, Landmark, ListChecks, Mail, RefreshCw, Trash2, TrendingUp, TriangleAlert, type LucideIcon } from "lucide-react";
import { useToast } from "./Toast";
import { checkNow, clearInbox, markAllRead, markRead } from "@/app/inbox/actions";
import type { InboxItem } from "@/lib/nudges-db";

const ICONS: Record<InboxItem["KIND"], LucideIcon> = {
  bill_due: CalendarClock, trial_ending: CalendarClock, price_up: TrendingUp, unused: TriangleAlert,
  plan_line: ListChecks, safe_to_spend: ChartLine, weekly_digest: Mail, monthly_review: ClipboardList,
  bank_expiring: Landmark, bank_failing: TriangleAlert,
};

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z"));
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function InboxList({ items }: { items: InboxItem[] }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function open(item: InboxItem) {
    startTransition(async () => {
      if (!item.READ_AT) await markRead(item.ID);
      if (item.URL) router.push(item.URL);
    });
  }

  function check() {
    startTransition(async () => {
      const res = await checkNow();
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(res.created > 0 ? `${res.created} new nudge${res.created !== 1 ? "s" : ""}` : "Nothing new right now");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 justify-end">
        <button onClick={check} disabled={isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"><RefreshCw size={12} /> Check now</button>
        {items.some((i) => !i.READ_AT) && (
          <button onClick={() => startTransition(() => markAllRead())} disabled={isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"><CheckCheck size={12} /> Mark all read</button>
        )}
        {items.some((i) => i.READ_AT) && (
          <button onClick={() => startTransition(() => clearInbox())} disabled={isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-white/5 text-[#9ca3c0] hover:text-red-400 hover:bg-white/10 transition-colors disabled:opacity-50"><Trash2 size={12} /> Clear read</button>
        )}
      </div>
      {items.length > 0 && (
        <div className="card rounded-2xl overflow-hidden divide-y divide-white/[0.04]">
          {items.map((item) => {
            const Icon = ICONS[item.KIND] ?? TriangleAlert;
            return (
              <button key={item.ID} onClick={() => open(item)} className={`w-full text-left px-4 py-3 flex items-start gap-3 row-hover transition-colors ${item.READ_AT ? "opacity-60" : ""}`}>
                <span className={`mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${item.READ_AT ? "bg-white/5 text-[#5a6380]" : "bg-purple-500/15 text-purple-400"}`}><Icon size={15} /></span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className={`text-sm truncate ${item.READ_AT ? "text-white/70" : "text-white font-semibold"}`}>{item.TITLE}</span>
                    {!item.READ_AT && <span className="w-1.5 h-1.5 rounded-full bg-pink-500 shrink-0" />}
                  </span>
                  {item.BODY && <span className="block text-xs text-[#9ca3c0] mt-0.5">{item.BODY}</span>}
                  <span className="block text-[10px] text-[#5a6380] mt-1">{ago(item.CREATED_AT)}</span>
                </span>
                {item.READ_AT && <Check size={12} className="text-[#5a6380] mt-1 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
