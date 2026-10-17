import { connection } from "next/server";
import Link from "next/link";
import { CalendarClock, Repeat, TriangleAlert } from "lucide-react";
import { currentContext } from "@/lib/auth";
import { getGroups } from "@/app/actions";
import { listSubscriptions } from "@/lib/subscriptions-db";
import { expectedByMonthOfYear, isoDate, upcoming } from "@/lib/subscriptions";
import SubscriptionManager from "@/components/SubscriptionManager";
import UpcomingBills from "@/components/UpcomingBills";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export default async function SubscriptionsPage() {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const today = isoDate(new Date());
  const [subs, groups] = await Promise.all([listSubscriptions(ws, today), getGroups()]);

  const active = subs.filter((s) => s.STATUS === "active");
  const monthlyBurn = active.reduce((s, r) => s + r.monthly, 0);
  const yearly = active.reduce((s, r) => s + r.yearly, 0);
  const due = upcoming(
    subs.map((s) => ({ id: s.ID, name: s.NAME, category: s.CATEGORY, amount: s.AMOUNT, status: s.STATUS, cadence: s.CADENCE, day: s.DAY, monthOfYear: s.MONTH_OF_YEAR, lastCharge: s.lastCharge })),
    today, 30,
  );
  const dueTotal = due.reduce((s, u) => s + u.amount, 0);
  const byMonth = expectedByMonthOfYear(active.map((s) => ({ amount: s.AMOUNT, cadence: s.CADENCE, anchorMonth: s.anchorMonth, status: s.STATUS })));
  const maxMonth = Math.max(...byMonth, 1);
  const thisMonthIdx = Number(today.slice(5, 7)) - 1;

  const attention = [
    ...active.filter((s) => s.unused).map((s) => ({ key: `u-${s.ID}`, text: `${s.NAME} hasn't been charged since ${s.lastCharge?.month ?? "?"} — still need it?`, tone: "amber" as const })),
    ...active.filter((s) => s.TRIAL_ENDS && s.TRIAL_ENDS >= today).map((s) => ({ key: `t-${s.ID}`, text: `${s.NAME} trial ends ${s.TRIAL_ENDS} — ${fmt(s.AMOUNT)} € after that`, tone: "pink" as const })),
    ...active.filter((s) => s.previousAmount !== null && s.AMOUNT > s.previousAmount!).map((s) => ({ key: `p-${s.ID}`, text: `${s.NAME} went up ${fmt(s.AMOUNT - s.previousAmount!)} € (${((s.AMOUNT / s.previousAmount! - 1) * 100).toFixed(0)}%)`, tone: "red" as const })),
  ];
  const savedByCancelling = subs.filter((s) => s.STATUS === "cancelled").reduce((s, r) => s + r.yearly, 0);

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
            Subscriptions
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">
            {active.length} active{subs.length > active.length && `, ${subs.length - active.length} paused or cancelled`}
            {savedByCancelling > 0 && ` · ${fmt(savedByCancelling)} €/yr saved by cancelling`}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Monthly burn</p>
            <p className="text-lg sm:text-xl font-bold text-white font-mono tabular-nums whitespace-nowrap">{fmt(monthlyBurn)} €</p>
            <p className="text-[9px] text-[#5a6380]">all cadences normalised</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Per year</p>
            <p className="text-lg sm:text-xl font-bold text-amber-400 font-mono tabular-nums whitespace-nowrap">{fmt(yearly)} €</p>
          </div>
          <div className="card rounded-2xl p-4 col-span-2 sm:col-span-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Due in 30 days</p>
            <p className="text-lg sm:text-xl font-bold text-pink-400 font-mono tabular-nums whitespace-nowrap">{fmt(dueTotal)} €</p>
            <p className="text-[9px] text-[#5a6380]">{due.length} charge{due.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {attention.length > 0 && (
          <div className="card rounded-2xl p-4 animate-fade-up" style={{ animationDelay: "0.06s" }}>
            <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-2"><TriangleAlert size={14} className="text-amber-400" /> Needs a look</h2>
            <ul className="space-y-1">
              {attention.map((a) => (
                <li key={a.key} className={`text-xs ${a.tone === "amber" ? "text-amber-400/90" : a.tone === "pink" ? "text-pink-400/90" : "text-red-400/90"}`}>{a.text}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 animate-fade-up" style={{ animationDelay: "0.07s" }}>
          <div className="card rounded-2xl overflow-hidden lg:col-span-3">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
              <CalendarClock size={14} className="text-pink-400" />
              <h2 className="text-sm font-bold text-white">Upcoming bills</h2>
              <span className="ml-auto text-[10px] text-[#5a6380]">next 30 days</span>
            </div>
            <UpcomingBills today={today} items={due.map((u) => ({ id: u.sub.id, name: u.sub.name, category: u.sub.category, date: u.date, amount: u.amount }))} />
          </div>
          <div className="card rounded-2xl p-4 lg:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <Repeat size={14} className="text-purple-400" strokeWidth={2.5} />
              <h2 className="text-sm font-bold text-white">Through the year</h2>
            </div>
            <div className="flex items-end gap-1 h-24">
              {byMonth.map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${MONTHS[i]}: ${fmt(v)} €`}>
                  <div className={`w-full rounded-t-md ${i === thisMonthIdx ? "bg-gradient-to-t from-pink-500 to-purple-500" : "bg-white/10"}`} style={{ height: `${Math.max(4, (v / maxMonth) * 80)}px` }} />
                  <span className={`text-[9px] font-mono ${i === thisMonthIdx ? "text-pink-400" : "text-[#5a6380]"}`}>{MONTHS[i]}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[#5a6380] mt-2">Heavier months are annual renewals. Peak {fmt(maxMonth)} €.</p>
          </div>
        </div>

        <div className="animate-fade-up" style={{ animationDelay: "0.08s" }}>
          <SubscriptionManager subscriptions={subs} groups={groups} today={today} />
        </div>
      </div>
    </main>
  );
}
