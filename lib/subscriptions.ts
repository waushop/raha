// Subscriptions: recurring commitments with a cadence, a charge day and a
// status. Ledger rows link to them through LEDGER.SUBSCRIPTION_ID. This
// module is pure (no db import) so lib/schema.ts, the seed script and tests
// can all use it; database access lives in lib/subscriptions-db.ts.
import { addMonths, daysInMonth } from "./months";

export const CADENCES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export type Cadence = (typeof CADENCES)[number];
export const STATUSES = ["active", "paused", "cancelled"] as const;
export type SubscriptionStatus = (typeof STATUSES)[number];

export const PERIODS_PER_YEAR: Record<Cadence, number> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };
export const CADENCE_LABEL: Record<Cadence, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" };
export const CADENCE_SHORT: Record<Cadence, string> = { weekly: "wk", monthly: "mo", quarterly: "qtr", yearly: "yr" };

/** Months of silence after which a subscription looks unused, per cadence. */
export const UNUSED_AFTER_MONTHS: Record<Cadence, number> = { weekly: 2, monthly: 2, quarterly: 6, yearly: 24 };

export function monthlyEquivalent(amount: number, cadence: Cadence): number {
  return (amount * PERIODS_PER_YEAR[cadence]) / 12;
}

export function yearlyCost(amount: number, cadence: Cadence): number {
  return amount * PERIODS_PER_YEAR[cadence];
}

export type Charge = { month: string; day: number | null };

