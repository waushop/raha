"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ClipboardList, LayoutGrid, Repeat, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { useToast } from "./Toast";
import Glyph from "./Glyph";
import CategoryIcon from "./CategoryIcon";
import { GROUP_COLOR_CLASSES } from "@/types/expense";
import { GROUP_TEMPLATES, SUBSCRIPTION_PRESETS } from "@/lib/onboarding";
import { buildWelcomePlan, finishOnboarding, saveWelcomeGroups, saveWelcomeIncome, saveWelcomeSubscriptions } from "@/app/welcome/actions";

type Props = {
  existingGroups: string[];
  existingSubscriptions: string[];
  payday: { amount: number; day: number } | null;
  balance: number | null;
};

const STEPS = ["Groups", "Income", "Subscriptions", "Plan", "Done"] as const;
const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-[#5a6380] focus:outline-none focus:border-purple-500/50";
const labelCls = "block text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1";
const lower = (s: string) => s.trim().toLowerCase();

export default function WelcomeWizard({ existingGroups, existingSubscriptions, payday, balance }: Props) {
  const [step, setStep] = useState(0);
  const [planBuilt, setPlanBuilt] = useState(false);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const haveGroups = new Set(existingGroups.map(lower));
  const haveSubs = new Set(existingSubscriptions.map(lower));
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(
    () => new Set(GROUP_TEMPLATES.filter((t) => t.preselected && !haveGroups.has(lower(t.name))).map((t) => t.key)),
  );
  const [pickedSubs, setPickedSubs] = useState<Set<string>>(new Set());

  const last = STEPS.length - 1;

  function go(next: number) {
    navigator.vibrate?.(10);
    if (next === last) {
      // Reaching the end counts as onboarded, whatever was skipped.
      startTransition(async () => {
        const res = await finishOnboarding();
        if (!res.ok) { toast.showError(res.error); return; }
        setStep(next);
      });
      return;
    }
    setStep(next);
  }

  function toggle(set: Set<string>, key: string, update: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    update(next);
  }

  function saveAndNext() {
    if (step === 3) { go(step + 1); return; }
    const data = formRef.current ? new FormData(formRef.current) : new FormData();
    startTransition(async () => {
      if (step === 0) {
        const res = await saveWelcomeGroups(data);
        if (!res.ok) { toast.showError(res.error); return; }
        if (res.created > 0) toast.show(`${res.created} group${res.created === 1 ? "" : "s"} added`);
      } else if (step === 1) {
        if (!String(data.get("amount") ?? "").trim()) { go(step + 1); return; }
        const res = await saveWelcomeIncome(data);
        if (!res.ok) { toast.showError(res.error); return; }
        toast.show("Payday saved");
      } else if (step === 2) {
        const res = await saveWelcomeSubscriptions(data);
        if (!res.ok) { toast.showError(res.error); return; }
        if (res.created > 0) toast.show(`${res.created} subscription${res.created === 1 ? "" : "s"} added`);
      }
      go(step + 1);
    });
  }

  function buildPlan() {
    navigator.vibrate?.(10);
    startTransition(async () => {
      const res = await buildWelcomePlan();
      if (!res.ok) { toast.showError(res.error); return; }
      setPlanBuilt(true);
      toast.show(res.lines > 0 ? `Plan ready: ${res.lines} line${res.lines === 1 ? "" : "s"}` : "Plan is already up to date");
    });
  }

  function skipSetup() {
    startTransition(async () => {
      const res = await finishOnboarding();
      if (!res.ok) { toast.showError(res.error); return; }
      router.push("/dashboard");
    });
  }

  return (
    <div className="card rounded-2xl p-5 sm:p-6 space-y-5">
      {/* Progress */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((label, i) => (
            <span
              key={label}
              title={label}
              className={`h-2 rounded-full transition-all ${i === step ? "w-6 bg-pink-500" : i < step ? "w-2 bg-pink-500/50" : "w-2 bg-white/10"}`}
            />
          ))}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">{step + 1}/{STEPS.length} · {STEPS[step]}</span>
      </div>

      <form ref={formRef} key={step} onSubmit={(e) => { e.preventDefault(); saveAndNext(); }} className="space-y-4 animate-fade-in">
        {step === 0 && (
          <>
            <StepHeading icon={LayoutGrid} title="Pick your groups" text="Groups sit on top of categories, so you can see what the car or the kids really cost." />
            <div className="grid grid-cols-2 gap-2">
              {GROUP_TEMPLATES.map((t) => {
                const exists = haveGroups.has(lower(t.name));
                const on = exists || pickedGroups.has(t.key);
                const color = GROUP_COLOR_CLASSES[t.color];
                return (
                  <label
                    key={t.key}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition-all ${exists ? "opacity-60" : "cursor-pointer btn-press"} ${on ? `bg-white/[0.06] ${color.border}` : "border-white/[0.06] hover:bg-white/[0.03]"}`}
                  >
                    <input
                      type="checkbox" name="group" value={t.key} className="sr-only"
                      checked={on} disabled={exists}
                      onChange={() => toggle(pickedGroups, t.key, setPickedGroups)}
                    />
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 ${color.text}`}>
                      <Glyph name={t.icon} size={16} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-white">{t.name}</span>
                      {exists && <span className="block text-[10px] text-[#5a6380]">Already added</span>}
                    </span>
                    {on && <Check size={14} className="text-pink-400 shrink-0" />}
                  </label>
                );
              })}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <StepHeading icon={Wallet} title="Income and payday" text="Your take-home pay and the day it lands. Cash flow uses it to project your balance." />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="w-amount">Monthly pay €</label>
                <input id="w-amount" name="amount" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={payday?.amount ?? ""} placeholder="2400.00" className={inputCls} autoFocus />
              </div>
              <div>
                <label className={labelCls} htmlFor="w-day">Payday (day of month)</label>
                <input id="w-day" name="day" type="number" min="1" max="31" inputMode="numeric" defaultValue={payday?.day ?? 10} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="w-balance">In your account now € (optional)</label>
              <input id="w-balance" name="balance" type="number" step="0.01" inputMode="decimal" defaultValue={balance ?? ""} placeholder="1850.00" className={inputCls} />
              <p className="text-[10px] text-[#5a6380] mt-1">Leave empty to skip. Entries you add later roll it forward.</p>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <StepHeading icon={Repeat} title="Subscriptions and bills" text="Tick what you pay for. Prices and charge days are typical; adjust them before adding." />
            <div className="divide-y divide-white/[0.04] -mx-1">
              {SUBSCRIPTION_PRESETS.map((s) => {
                const exists = haveSubs.has(lower(s.name));
                const on = pickedSubs.has(s.key);
                return (
                  <div key={s.key} className={`flex items-center gap-2 px-1 py-2 ${exists ? "opacity-50" : ""}`}>
                    <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox" name="sub" value={s.key} disabled={exists} checked={on && !exists}
                        onChange={() => toggle(pickedSubs, s.key, setPickedSubs)}
                        className="w-4 h-4 accent-pink-500 shrink-0"
                      />
                      <CategoryIcon category={s.category} size={14} className="text-[#9ca3c0] shrink-0" />
                      <span className="text-sm text-white truncate">{s.name}</span>
                      {exists && <span className="text-[10px] text-[#5a6380] shrink-0">added</span>}
                    </label>
                    <input
                      name={`amount:${s.key}`} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={s.amount.toFixed(2)}
                      aria-label={`${s.name} price`} disabled={!on || exists}
                      className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white text-right font-mono tabular-nums focus:outline-none focus:border-purple-500/50 disabled:opacity-40"
                    />
                    <input
                      name={`day:${s.key}`} type="number" min="1" max="31" inputMode="numeric" defaultValue={s.day}
                      aria-label={`${s.name} charge day`} title="Charge day" disabled={!on || exists}
                      className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white text-center font-mono tabular-nums focus:outline-none focus:border-purple-500/50 disabled:opacity-40"
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-[#5a6380]">Price € · charge day. Anything else can be added on the Subscriptions page.</p>
          </>
        )}

        {step === 3 && (
          <>
            <StepHeading icon={ClipboardList} title="This month's plan" text="Give every euro a job: lines from your recent spending, your subscriptions and your pay." />
            <button
              type="button" onClick={buildPlan} disabled={isPending || planBuilt}
              className="w-full gradient-pink text-white rounded-xl px-5 py-3 text-sm font-bold hover:opacity-90 disabled:opacity-60 transition-all btn-press shadow-lg shadow-pink-500/20 flex items-center justify-center gap-2"
            >
              {planBuilt ? <><Check size={16} /> Plan built</> : <><Sparkles size={16} /> {isPending ? "Building..." : "Build this month's plan"}</>}
            </button>
            {planBuilt && (
              <p className="text-xs text-[#9ca3c0]">
                Review it any time on the <Link href="/plan" className="text-pink-400 hover:text-pink-300">Plan</Link> page.
              </p>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <StepHeading icon={Check} title="You're set" text="Here is where to go next." />
            <div className="grid grid-cols-2 gap-2">
              <DoneLink href="/" icon={CalendarDays} label="Month" text="Add expenses" />
              <DoneLink href="/plan" icon={ClipboardList} label="Plan" text="Budget the month" />
              <DoneLink href="/subscriptions" icon={Repeat} label="Subscriptions" text="Bills and renewals" />
              <DoneLink href="/cashflow" icon={TrendingUp} label="Cash flow" text="Safe to spend" />
            </div>
          </>
        )}

        {/* Navigation */}
        {step < last && (
          <div className="flex items-center gap-2 pt-1">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} disabled={isPending}
                className="px-4 py-2.5 text-sm font-medium border border-white/[0.08] rounded-xl text-[#9ca3c0] hover:bg-white/5 hover:text-white transition-all btn-press">
                Back
              </button>
            )}
            <button type="button" onClick={() => go(step + 1)} disabled={isPending}
              className="ml-auto px-4 py-2.5 text-sm font-medium text-[#5a6380] hover:text-white transition-colors">
              Skip
            </button>
            <button type="submit" disabled={isPending}
              className="gradient-pink text-white rounded-xl px-6 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all btn-press shadow-lg shadow-pink-500/20">
              {isPending ? "Saving..." : step === 3 ? "Finish" : "Next"}
            </button>
          </div>
        )}
      </form>

      {step < last && (
        <button type="button" onClick={skipSetup} disabled={isPending} className="block mx-auto text-[11px] text-[#5a6380] hover:text-[#9ca3c0] transition-colors">
          Skip setup, I&apos;ll explore myself
        </button>
      )}
    </div>
  );
}

function StepHeading({ icon: Icon, title, text }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center shrink-0">
        <Icon size={18} className="text-pink-400" />
      </span>
      <div>
        <h2 className="text-base font-bold text-white">{title}</h2>
        <p className="text-xs text-[#9ca3c0] mt-0.5">{text}</p>
      </div>
    </div>
  );
}

function DoneLink({ href, icon: Icon, label, text }: { href: string; icon: React.ComponentType<{ size?: number; className?: string }>; label: string; text: string }) {
  return (
    <Link href={href} className="surface rounded-xl p-3 hover:bg-white/[0.06] transition-colors btn-press">
      <Icon size={16} className="text-pink-400 mb-1.5" />
      <span className="block text-sm font-medium text-white">{label}</span>
      <span className="block text-[10px] text-[#5a6380]">{text}</span>
    </Link>
  );
}
