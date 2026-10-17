"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import * as ledger from "@/lib/ledger";
import { attempt, type ActionResult } from "@/lib/action-result";
import {
  parseAmount, parseCadence, parseCategory, parseId, parseName, parseOptionalDayOfMonth, parseOptionalId,
  parseOptionalIsoDate, parseOptionalMonthOfYear, parseOptionalText, parseOptionalUrl, parseSubscriptionStatus,
} from "@/lib/validate";
import { isoDate, nextDue } from "@/lib/subscriptions";

function revalidate() {
  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
  revalidatePath("/");
}

function readForm(formData: FormData) {
  const cadence = parseCadence(formData.get("cadence"));
  return {
    name: parseName(formData.get("name"), "Name", 80),
    category: parseCategory(formData.get("category")),
    groupId: parseOptionalId(formData.get("group_id"), "Group"),
    amount: parseAmount(formData.get("amount")),
    cadence,
    day: parseOptionalDayOfMonth(formData.get("day")),
    monthOfYear: cadence === "quarterly" || cadence === "yearly" ? parseOptionalMonthOfYear(formData.get("month_of_year")) : null,
    trialEnds: parseOptionalIsoDate(formData.get("trial_ends")),
    cancelUrl: parseOptionalUrl(formData.get("cancel_url"), "Cancel link"),
    notes: parseOptionalText(formData.get("notes"), "Notes", 500),
  };
}

export async function createSubscription(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const f = readForm(formData);
    const id = randomUUID();
    db.transaction((tx) => {
      ledger.assertGroupExists(tx, ws, f.groupId);
      tx.run(
        `INSERT INTO SUBSCRIPTION (ID, WORKSPACE_ID, NAME, CATEGORY, GROUP_ID, AMOUNT, CADENCE, DAY, MONTH_OF_YEAR, STATUS, STATUS_CHANGED_AT, TRIAL_ENDS, CANCEL_URL, NOTES)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, ?, ?, ?)`,
        [id, ws, f.name, f.category, f.groupId, f.amount, f.cadence, f.day, f.monthOfYear, f.trialEnds, f.cancelUrl, f.notes],
      );
    });
    revalidate();
    return { id };
  });
}

export async function updateSubscription(id: string, formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const sid = parseId(id);
    const f = readForm(formData);
    db.transaction((tx) => {
      ledger.assertGroupExists(tx, ws, f.groupId);
      tx.run(
        `UPDATE SUBSCRIPTION SET NAME=?, CATEGORY=?, GROUP_ID=?, AMOUNT=?, CADENCE=?, DAY=?, MONTH_OF_YEAR=?, TRIAL_ENDS=?, CANCEL_URL=?, NOTES=?
         WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL`,
        [f.name, f.category, f.groupId, f.amount, f.cadence, f.day, f.monthOfYear, f.trialEnds, f.cancelUrl, f.notes, sid, ws],
      );
    });
    revalidate();
    return {};
  });
}

export async function setSubscriptionStatus(id: string, status: string): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const sid = parseId(id);
    const next = parseSubscriptionStatus(status);
    await db.execute(
      "UPDATE SUBSCRIPTION SET STATUS=?, STATUS_CHANGED_AT=CURRENT_TIMESTAMP WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL AND STATUS<>?",
      [next, sid, ws, next],
    );
    revalidate();
    return {};
  });
}

/** Soft-deletes the subscription; its charges stay as ordinary ledger rows. */
export async function deleteSubscription(id: string): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const sid = parseId(id);
    db.transaction((tx) => {
      tx.run("UPDATE SUBSCRIPTION SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [sid, ws]);
      tx.run("UPDATE LEDGER SET SUBSCRIPTION_ID=NULL, IS_RECURRING=0 WHERE SUBSCRIPTION_ID=? AND WORKSPACE_ID=?", [sid, ws]);
    });
    revalidate();
    return {};
  });
}

/**
 * Records the next charge as a ledger row on its due date (or `date`), linked
 * to the subscription. A charge already recorded for that month is not
 * duplicated for monthly/quarterly/yearly items.
 */
export async function markSubscriptionPaid(id: string, date?: string): Promise<ActionResult<{ month: string }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const sid = parseId(id);
    const when = parseOptionalIsoDate(date) ?? undefined;
    const month = db.transaction((tx) => {
      const sub = tx.all<{ NAME: string; CATEGORY: string; GROUP_ID: string | null; AMOUNT: number; CADENCE: "weekly" | "monthly" | "quarterly" | "yearly"; DAY: number | null; MONTH_OF_YEAR: number | null }>(
        "SELECT NAME, CATEGORY, GROUP_ID, CAST(AMOUNT AS REAL) AS AMOUNT, CADENCE, DAY, MONTH_OF_YEAR FROM SUBSCRIPTION WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL",
        [sid, ws],
      )[0];
      if (!sub) throw new Error("Subscription not found");
      const last = tx.all<{ MONTH: string; DAY: number | null }>(
        "SELECT MONTH, DAY FROM LEDGER WHERE SUBSCRIPTION_ID=? AND DELETED_AT IS NULL ORDER BY MONTH DESC, COALESCE(DAY,0) DESC LIMIT 1", [sid],
      )[0] ?? null;
      const today = isoDate(new Date());
      const due = when ?? nextDue({ cadence: sub.CADENCE, day: sub.DAY, monthOfYear: sub.MONTH_OF_YEAR, lastCharge: last ? { month: last.MONTH, day: last.DAY } : null }, today) ?? today;
      const m = due.slice(0, 7);
      if (sub.CADENCE !== "weekly" && last && last.MONTH === m) return m; // already recorded this period
      const rowId = ledger.insertRow(tx, ws, {
        KIND: "expense", CATEGORY: sub.CATEGORY, GROUP_ID: sub.GROUP_ID, NAME: sub.NAME, AMOUNT: sub.AMOUNT,
        NOTES: null, IS_RECURRING: 1, TAGS: null, DAY: Number(due.slice(8, 10)), GOAL_ID: null,
      }, m);
      tx.run("UPDATE LEDGER SET SUBSCRIPTION_ID=? WHERE ID=?", [sid, rowId]);
      return m;
    });
    revalidate();
    return { month };
  });
}