function monthDiff(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function weeklyWithin(charges: Charge[]): boolean {
  const byMonth = new Map<string, number[]>();
  for (const c of charges) {
    if (c.day === null) continue;
    if (!byMonth.has(c.month)) byMonth.set(c.month, []);
    byMonth.get(c.month)!.push(c.day);
  }
  for (const days of byMonth.values()) {
    if (days.length < 3) continue;
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    if (sorted.length < 3) continue;
    const gaps = sorted.slice(1).map((d, i) => d - sorted[i]);
    if (gaps.every((g) => g >= 5 && g <= 9)) return true;
  }
  return false;
}

/**
 * Guesses how often something is charged from the months (and days) it was
 * seen in. Two charges a year apart → yearly; every third month → quarterly;
 * three or more a month roughly a week apart → weekly; otherwise monthly.
 */
export function detectCadence(charges: Charge[]): Cadence {
  if (weeklyWithin(charges)) return "weekly";
  const months = [...new Set(charges.map((c) => c.month))].sort();
  if (months.length < 2) return "monthly";
  const gaps = months.slice(1).map((m, i) => monthDiff(months[i], m));
  if (gaps.every((g) => g % 12 === 0)) return "yearly";
  if (gaps.every((g) => g % 3 === 0)) return "quarterly";
  return "monthly";
}

/** Most common value, ties broken by the most recent (first in list). */
export function modeDay(days: Array<number | null>): number | null {
  const counts = new Map<number, number>();
  for (const d of days) if (d !== null) counts.set(d, (counts.get(d) ?? 0) + 1);
  let best: number | null = null;
  let bestN = 0;
  for (const d of days) {
    if (d === null) continue;
    const n = counts.get(d)!;
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

// ---------- dates ----------
// All dates are YYYY-MM-DD strings; arithmetic goes through UTC to dodge DST.

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dateIn(month: string, day: number): string {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
}

function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export type DueInput = {
  cadence: Cadence;
  day: number | null;
  /** 1–12 anchor month for quarterly/yearly; falls back to the last charge. */
  monthOfYear: number | null;
  lastCharge: Charge | null;
};

/** The next date a charge is expected on or after `today`. */
export function nextDue(s: DueInput, today: string): string | null {
  const todayMonth = today.slice(0, 7);
  if (s.cadence === "weekly") {
    if (!s.lastCharge || s.lastCharge.day === null) return today;
    let d = addDays(dateIn(s.lastCharge.month, s.lastCharge.day), 7);
    while (d < today) d = addDays(d, 7);
    return d;
  }
  const day = s.day ?? s.lastCharge?.day ?? 1;
  // A period that already has a charge is done; start looking after it.
  const paidThrough = s.lastCharge?.month ?? "";
  if (s.cadence === "monthly") {
    const candidate = dateIn(todayMonth, day);
    const next = candidate >= today && todayMonth > paidThrough ? candidate : dateIn(addMonths(todayMonth, 1), day);
    return next.slice(0, 7) > paidThrough ? next : dateIn(addMonths(paidThrough, 1), day);
  }
  const step = s.cadence === "quarterly" ? 3 : 12;
  const anchor = s.monthOfYear ?? (s.lastCharge ? Number(s.lastCharge.month.slice(5, 7)) : Number(todayMonth.slice(5, 7)));
  let month = todayMonth;
  for (let i = 0; i < 13 + step; i++) {
    const mm = Number(month.slice(5, 7));
    if ((((mm - anchor) % step) + step) % step === 0 && month > paidThrough) {
      const candidate = dateIn(month, day);
      if (candidate >= today) return candidate;
    }
    month = addMonths(month, 1);
  }
  return null;
}

/** The charge after `date` for this cadence (keeps the intended day). */
export function advance(date: string, cadence: Cadence, day: number | null): string {
  if (cadence === "weekly") return addDays(date, 7);
  const step = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 12;
  return dateIn(addMonths(date.slice(0, 7), step), day ?? Number(date.slice(8, 10)));
}

export type UpcomingCharge<T> = { sub: T; date: string; amount: number };

/** Every expected charge within `days` of `today`, soonest first. */
export function upcoming<T extends DueInput & { amount: number; status: SubscriptionStatus }>(
  subs: T[], today: string, days: number,
): UpcomingCharge<T>[] {
  const limit = addDays(today, days);
  const out: UpcomingCharge<T>[] = [];
  for (const sub of subs) {
    if (sub.status !== "active") continue;
    let d = nextDue(sub, today);
    let guard = 0;
    while (d !== null && d <= limit && guard++ < 60) {
      out.push({ sub, date: d, amount: sub.amount });
      d = advance(d, sub.cadence, sub.day);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}

/** True when nothing has been charged for longer than the cadence allows. */
export function isUnused(cadence: Cadence, lastChargeMonth: string | null, currentMonth: string): boolean {
  if (!lastChargeMonth) return false;
  return monthDiff(lastChargeMonth, currentMonth) > UNUSED_AFTER_MONTHS[cadence];
}

/** Expected spend per calendar month (index 0 = January) for a year. */
export function expectedByMonthOfYear(subs: Array<{ amount: number; cadence: Cadence; anchorMonth: number; status: SubscriptionStatus }>): number[] {
  const out = Array(12).fill(0) as number[];
  for (const s of subs) {
    if (s.status !== "active") continue;
    for (let m = 1; m <= 12; m++) {
      const hit =
        s.cadence === "monthly" || s.cadence === "weekly"
          ? true
          : s.cadence === "quarterly"
            ? (((m - s.anchorMonth) % 3) + 3) % 3 === 0
            : m === s.anchorMonth;
      if (hit) out[m - 1] += s.cadence === "weekly" ? monthlyEquivalent(s.amount, "weekly") : s.amount;
    }
  }
  return out;
}

// ---------- linking ledger rows (runs inside a transaction or on the raw connection) ----------

/** The minimal query surface shared by the db shim's Tx and a wrapped DatabaseSync. */
export type Q = {
  all<T>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): unknown;
};

type LinkRow = {
  ID: string; WORKSPACE_ID: string; NAME: string; CATEGORY: string; GROUP_ID: string | null;
  AMOUNT: number; MONTH: string; DAY: number | null; KIND: string; IS_RECURRING: number; SUBSCRIPTION_ID: string | null;
};

function findSubscription(q: Q, ws: string, name: string, category: string, groupId: string | null): { ID: string; STATUS: string } | null {
  return q.all<{ ID: string; STATUS: string }>(
    "SELECT ID, STATUS FROM SUBSCRIPTION WHERE WORKSPACE_ID = ? AND NAME = ? AND CATEGORY = ? AND COALESCE(GROUP_ID, '') = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT LIMIT 1",
    [ws, name, category, groupId ?? ""],
  )[0] ?? null;
}

/**
 * Creates (or reuses) the subscription that a group of recurring rows
 * belongs to and links the rows to it. `rows` must share ws/name/category/
 * group and be sorted newest first. Returns the subscription id.
 */
export function attachRows(q: Q, rows: LinkRow[], currentMonth: string, newId: () => string): string {
  const latest = rows[0];
  const charges: Charge[] = rows.map((r) => ({ month: r.MONTH, day: r.DAY }));
  const existing = findSubscription(q, latest.WORKSPACE_ID, latest.NAME, latest.CATEGORY, latest.GROUP_ID);
  let id: string;
  if (existing) {
    id = existing.ID;
    // A charge dated after the pause/cancel month means it is alive again;
    // copying an old recurring row into the same or an earlier month does not.
    const revive = `(STATUS <> 'active' AND ? > substr(COALESCE(STATUS_CHANGED_AT, ''), 1, 7))`;
    q.run(
      `UPDATE SUBSCRIPTION SET AMOUNT = ?, DAY = COALESCE(?, DAY),
         STATUS_CHANGED_AT = CASE WHEN ${revive} THEN CURRENT_TIMESTAMP ELSE STATUS_CHANGED_AT END,
         STATUS = CASE WHEN ${revive} THEN 'active' ELSE STATUS END
       WHERE ID = ?`,
      [latest.AMOUNT, latest.DAY, latest.MONTH, latest.MONTH, id],
    );
  } else {
    id = newId();
    const cadence = detectCadence(charges);
    const lastMonth = rows.reduce((m, r) => (r.MONTH > m ? r.MONTH : m), rows[0].MONTH);
    const active = !isUnused(cadence, lastMonth, currentMonth);
    q.run(
      `INSERT INTO SUBSCRIPTION (ID, WORKSPACE_ID, NAME, CATEGORY, GROUP_ID, AMOUNT, CADENCE, DAY, MONTH_OF_YEAR, STATUS, STATUS_CHANGED_AT)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
      [id, latest.WORKSPACE_ID, latest.NAME, latest.CATEGORY, latest.GROUP_ID, latest.AMOUNT, cadence, modeDay(rows.map((r) => r.DAY)),
       cadence === "quarterly" || cadence === "yearly" ? Number(lastMonth.slice(5, 7)) : null, active ? "active" : "cancelled",
       // Detected as stale: it stopped after its last charge, so any later charge revives it.
       active ? null : `${lastMonth}-28 00:00:00`],
    );
  }
  for (const r of rows) q.run("UPDATE LEDGER SET SUBSCRIPTION_ID = ? WHERE ID = ?", [id, r.ID]);
  return id;
}

/** Links every unlinked recurring expense row to a subscription. Idempotent. */
export function backfillSubscriptions(q: Q, currentMonth: string, newId: () => string): number {
  const rows = q.all<LinkRow>(
    `SELECT ID, WORKSPACE_ID, NAME, CATEGORY, GROUP_ID, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, DAY, KIND, IS_RECURRING, SUBSCRIPTION_ID
     FROM LEDGER WHERE IS_RECURRING = 1 AND KIND = 'expense' AND DELETED_AT IS NULL AND SUBSCRIPTION_ID IS NULL AND WORKSPACE_ID IS NOT NULL
     ORDER BY MONTH DESC, CREATED_AT DESC`,
  );
  const groups = new Map<string, LinkRow[]>();
  for (const r of rows) {
    const key = [r.WORKSPACE_ID, r.NAME, r.CATEGORY, r.GROUP_ID ?? ""].join("\u0000");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  for (const list of groups.values()) attachRows(q, list, currentMonth, newId);
  return groups.size;
}

/** After a row changes: link it when it is a recurring expense, unlink otherwise. */
export function syncRowLink(q: Q, ws: string, rowId: string, currentMonth: string, newId: () => string): void {
  const row = q.all<LinkRow>(
    `SELECT ID, WORKSPACE_ID, NAME, CATEGORY, GROUP_ID, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, DAY, KIND, IS_RECURRING, SUBSCRIPTION_ID
     FROM LEDGER WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL`,
    [rowId, ws],
  )[0];
  if (!row) return;
  if (row.IS_RECURRING !== 1 || row.KIND !== "expense") {
    if (row.SUBSCRIPTION_ID) q.run("UPDATE LEDGER SET SUBSCRIPTION_ID = NULL WHERE ID = ?", [rowId]);
    return;
  }
  // Re-link when the identity (name/category/group) no longer matches the linked subscription.
  if (row.SUBSCRIPTION_ID) {
    const linked = q.all<{ NAME: string; CATEGORY: string; GROUP_ID: string | null }>(
      "SELECT NAME, CATEGORY, GROUP_ID FROM SUBSCRIPTION WHERE ID = ? AND DELETED_AT IS NULL", [row.SUBSCRIPTION_ID],
    )[0];
    if (linked && linked.NAME === row.NAME && linked.CATEGORY === row.CATEGORY && (linked.GROUP_ID ?? "") === (row.GROUP_ID ?? "")) {
      q.run("UPDATE SUBSCRIPTION SET AMOUNT = ?, DAY = COALESCE(?, DAY) WHERE ID = ? AND ? >= (SELECT COALESCE(MAX(MONTH), '') FROM LEDGER WHERE SUBSCRIPTION_ID = ? AND DELETED_AT IS NULL)",
        [row.AMOUNT, row.DAY, row.SUBSCRIPTION_ID, row.MONTH, row.SUBSCRIPTION_ID]);
      return;
    }
  }
  attachRows(q, [row], currentMonth, newId);
}
