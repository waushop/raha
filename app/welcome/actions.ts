"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { attempt, type ActionResult } from "@/lib/action-result";
import { parseAmount, parseOptionalDayOfMonth, parseSignedAmount, ValidationError } from "@/lib/validate";
import { groupsToCreate, monthlyIncome, onboardedKey, subscriptionsToCreate, type SubscriptionPick } from "@/lib/onboarding";
import { insertSubscription } from "@/lib/subscriptions-db";
import { addLine, addSubscriptionLines, buildFromAverages } from "@/lib/plan-db";
import { currentMonth } from "@/lib/months";
import type { PaydayCadence } from "@/lib/cashflow";

// Each step is idempotent: re-running it (Back, then Next again) updates or
// skips what the previous run created instead of adding duplicates.

const WELCOME_PAYDAY_LABEL = "Salary";

function revalidateAll() {
  revalidatePath("/", "layout");
}

const strings = (formData: FormData, key: string) => formData.getAll(key).map((v) => String(v));

/** Step 1: create the picked template groups (names that already exist are skipped). */
export async function saveWelcomeGroups(formData: FormData): Promise<ActionResult<{ created: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const picked = strings(formData, "group");
    const created = db.transaction((tx) => {
      const existing = tx.all<{ NAME: string }>("SELECT NAME FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]);
      const rows = groupsToCreate(picked, existing.map((r) => r.NAME));
      for (const g of rows) {
        tx.run(
          "INSERT INTO CATEGORY_GROUP (ID, WORKSPACE_ID, NAME, ICON, COLOR, SORT_ORDER) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(SORT_ORDER), -1) + 1 FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL))",
          [randomUUID(), ws, g.name, g.icon, g.color, ws],
        );
      }
      return rows.length;
    });
    revalidateAll();
    return { created };
  });
}

/**
 * Step 2: monthly payday (amount + day) and optionally today's balance.
 * Re-running updates the wizard's "Salary" payday and today's checkpoint.
 */
export async function saveWelcomeIncome(formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const amount = parseAmount(formData.get("amount"), "Income");
    const day = parseOptionalDayOfMonth(formData.get("day"));
    if (day === null) throw new ValidationError("Pick the day your pay arrives");
    const balanceRaw = String(formData.get("balance") ?? "").trim();
    const balance = balanceRaw ? parseSignedAmount(balanceRaw, "Balance") : null;
    const today = new Date().toISOString().slice(0, 10);
    db.transaction((tx) => {
      const existing = tx.all<{ ID: string }>(
        "SELECT ID FROM PAYDAY WHERE WORKSPACE_ID = ? AND LABEL = ? AND CADENCE = 'monthly' AND DELETED_AT IS NULL LIMIT 1", [ws, WELCOME_PAYDAY_LABEL],
      )[0];
      if (existing) {
        tx.run("UPDATE PAYDAY SET AMOUNT = ?, DAY = ? WHERE ID = ? AND WORKSPACE_ID = ?", [amount, day, existing.ID, ws]);
      } else {
        tx.run(
          "INSERT INTO PAYDAY (ID, WORKSPACE_ID, LABEL, AMOUNT, CADENCE, DAY, START_DATE) VALUES (?, ?, ?, ?, 'monthly', ?, NULL)",
          [randomUUID(), ws, WELCOME_PAYDAY_LABEL, amount, day],
        );
      }
      if (balance !== null) {
        const cp = tx.all<{ ID: string }>("SELECT ID FROM BALANCE_CHECKPOINT WHERE WORKSPACE_ID = ? AND DATE = ? ORDER BY CREATED_AT DESC LIMIT 1", [ws, today])[0];
        if (cp) tx.run("UPDATE BALANCE_CHECKPOINT SET AMOUNT = ? WHERE ID = ? AND WORKSPACE_ID = ?", [balance, cp.ID, ws]);
        else tx.run("INSERT INTO BALANCE_CHECKPOINT (ID, WORKSPACE_ID, DATE, AMOUNT, NOTE) VALUES (?, ?, ?, ?, ?)", [randomUUID(), ws, today, balance, "Set during setup"]);
      }
    });
    revalidateAll();
    return {};
  });
}

/**
 * Step 3: picked subscriptions. Form fields: `sub` (preset key, repeated),
 * `amount:<key>` and `day:<key>`. Names that already exist are skipped.
 */
export async function saveWelcomeSubscriptions(formData: FormData): Promise<ActionResult<{ created: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const picks: SubscriptionPick[] = strings(formData, "sub").map((key) => ({
      key,
      amount: parseAmount(formData.get(`amount:${key}`), "Price"),
      day: parseOptionalDayOfMonth(formData.get(`day:${key}`)),
    }));
    const created = db.transaction((tx) => {
      const existing = tx.all<{ NAME: string }>("SELECT NAME FROM SUBSCRIPTION WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]);
      const rows = subscriptionsToCreate(picks, existing.map((r) => r.NAME));
      for (const s of rows) {
        insertSubscription(tx, ws, {
          name: s.name, category: s.category, groupId: null, amount: s.amount, cadence: "monthly",
          day: s.day, monthOfYear: null, trialEnds: null, cancelUrl: null, notes: null,
        });
      }
      return rows.length;
    });
    revalidateAll();
    return { created };
  });
}

/**
 * Step 4: this month's plan from 3-month averages plus subscriptions, and an
 * income line from the paydays when the plan has none. Lines already in the
 * plan are kept (lib/plan-db.ts dedups), so this is safe to repeat.
 */
export async function buildWelcomePlan(): Promise<ActionResult<{ lines: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const month = currentMonth();
    let lines = buildFromAverages(ws, month) + addSubscriptionLines(ws, month);
    const [incomeRows] = await db.execute(
      "SELECT COUNT(*) AS CNT FROM PLAN_LINE WHERE WORKSPACE_ID = ? AND MONTH = ? AND KIND = 'income' AND DELETED_AT IS NULL", [ws, month],
    );
    if (((incomeRows as Array<{ CNT: number }>)[0]?.CNT ?? 0) === 0) {
      const [paydayRows] = await db.execute(
        "SELECT CAST(AMOUNT AS REAL) AS AMOUNT, CADENCE FROM PAYDAY WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws],
      );
      const income = monthlyIncome(paydayRows as Array<{ AMOUNT: number; CADENCE: PaydayCadence }>);
      if (income > 0) {
        lines += addLine(ws, month, { KIND: "income", CATEGORY: "other", GROUP_ID: null, LABEL: "Income", PLANNED: income, SUBSCRIPTION_ID: null });
      }
    }
    revalidateAll();
    return { lines };
  });
}

/** Step 5 (or "skip setup"): remember the workspace is onboarded so the dashboard stops nudging. */
export async function finishOnboarding(): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    await db.execute(
      "INSERT INTO APP_SETTING (NAME, VALUE) VALUES (?, ?) ON CONFLICT(NAME) DO UPDATE SET VALUE = excluded.VALUE",
      [onboardedKey(ws), new Date().toISOString().slice(0, 10)],
    );
    revalidatePath("/dashboard");
    return {};
  });
}
