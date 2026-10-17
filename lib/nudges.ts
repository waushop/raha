// Nudges: what deserves a notification today. Pure; the inputs are the
// views other modules already compute. Each nudge carries a DEDUP_KEY so the
// hourly run never repeats itself (the inbox table is unique on it).
import type { SubscriptionView } from "./subscriptions-db";
import type { PlanSummary } from "./plan";
import type { Projection } from "./cashflow";
import { addDays } from "./cashflow";

export type Nudge = {
  kind: "bill_due" | "trial_ending" | "price_up" | "unused" | "plan_line" | "safe_to_spend" | "weekly_digest" | "monthly_review" | "bank_expiring" | "bank_failing";
  dedupKey: string;
  title: string;
  body: string;
  url: string;
  /** Also worth an email (digest-type nudges), when mail is configured. */
  email?: boolean;
};

export type NudgeInput = {
  today: string;
  subscriptions: SubscriptionView[];
  /** Expected charges in the next few days (from lib/subscriptions upcoming). */
  upcoming: Array<{ id: string; name: string; date: string; amount: number }>;
  plan: PlanSummary | null;
  projection: Projection | null;
  buffer: number;
  /** Totals for the digest. */
  week: { spent: number; income: number; count: number; topCategory: string | null; topAmount: number } | null;
  /** Bank connections (lib/banksync-db.ts bankNudgeInputs); omitted = none. */
  bank?: Array<{ id: string; name: string; status: string; validUntil: string | null; lastError: string | null; lastSyncAt: string | null }>;
};

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (iso: string) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

function isoWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - start.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function evaluateNudges(i: NudgeInput): Nudge[] {
  const out: Nudge[] = [];
  const tomorrow = addDays(i.today, 1);
  const month = i.today.slice(0, 7);

  for (const u of i.upcoming) {
    if (u.date === tomorrow) {
      out.push({ kind: "bill_due", dedupKey: `bill:${u.id}:${u.date}`, title: `${u.name} is due tomorrow`, body: `${fmt(u.amount)} € on ${short(u.date)}. Tap to record it when it goes out.`, url: "/subscriptions" });
    }
  }

  for (const s of i.subscriptions) {
    if (s.STATUS !== "active") continue;
    if (s.TRIAL_ENDS && s.TRIAL_ENDS >= i.today && s.TRIAL_ENDS <= addDays(i.today, 3)) {
      out.push({ kind: "trial_ending", dedupKey: `trial:${s.ID}:${s.TRIAL_ENDS}`, title: `${s.NAME} trial ends ${short(s.TRIAL_ENDS)}`, body: `After that it costs ${fmt(s.AMOUNT)} €. Cancel now if you are not using it.`, url: "/subscriptions" });
    }
    if (s.previousAmount !== null && s.AMOUNT > s.previousAmount && s.changedIn && s.changedIn >= month.slice(0, 7)) {
      out.push({ kind: "price_up", dedupKey: `price:${s.ID}:${s.changedIn}`, title: `${s.NAME} went up`, body: `${fmt(s.previousAmount)} € → ${fmt(s.AMOUNT)} € (+${((s.AMOUNT / s.previousAmount - 1) * 100).toFixed(0)}%).`, url: "/subscriptions" });
    }
    if (s.unused) {
      out.push({ kind: "unused", dedupKey: `unused:${s.ID}:${month}`, title: `Still using ${s.NAME}?`, body: `No charge since ${s.lastCharge?.month ?? "a while"}. Pause or cancel it from the subscriptions page.`, url: "/subscriptions" });
    }
  }

  if (i.plan) {
    for (const l of i.plan.lines) {
      if (l.KIND === "income" || l.PLANNED <= 0) continue;
      const ratio = l.actual / l.PLANNED;
      const over = l.actual > l.PLANNED + 0.005;
      // Fixed bills (subscription lines) land exactly on plan by design; only a
      // real overshoot is worth a nudge there.
      if (l.SUBSCRIPTION_ID && !over) continue;
      if (over) {
        out.push({ kind: "plan_line", dedupKey: `plan:${l.ID}:100`, title: `${l.LABEL} is over plan`, body: `${fmt(l.actual)} € spent of ${fmt(l.PLANNED)} € planned this month.`, url: `/plan?month=${l.MONTH}` });
      } else if (ratio >= 0.8) {
        out.push({ kind: "plan_line", dedupKey: `plan:${l.ID}:80`, title: `${l.LABEL} at ${Math.round(ratio * 100)}% of plan`, body: `${fmt(l.PLANNED - l.actual)} € left for the rest of the month.`, url: `/plan?month=${l.MONTH}` });
      }
    }
  }

  if (i.projection && i.projection.safeToSpend < 0) {
    out.push({ kind: "safe_to_spend", dedupKey: `safe:${i.today}`, title: "Heads up: tight until payday", body: `Projected low point ${fmt(i.projection.lowPoint.balance)} € on ${short(i.projection.lowPoint.date)}${i.projection.nextPayday ? `, payday ${short(i.projection.nextPayday.date)}` : ""}.`, url: "/cashflow" });
  }

  for (const b of i.bank ?? []) {
    const until = b.validUntil?.slice(0, 10) ?? null;
    if (until && (b.status === "active" || b.status === "error") && until >= i.today && until <= addDays(i.today, 7)) {
      out.push({ kind: "bank_expiring", dedupKey: `bank-expiry:${b.id}:${until}`, title: `${b.name} access ends ${short(until)}`, body: "Banks only allow access for a limited time. Reconnect to keep transactions syncing.", url: "/bank" });
    } else if (b.status === "expired") {
      out.push({ kind: "bank_expiring", dedupKey: `bank-expired:${b.id}:${until ?? "unknown"}`, title: `${b.name} access has ended`, body: "Transactions are no longer syncing. Reconnect the bank to resume.", url: "/bank" });
    }
    if (b.status === "error" && b.lastError) {
      out.push({ kind: "bank_failing", dedupKey: `bank-error:${b.id}:${b.lastSyncAt ?? "never"}`, title: `${b.name} sync is failing`, body: b.lastError.slice(0, 160), url: "/bank" });
    }
  }

  const dow = new Date(i.today + "T00:00:00Z").getUTCDay();
  if (dow === 0 && i.week) {
    const w = i.week;
    out.push({
      kind: "weekly_digest", dedupKey: `digest:${isoWeek(i.today)}`, title: "Your week in money", email: true,
      body: `${fmt(w.spent)} € across ${w.count} entr${w.count === 1 ? "y" : "ies"}${w.topCategory ? `, most of it on ${w.topCategory} (${fmt(w.topAmount)} €)` : ""}${w.income > 0 ? `; ${fmt(w.income)} € came in` : ""}.`,
      url: "/dashboard",
    });
  }
  if (i.today.endsWith("-01")) {
    out.push({ kind: "monthly_review", dedupKey: `review:${month}`, title: "Last month's review is ready", body: "See where the money went, what changed and how the goals moved.", url: "/review", email: true });
  }
  return out;
}
