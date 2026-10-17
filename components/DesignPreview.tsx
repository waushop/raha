"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight, ArrowUpRight, Calendar, Car, Check, CirclePlus, House, LayoutDashboard, Menu, Search,
  ShoppingCart, Sparkles, Utensils, Wallet, X,
} from "lucide-react";

type Glass = "clear" | "smoke" | "ink";
type Font = "sora" | "grotesk" | "unbounded" | "syne";
type Data = "mono" | "muted";
type Brand = "tag" | "wild" | "spray" | "marker";
const BRAND: Record<Brand, string> = { tag: "var(--font-lux-tag), cursive", wild: "var(--font-lux-tagwild), cursive", spray: "var(--font-lux-spray), cursive", marker: "var(--font-lux-marker), cursive" };

const FONT: Record<Font, string> = {
  sora: "var(--font-lux-sora), system-ui, sans-serif",
  grotesk: "var(--font-lux-grotesk), system-ui, sans-serif",
  unbounded: "var(--font-lux-unbounded), system-ui, sans-serif",
  syne: "var(--font-lux-syne), system-ui, sans-serif",
};
const FONT_WEIGHT: Record<Font, number> = { sora: 300, grotesk: 400, unbounded: 300, syne: 500 };
const FONT_TRACK: Record<Font, string> = { sora: "-0.035em", grotesk: "-0.03em", unbounded: "-0.02em", syne: "-0.01em" };

