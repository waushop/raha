import { connection } from "next/server";
import Link from "next/link";
import { TrendingDown, TriangleAlert } from "lucide-react";
import { currentContext } from "@/lib/auth";
import { getCashflow } from "@/lib/cashflow-db";
import { isoDate } from "@/lib/subscriptions";
import CashflowSetup from "@/components/CashflowSetup";
import type { DayPoint, Event } from "@/lib/cashflow";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const short = (iso: string) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

function Chart({ days, buffer }: { days: DayPoint[]; buffer: number }) {
  const W = 720, H = 200, PAD = 28;
  const balances = days.map((d) => d.balance);
  const min = Math.min(0, ...balances, buffer);
  const max = Math.max(...balances, buffer, 1);
  const x = (i: number) => PAD + (i / Math.max(1, days.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
  const path = days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`).join(" ");
  const area = `${path} L${x(days.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const events = days.flatMap((d, i) => d.events.map((e) => ({ e, i, balance: d.balance })));
  const ticks = [0, 15, 30, 45, 60].filter((t) => t < days.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Projected balance for the next 60 days">
      <defs>
        <linearGradient id="cf-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#a9a9b2" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#a9a9b2" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* zero and buffer lines */}
      <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="rgba(248,113,113,0.5)" strokeDasharray="3 4" />
      <line x1={PAD} x2={W - PAD} y1={y(buffer)} y2={y(buffer)} stroke="rgba(251,191,36,0.4)" strokeDasharray="2 4" />
      <text x={W - PAD} y={y(buffer) - 4} textAnchor="end" fontSize="9" fill="#fbbf24" opacity="0.8">buffer {fmt0(buffer)}</text>
      <path d={area} fill="url(#cf-fill)" />
      <path d={path} fill="none" stroke="#e7e7ec" strokeWidth="2" strokeLinejoin="round" />
      {events.map(({ e, i, balance }, k) => (
        <g key={k}>
          <circle cx={x(i)} cy={y(balance)} r={e.kind === "payday" ? 4 : 2.5} fill={e.kind === "payday" ? "#2dd4bf" : "#e7e7ec"} />
        </g>
      ))}
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="9" fill="#5a6380" fontFamily="monospace">{short(days[t].date)}</text>
      ))}
    </svg>
  );
}

export default async function CashflowPage() {
  await connection();
  const { workspaceId: ws, userId } = await currentContext();
  const today = isoDate(new Date());
  const view = await getCashflow(ws, today, { userId });
  const p = view.projection;
  const events: Event[] = [...view.bills, ...(p ? p.days.flatMap((d) => d.events.filter((e) => e.kind === "payday")) : [])]
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? b.amount - a.amount : a.kind === "payday" ? -1 : 1))
    .slice(0, 40);
  const safeTone = p ? (p.safeToSpend < 0 ? "text-red-400" : p.safeToSpend < view.buffer ? "text-amber-400" : "text-teal-400") : "text-[#9ca3c0]";

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
            Cash flow
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">Where your balance is heading over the next 60 days: paydays in, bills out, everyday spending at {fmt(view.dailyVariable)} € a day.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Balance today</p>
            <p className="text-lg sm:text-xl font-bold text-white font-mono tabular-nums whitespace-nowrap">{view.balanceToday !== null ? `${fmt(view.balanceToday)} €` : "—"}</p>
          </div>
          <div className={`card rounded-2xl p-4 border ${p ? (p.safeToSpend < 0 ? "border-red-500/30" : "border-teal-500/30") : "border-white/[0.08]"}`}>
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Safe to spend</p>
            <p className={`text-lg sm:text-xl font-bold font-mono tabular-nums whitespace-nowrap ${safeTone}`}>{p ? `${fmt(p.safeToSpend)} €` : "—"}</p>
            <p className="text-[9px] text-[#5a6380]">{p?.nextPayday ? `until ${short(p.nextPayday.date)}, keeps ${fmt0(view.buffer)} € buffer` : "over the next 60 days"}</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Low point</p>
            <p className={`text-lg sm:text-xl font-bold font-mono tabular-nums whitespace-nowrap ${p && p.lowPoint.balance < 0 ? "text-red-400" : "text-amber-400"}`}>{p ? `${fmt(p.lowPoint.balance)} €` : "—"}</p>
            <p className="text-[9px] text-[#5a6380]">{p ? `on ${short(p.lowPoint.date)}` : ""}</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Next payday</p>
            <p className="text-lg sm:text-xl font-bold text-teal-400 font-mono tabular-nums whitespace-nowrap">{p?.nextPayday ? `+${fmt0(p.nextPayday.amount)} €` : "—"}</p>
            <p className="text-[9px] text-[#5a6380]">{p?.nextPayday ? `${short(p.nextPayday.date)} · ${p.nextPayday.label}` : "add a payday below"}</p>
          </div>
        </div>

        {p && (
          <div className="card rounded-2xl p-4 animate-fade-up" style={{ animationDelay: "0.06s" }}>
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown size={14} className="text-pink-400" />
              <h2 className="text-sm font-bold text-white">Next 60 days</h2>
              <span className="ml-auto text-[10px] text-[#5a6380]"><span className="inline-block w-2 h-2 rounded-full bg-teal-400 mr-1" />payday <span className="inline-block w-2 h-2 rounded-full bg-pink-400 ml-2 mr-1" />bill</span>
            </div>
            <Chart days={p.days} buffer={view.buffer} />
            {p.paychecks.some((c) => c.shortfall > 0) && (
              <div className="mt-3 space-y-1">
                {p.paychecks.filter((c) => c.shortfall > 0).map((c) => (
                  <p key={c.payday.date} className="text-xs text-amber-400/90 inline-flex items-center gap-1.5"><TriangleAlert size={12} /> The {short(c.payday.date)} paycheck ({fmt0(c.payday.amount)} €) does not cover its bills and everyday spend ({fmt0(c.bills + c.variable)} €) — short by {fmt0(c.shortfall)} €.</p>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="animate-fade-up" style={{ animationDelay: "0.07s" }}>
          <CashflowSetup paydays={view.paydays} checkpoint={view.checkpoint} balanceToday={view.balanceToday} today={today} />
        </div>

        {events.length > 0 && (
          <div className="card rounded-2xl overflow-hidden animate-fade-up" style={{ animationDelay: "0.08s" }}>
            <div className="px-4 py-3 border-b border-white/[0.06]"><h2 className="text-sm font-bold text-white">What is coming</h2></div>
            <div className="divide-y divide-white/[0.04]">
              {events.map((e, i) => (
                <div key={`${e.date}-${e.label}-${i}`} className="px-4 py-2 flex items-center gap-3">
                  <span className="w-14 shrink-0 text-[11px] font-mono text-[#9ca3c0] tabular-nums">{short(e.date)}</span>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${e.kind === "payday" ? "bg-teal-400" : "bg-pink-400"}`} />
                  <span className="flex-1 min-w-0 text-sm text-white/90 truncate">{e.label}</span>
                  <span className={`text-sm font-mono font-bold tabular-nums ${e.kind === "payday" ? "text-teal-400" : "text-white/80"}`}>{e.kind === "payday" ? "+" : "−"}{fmt(e.amount)} €</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
