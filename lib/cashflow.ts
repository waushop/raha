// Cash-flow projection: start from the last known balance, add paydays,
// subtract bills (subscription charges) and a daily variable drain, and read
// off "safe to spend": the lowest point before the next payday minus a buffer.
// Pure; database access in lib/cashflow-db.ts.
import { daysInMonth } from "./months";

export const PAYDAY_CADENCES = ["monthly", "biweekly", "weekly", "once"] as const;
export type PaydayCadence = (typeof PAYDAY_CADENCES)[number];
export const PAYDAY_CADENCE_LABEL: Record<PaydayCadence, string> = { monthly: "Monthly", biweekly: "Every 2 weeks", weekly: "Weekly", once: "One-off" };

export type Payday = {
  ID: string;
  LABEL: string;
  AMOUNT: number;
  CADENCE: PaydayCadence;
  /** 1–31 for monthly (clamped in short months). */
  DAY: number | null;
  /** YYYY-MM-DD anchor for biweekly/weekly/once. */
  START_DATE: string | null;
};

export type Event = { date: string; label: string; amount: number; kind: "payday" | "bill" };

function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dateIn(month: string, day: number): string {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
}
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Every payday date within [from, to]. */
export function paydayOccurrences(paydays: Payday[], from: string, to: string): Event[] {
  const out: Event[] = [];
  for (const p of paydays) {
    if (p.CADENCE === "monthly") {
      let month = from.slice(0, 7);
      for (let i = 0; i < 14; i++) {
        const d = dateIn(month, p.DAY ?? 1);
        if (d > to) break;
        if (d >= from) out.push({ date: d, label: p.LABEL, amount: p.AMOUNT, kind: "payday" });
        month = nextMonth(month);
      }
    } else if (p.CADENCE === "once") {
      if (p.START_DATE && p.START_DATE >= from && p.START_DATE <= to) out.push({ date: p.START_DATE, label: p.LABEL, amount: p.AMOUNT, kind: "payday" });
    } else if (p.START_DATE) {
      const step = p.CADENCE === "weekly" ? 7 : 14;
      let d = p.START_DATE;
      // fast-forward in whole steps instead of day by day
      if (d < from) {
        const gap = Math.floor((toDate(from).getTime() - toDate(d).getTime()) / 86400000);
        d = addDays(d, Math.floor(gap / step) * step);
        while (d < from) d = addDays(d, step);
      }
      while (d <= to) { out.push({ date: d, label: p.LABEL, amount: p.AMOUNT, kind: "payday" }); d = addDays(d, step); }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export type ProjectionInput = {
  today: string;
  startBalance: number;
  horizonDays: number;
  paydays: Event[];
  bills: Event[];
  /** Typical variable spend per day (groceries, fuel…), drained every day. */
  dailyVariable: number;
  /** Money you always want to keep in the account. */
  buffer: number;
};

export type DayPoint = { date: string; balance: number; events: Event[] };

export type Projection = {
  days: DayPoint[];
  lowPoint: { date: string; balance: number };
  nextPayday: Event | null;
  /** Lowest balance from today until the next payday (inclusive of that morning), minus the buffer. */
  safeToSpend: number;
  /** For each payday in the window: income vs bills until the following payday. */
  paychecks: Array<{ payday: Event; bills: number; variable: number; shortfall: number }>;
};

export function project(i: ProjectionInput): Projection {
  const byDate = new Map<string, Event[]>();
  for (const e of [...i.paydays, ...i.bills]) {
    if (e.date < i.today) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }
  const days: DayPoint[] = [];
  let balance = i.startBalance;
  let low = { date: i.today, balance };
  const paydaysAhead = i.paydays.filter((p) => p.date > i.today).sort((a, b) => a.date.localeCompare(b.date));
  const nextPayday = paydaysAhead[0] ?? null;
  let lowBeforePayday = balance;
  for (let n = 0; n <= i.horizonDays; n++) {
    const date = addDays(i.today, n);
    const events = (byDate.get(date) ?? []).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "payday" ? -1 : 1));
    if (n > 0) {
      balance -= i.dailyVariable;
      for (const e of events) balance += e.kind === "payday" ? e.amount : -e.amount;
    } else {
      // today: bills due today still have to be paid; paydays today count as received
      for (const e of events) balance += e.kind === "payday" ? e.amount : -e.amount;
    }
    balance = Math.round(balance * 100) / 100;
    days.push({ date, balance, events });
    if (balance < low.balance) low = { date, balance };
    if (!nextPayday || date < nextPayday.date) lowBeforePayday = Math.min(lowBeforePayday, balance);
  }
  const paychecks = paydaysAhead.map((p, idx) => {
    const until = paydaysAhead[idx + 1]?.date ?? addDays(i.today, i.horizonDays);
    const bills = i.bills.filter((b) => b.date >= p.date && b.date < until).reduce((s, b) => s + b.amount, 0);
    const span = Math.max(1, Math.round((toDate(until).getTime() - toDate(p.date).getTime()) / 86400000));
    const variable = Math.round(i.dailyVariable * span * 100) / 100;
    return { payday: p, bills, variable, shortfall: Math.max(0, bills + variable - p.amount) };
  });
  return {
    days,
    lowPoint: low,
    nextPayday,
    safeToSpend: Math.round((lowBeforePayday - i.buffer) * 100) / 100,
    paychecks,
  };
}

/**
 * A payday whose salary is already logged as an income row in the same
 * month (amount within 5 %) is not added again by the projection.
 */
export function dropLoggedPaydays(paydays: Event[], logged: Array<{ month: string; amount: number }>): Event[] {
  const pool = logged.map((l) => ({ ...l, used: false }));
  return paydays.filter((p) => {
    const hit = pool.find((l) => !l.used && l.month === p.date.slice(0, 7) && Math.abs(l.amount - p.amount) <= p.amount * 0.05);
    if (hit) { hit.used = true; return false; }
    return true;
  });
}
