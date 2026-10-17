"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { attempt, type ActionResult } from "@/lib/action-result";
import { parseAmount, parseId, parseName, parseOptionalDayOfMonth, parseOptionalIsoDate, parseOptionalText, parsePaydayCadence, parseSignedAmount, ValidationError } from "@/lib/validate";

function revalidate() {
  revalidatePath("/cashflow");
  revalidatePath("/dashboard");
}

function readPayday(formData: FormData) {
  const cadence = parsePaydayCadence(formData.get("cadence"));
  const day = cadence === "monthly" ? parseOptionalDayOfMonth(formData.get("day")) ?? 1 : null;
  const start = cadence === "monthly" ? null : parseOptionalIsoDate(formData.get("start_date"));
  if (cadence !== "monthly" && !start) throw new ValidationError("Pick the first (or next) payday date");
  return { label: parseName(formData.get("label"), "Label", 60), amount: parseAmount(formData.get("amount")), cadence, day, start };
}

export async function addPayday(formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const p = readPayday(formData);
    await db.execute("INSERT INTO PAYDAY (ID, WORKSPACE_ID, LABEL, AMOUNT, CADENCE, DAY, START_DATE) VALUES (?, ?, ?, ?, ?, ?, ?)", [randomUUID(), ws, p.label, p.amount, p.cadence, p.day, p.start]);
    revalidate();
    return {};
  });
}

export async function updatePayday(id: string, formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const p = readPayday(formData);
    await db.execute("UPDATE PAYDAY SET LABEL=?, AMOUNT=?, CADENCE=?, DAY=?, START_DATE=? WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [p.label, p.amount, p.cadence, p.day, p.start, parseId(id), ws]);
    revalidate();
    return {};
  });
}

export async function deletePayday(id: string): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    await db.execute("UPDATE PAYDAY SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [parseId(id), ws]);
    revalidate();
    return {};
  });
}

/** "My account had X on this date." The newest checkpoint anchors the projection. */
export async function setBalance(formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const amount = parseSignedAmount(formData.get("amount"), "Balance");
    const date = parseOptionalIsoDate(formData.get("date")) ?? new Date().toISOString().slice(0, 10);
    const note = parseOptionalText(formData.get("note"), "Note", 120);
    await db.execute("INSERT INTO BALANCE_CHECKPOINT (ID, WORKSPACE_ID, DATE, AMOUNT, NOTE) VALUES (?, ?, ?, ?, ?)", [randomUUID(), ws, date, amount, note]);
    revalidate();
    return {};
  });
}