// Muted data colours for charts/income-expense when not strictly monochrome.
const DATA = {
  mono: { pos: "#f5f5f7", neg: "rgba(245,245,247,.55)", bars: ["#f5f5f7", "#bdbdc2", "#8a8a90", "#5f5f66", "#3f3f45"] },
  muted: { pos: "#8fd3b6", neg: "#e59a9a", bars: ["#c9b38a", "#8fb3d3", "#b39ad3", "#8fd3b6", "#d39a8f"] },
};

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.18em] lux-mute">{label}</span>
      <div role="radiogroup" aria-label={label} className="glass rounded-full p-1 flex gap-1">
        {options.map(([v, text]) => (
          <button
            key={v}
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`relative flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-300 ${value === v ? "glass glass-glint glass-sparkle text-white" : "lux-sub hover:text-white"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DesignPreview() {
  const [glass, setGlass] = useState<Glass>("smoke");
  const [font, setFont] = useState<Font>("sora");
  const [data, setData] = useState<Data>("muted");
  const [brand, setBrand] = useState<Brand>("marker");
  const [toggle, setToggle] = useState(true);
  const [tab, setTab] = useState(1);
  const c = DATA[data];
  const head = { fontFamily: FONT[font], fontWeight: FONT_WEIGHT[font], letterSpacing: FONT_TRACK[font] } as const;
  const body = { fontFamily: "var(--font-lux-sans), system-ui, sans-serif" } as const;
  const bars = [62, 74, 58, 90, 70, 48];

  return (
    <div className="lux fixed inset-0 z-[70] overflow-y-auto" data-glass={glass} style={body}>
      <div className="max-w-md lg:max-w-5xl mx-auto px-4 pb-32" style={{ paddingTop: "calc(var(--sat, 0px) + 1rem)" }}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-[10px] uppercase tracking-[0.2em] lux-mute">Design preview</span>
          <Link href="/dashboard" className="glass rounded-full w-9 h-9 flex items-center justify-center lux-sub hover:text-white" aria-label="Close preview"><X size={16} /></Link>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <Seg label="Glass" value={glass} onChange={setGlass} options={[["clear", "Clear"], ["smoke", "Smoke"], ["ink", "Ink"]]} />
          <Seg label="Headline font" value={font} onChange={setFont} options={[["sora", "Sora"], ["grotesk", "Grotesk"], ["unbounded", "Unbounded"], ["syne", "Syne"]]} />
          <Seg label="Data colour" value={data} onChange={setData} options={[["mono", "Mono"], ["muted", "Muted"]]} />
          <Seg label="Wordmark" value={brand} onChange={setBrand} options={[["marker", "Marker"], ["tag", "Tag"], ["wild", "Wild tag"], ["spray", "Spray"]]} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Hero balance */}
          <section className="glass glass-glint rounded-[28px] p-6 lg:col-span-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] lux-mute">Safe to spend</p>
                <p className="text-5xl mt-1 tabular-nums" style={head}>813.90 €</p>
                <p className="text-xs lux-sub mt-1">until Nov 1 · keeps 100 € aside</p>
              </div>
              <span className="glass rounded-2xl w-11 h-11 flex items-center justify-center"><Wallet size={18} strokeWidth={1.5} /></span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-6">
              {[["Income", "4,032.01", c.pos, ArrowUpRight], ["Spent", "2,531.00", c.neg, ArrowDownRight], ["Saved", "37 %", c.pos, Sparkles]].map(([label, value, color, Icon]) => {
                const I = Icon as typeof Wallet;
                return (
                  <div key={label as string} className="rounded-2xl border lux-hair px-3 py-2.5 bg-white/[0.02]">
                    <p className="text-[10px] uppercase tracking-[0.14em] lux-mute flex items-center gap-1"><I size={11} style={{ color: color as string }} />{label as string}</p>
                    <p className="text-base font-medium tabular-nums mt-0.5" style={{ color: color as string }}>{value as string}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Switch + segmented, like the reference */}
          <section className="glass rounded-[28px] p-5">
            <h2 className="text-2xl mb-4" style={head}>Settings</h2>
            <div className="space-y-3">
              {["Push notifications", "Bank sync", "Monthly review email"].map((label, i) => {
                const on = i === 0 ? toggle : i === 1;
                return (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-sm">{label}</span>
                    <button
                      onClick={() => i === 0 && setToggle(!toggle)}
                      aria-pressed={on}
                      aria-label={label}
                      className={`relative w-14 h-8 rounded-full transition-all duration-300 ${on ? "glass glass-sparkle" : "bg-white/[0.06] border lux-hair"}`}
                    >
                      <span className={`absolute top-1 w-6 h-6 rounded-full transition-all duration-300 ${on ? "left-7 bg-white shadow-[0_0_14px_rgba(255,255,255,.55)]" : "left-1 bg-white/35"}`} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="glass rounded-[20px] p-1.5 mt-5">
              {["October 2026", "September 2026", "August 2026"].map((m, i) => (
                <button key={m} onClick={() => setTab(i)} className={`w-full flex items-center gap-3 rounded-[16px] px-4 py-3 text-left transition-all duration-300 ${tab === i ? "glass glass-glint glass-sparkle" : ""}`}>
                  <Check size={16} className={tab === i ? "text-white" : "opacity-0"} />
                  <span className={`text-lg ${tab === i ? "text-white" : "lux-mute"}`} style={head}>{m}</span>
                </button>
              ))}
            </div>
          </section>

          {/* List */}
          <section className="glass rounded-[28px] overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-end justify-between">
              <h2 className="text-2xl" style={head}>Home</h2>
              <span className="text-sm tabular-nums lux-sub">1,148.82 €</span>
            </div>
            <div className="h-1 mx-5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full" style={{ width: "74%", background: c.bars[0] }} /></div>
            <ul className="mt-3">
              {[[House, "Mortgage", "745.32"], [ShoppingCart, "Rimi", "95.95"], [Utensils, "Lunch at work", "34.01"], [Car, "Circle K", "74.09"]].map(([Icon, name, amt]) => {
                const I = Icon as typeof Wallet;
                return (
                  <li key={name as string} className="flex items-center gap-3 px-5 py-3 border-t lux-hair">
                    <span className="w-9 h-9 rounded-xl bg-white/[0.05] border lux-hair flex items-center justify-center"><I size={16} strokeWidth={1.5} /></span>
                    <span className="flex-1 text-sm">{name as string}</span>
                    <span className="text-sm tabular-nums">{amt as string} €</span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Chart */}
          <section className="glass rounded-[28px] p-5">
            <div className="flex items-end justify-between mb-4">
              <h2 className="text-2xl" style={head}>Last six months</h2>
              <span className="text-xs lux-sub">avg 3,000 €</span>
            </div>
            <div className="flex items-end gap-2 h-36">
              {bars.map((h, i) => (
                <div key={i} className="flex-1 h-full flex flex-col items-center justify-end gap-1.5">
                  <div className="w-full rounded-t-xl" style={{ height: `${h}%`, background: i === bars.length - 1 ? "linear-gradient(180deg,#fff,rgba(255,255,255,.55))" : `linear-gradient(180deg, ${c.bars[i % c.bars.length]}cc, ${c.bars[i % c.bars.length]}33)` }} />
                  <span className="text-[10px] lux-mute">{["May", "Jun", "Jul", "Aug", "Sep", "Oct"][i]}</span>
                </div>
              ))}
            </div>
          </section>

          {/* PIN + buttons */}
          <section className="glass rounded-[28px] p-5">
            <h2 className="text-4xl mb-1 bg-gradient-to-b from-white to-[#9c9ca5] bg-clip-text text-transparent" style={{ fontFamily: BRAND[brand], filter: "drop-shadow(0 0 14px rgba(255,255,255,.12))" }}>Empty Wallet</h2>
            <p className="text-xs lux-sub mb-4">Enter your PIN</p>
            <div className="flex justify-center gap-2 mb-5">
              {[1, 1, 1, 0, 0, 0].map((f, i) => (
                <span key={i} className={`w-11 h-13 rounded-2xl flex items-center justify-center text-xl ${f ? "glass glass-glint" : "bg-white/[0.04] border lux-hair"} ${i === 3 ? "ring-1 ring-white/60" : ""}`} style={{ height: "3.25rem" }}>{f ? "•" : ""}</span>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="lux-btn flex-1 rounded-full py-3 text-sm font-semibold">Add expense</button>
              <button className="glass flex-1 rounded-full py-3 text-sm font-medium">Plan month</button>
            </div>
          </section>
        </div>
      </div>

      {/* Bottom bar */}
      <nav className="fixed left-3 right-3 z-[71] glass glass-glint rounded-[26px] max-w-md mx-auto" style={{ bottom: "calc(var(--sab, 0px) + 0.75rem)" }} aria-label="Preview navigation">
        <div className="flex items-stretch px-1.5 py-1.5">
          {[[Calendar, "Month"], [LayoutDashboard, "Dashboard"], [CirclePlus, "Add"], [Search, "Search"], [Menu, "Menu"]].map(([Icon, label], i) => {
            const I = Icon as typeof Wallet;
            const active = i === 1;
            return (
              <span key={label as string} className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-[20px] transition-all ${active ? "glass glass-sparkle" : ""}`}>
                <I size={20} strokeWidth={active ? 2 : 1.5} className={active ? "text-white" : "lux-sub"} />
                <span className={`text-[9px] font-medium ${active ? "text-white" : "lux-mute"}`}>{label as string}</span>
              </span>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
