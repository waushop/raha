import { connection } from "next/server";
import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { currentContext } from "@/lib/auth";
import { getNetWorth } from "@/lib/networth-db";
import { currentMonth, monthLabel } from "@/lib/months";
import NetWorthEditor from "@/components/NetWorthEditor";
import type { NetWorthPoint } from "@/lib/networth";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const short = (month: string) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;

function Chart({ series }: { series: NetWorthPoint[] }) {
  const W = 720, H = 220, PAD = 28;
  const highs = series.map((p) => Math.max(p.assets, p.net));
  const lows = series.map((p) => Math.min(-p.debts, p.net));
  const max = Math.max(1, ...highs);
  const min = Math.min(0, ...lows);
  const x = (i: number) => PAD + (i / Math.max(1, series.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
  const line = (pick: (p: NetWorthPoint) => number) => series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
  const assetsPath = line((p) => p.assets);
  const netPath = line((p) => p.net);
  const debtsArea = `${line((p) => -p.debts)} L${x(series.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const netArea = `${netPath} L${x(series.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const ticks = series.map((_, i) => i).filter((i) => i % 4 === 0 || i === series.length - 1);
  const last = series[series.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Net worth over the last 24 months">
      <defs>
        <linearGradient id="nw-net" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#a9a9b2" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#a9a9b2" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 4" />
      <path d={netArea} fill="url(#nw-net)" />
      <path d={debtsArea} fill="rgba(248,113,113,0.18)" />
      <path d={line((p) => -p.debts)} fill="none" stroke="#f87171" strokeWidth="1.5" strokeOpacity="0.7" strokeLinejoin="round" />
      <path d={assetsPath} fill="none" stroke="#2dd4bf" strokeWidth="1.5" strokeOpacity="0.8" strokeLinejoin="round" />
      <path d={netPath} fill="none" stroke="#e7e7ec" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx={x(series.length - 1)} cy={y(last.net)} r={4} fill="#e7e7ec" />
      <text x={W - PAD} y={y(last.net) - 8} textAnchor="end" fontSize="10" fill="#e7e7ec" fontFamily="monospace" fontWeight="bold">{fmt0(last.net)} €</text>
      {ticks.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#5a6380" fontFamily="monospace">{short(series[i].month)}</text>
      ))}
    </svg>
  );
}

export default async function NetWorthPage() {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const month = currentMonth();
  const view = await getNetWorth(ws, month);
  const hasAccounts = view.accounts.length > 0;
  const hasData = view.accounts.some((a) => a.balance !== null);
  const change = view.change;
  const changeTone = change ? (change.amount > 0 ? "text-teal-400" : change.amount < 0 ? "text-red-400" : "text-[#9ca3c0]") : "text-[#9ca3c0]";

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
            Net worth
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">What you own minus what you owe. Record each account&rsquo;s balance once a month and watch the line move.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <div className={`card rounded-2xl p-4 border ${view.current.net < 0 ? "border-red-500/30" : "border-teal-500/30"}`}>
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Net worth</p>
            <p className={`text-lg sm:text-xl font-bold font-mono tabular-nums whitespace-nowrap ${view.current.net < 0 ? "text-red-400" : "text-white"}`}>{hasData ? `${fmt(view.current.net)} €` : "—"}</p>
            <p className="text-[9px] text-[#5a6380]">{monthLabel(month)}</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Change</p>
            <p className={`text-lg sm:text-xl font-bold font-mono tabular-nums whitespace-nowrap ${changeTone}`}>{change && hasData ? `${change.amount > 0 ? "+" : ""}${fmt(change.amount)} €` : "—"}</p>
            <p className="text-[9px] text-[#5a6380]">{change && hasData && change.pct !== null ? `${change.pct > 0 ? "+" : ""}${change.pct.toFixed(1)}% vs last month` : "vs last month"}</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Assets</p>
            <p className="text-lg sm:text-xl font-bold text-teal-400 font-mono tabular-nums whitespace-nowrap">{hasData ? `${fmt(view.current.assets)} €` : "—"}</p>
          </div>
          <div className="card rounded-2xl p-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Debts</p>
            <p className="text-lg sm:text-xl font-bold text-red-400 font-mono tabular-nums whitespace-nowrap">{hasData ? `${fmt(view.current.debts)} €` : "—"}</p>
          </div>
        </div>

        {hasData && (
          <div className="card rounded-2xl p-4 animate-fade-up" style={{ animationDelay: "0.06s" }}>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={14} className="text-pink-400" />
              <h2 className="text-sm font-bold text-white">Last 24 months</h2>
              <span className="ml-auto text-[10px] text-[#5a6380]"><span className="inline-block w-2 h-2 rounded-full bg-pink-500 mr-1" />net <span className="inline-block w-2 h-2 rounded-full bg-teal-400 ml-2 mr-1" />assets <span className="inline-block w-2 h-2 rounded-full bg-red-400 ml-2 mr-1" />debts</span>
            </div>
            <Chart series={view.series} />
          </div>
        )}

        <div className="animate-fade-up" style={{ animationDelay: "0.07s" }}>
          <NetWorthEditor accounts={view.accounts} month={month} monthName={monthLabel(month)} />
        </div>

        {!hasAccounts && (
          <p className="text-center text-xs text-[#5a6380]">Start with your main bank account, then add savings, investments and any loans.</p>
        )}
      </div>
    </main>
  );
}
