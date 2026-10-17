// Database side of subscriptions: the list view with charge history,
// price changes, next due date and the unused flag.
import { randomUUID } from "node:crypto";
import db, { type Tx } from "./db";
import { currentMonth } from "./months";
import {
  isUnused, monthlyEquivalent, nextDue, yearlyCost, type Cadence, type Charge, type SubscriptionStatus,
} from "./subscriptions";

export type SubscriptionRow = {
  ID: string; NAME: string; CATEGORY: string; GROUP_ID: string | null; AMOUNT: number; CADENCE: Cadence;
  DAY: number | null; MONTH_OF_YEAR: number | null; STATUS: SubscriptionStatus; STATUS_CHANGED_AT: string | null;
  NOTES: string | null; CANCEL_URL: string | null; TRIAL_ENDS: string | null; CREATED_AT: string;
  GROUP_NAME: string | null; GROUP_ICON: string | null; GROUP_COLOR: string | null;
};

export type PricePoint = { month: string; amount: number; count: number };

export type SubscriptionView = SubscriptionRow & {
  group: { name: string; icon: string | null; color: string } | null;
  charges: number;
  firstMonth: string | null;
  lastCharge: Charge | null;
  totalSpent: number;
  /** Distinct prices, newest first (first entry = current price). */
  prices: PricePoint[];
  previousAmount: number | null;
  changedIn: string | null;
  nextDue: string | null;
  unused: boolean;
  monthly: number;
  yearly: number;
  /** 1–12 month used for the yearly calendar strip. */
  anchorMonth: number;
};

export type NewSubscription = {
  name: string; category: string; groupId: string | null; amount: number; cadence: Cadence;
  day: number | null; monthOfYear: number | null; trialEnds: string | null; cancelUrl: string | null; notes: string | null;
};

/** Inserts an active subscription inside a transaction; returns its id. */
export function insertSubscription(tx: Tx, ws: string, f: NewSubscription): string {
  const id = randomUUID();
  tx.run(
    `INSERT INTO SUBSCRIPTION (ID, WORKSPACE_ID, NAME, CATEGORY, GROUP_ID, AMOUNT, CADENCE, DAY, MONTH_OF_YEAR, STATUS, STATUS_CHANGED_AT, TRIAL_ENDS, CANCEL_URL, NOTES)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, ?, ?, ?)`,
    [id, ws, f.name, f.category, f.groupId, f.amount, f.cadence, f.day, f.monthOfYear, f.trialEnds, f.cancelUrl, f.notes],
  );
  return id;
}

type ChargeRow = { SUBSCRIPTION_ID: string; AMOUNT: number; MONTH: string; DAY: number | null };

export async function listSubscriptions(ws: string, today: string): Promise<SubscriptionView[]> {
  const [subRows] = await db.execute(
    `SELECT s.ID, s.NAME, s.CATEGORY, s.GROUP_ID, CAST(s.AMOUNT AS REAL) AS AMOUNT, s.CADENCE, s.DAY, s.MONTH_OF_YEAR, s.STATUS,
            s.STATUS_CHANGED_AT, s.NOTES, s.CANCEL_URL, s.TRIAL_ENDS, s.CREATED_AT,
            g.NAME AS GROUP_NAME, g.ICON AS GROUP_ICON, g.COLOR AS GROUP_COLOR
     FROM SUBSCRIPTION s LEFT JOIN CATEGORY_GROUP g ON g.ID = s.GROUP_ID AND g.DELETED_AT IS NULL
     WHERE s.WORKSPACE_ID = ? AND s.DELETED_AT IS NULL ORDER BY s.STATUS = 'active' DESC, s.AMOUNT DESC`,
    [ws],
  );
  const [chargeRows] = await db.execute(
    `SELECT SUBSCRIPTION_ID, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, DAY FROM LEDGER
     WHERE WORKSPACE_ID = ? AND SUBSCRIPTION_ID IS NOT NULL AND DELETED_AT IS NULL ORDER BY MONTH DESC, COALESCE(DAY, 0) DESC, CREATED_AT DESC`,
    [ws],
  );
  const charges = new Map<string, ChargeRow[]>();
  for (const c of chargeRows as ChargeRow[]) {
    if (!charges.has(c.SUBSCRIPTION_ID)) charges.set(c.SUBSCRIPTION_ID, []);
    charges.get(c.SUBSCRIPTION_ID)!.push(c);
  }
  const month = currentMonth();
  return (subRows as SubscriptionRow[]).map((s) => {
    const list = charges.get(s.ID) ?? [];
    const prices: PricePoint[] = [];
    for (const c of list) {
      const run = prices[prices.length - 1];
      if (!run || Math.abs(run.amount - c.AMOUNT) > 0.004) prices.push({ month: c.MONTH, amount: c.AMOUNT, count: 1 });
      else { run.month = c.MONTH; run.count++; } // extend the run back to its earliest month
    }
    // A "price change" needs a price that held for at least two charges before
    // it; otherwise it's just a variable bill (electricity) bouncing around.
    const stableChange = prices.length > 1 && prices[1].count >= 2;
    const lastCharge: Charge | null = list[0] ? { month: list[0].MONTH, day: list[0].DAY } : null;
    const due = nextDue({ cadence: s.CADENCE, day: s.DAY, monthOfYear: s.MONTH_OF_YEAR, lastCharge }, today);
    return {
      ...s,
      group: s.GROUP_NAME ? { name: s.GROUP_NAME, icon: s.GROUP_ICON, color: s.GROUP_COLOR ?? "blue" } : null,
      charges: list.length,
      firstMonth: list.length ? list[list.length - 1].MONTH : null,
      lastCharge,
      totalSpent: list.reduce((sum, c) => sum + c.AMOUNT, 0),
      prices,
      previousAmount: stableChange ? prices[1].amount : null,
      changedIn: stableChange ? prices[0].month : null,
      nextDue: s.STATUS === "active" ? due : null,
      unused: s.STATUS === "active" && isUnused(s.CADENCE, lastCharge?.month ?? null, month),
      monthly: monthlyEquivalent(s.AMOUNT, s.CADENCE),
      yearly: yearlyCost(s.AMOUNT, s.CADENCE),
      anchorMonth: s.MONTH_OF_YEAR ?? Number((due ?? lastCharge?.month ?? month).slice(5, 7)),
    };
  });
}
