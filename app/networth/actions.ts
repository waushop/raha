"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { attempt, type ActionResult } from "@/lib/action-result";
import { parseAccountType, parseId, parseMonth, parseName, parseSignedAmount, ValidationError } from "@/lib/validate";

function revalidate() {
  revalidatePath("/networth");
  revalidatePath("/dashboard");
}

export async function addAccount(formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const name = parseName(formData.get("name"), "Name", 60);
    const type = parseAccountType(formData.get("type"));
    const [rows] = await db.execute("SELECT COALESCE(MAX(SORT_ORDER), -1) + 1 AS NEXT FROM ACCOUNT WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]);
    const next = (rows as { NEXT: number }[])[0]?.NEXT ?? 0;
    const id = randomUUID();
    await db.execute("INSERT INTO ACCOUNT (ID, WORKSPACE_ID, NAME, TYPE, SORT_ORDER) VALUES (?, ?, ?, ?, ?)", [id, ws, name, type, next]);
    const raw = formData.get("balance");
    if (typeof raw === "string" && raw.trim() !== "") {
      const balance = parseSignedAmount(raw, "Balance");
      const month = parseMonth(formData.get("month"));
      await upsertSnapshot(ws, id, month, balance);
    }
    revalidate();
    return {};
  });
}

/** Rename and/or change the type of an account. */
export async function updateAccount(id: string, formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const name = parseName(formData.get("name"), "Name", 60);
    const type = parseAccountType(formData.get("type"));
    await db.execute("UPDATE ACCOUNT SET NAME=?, TYPE=? WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [name, type, parseId(id), ws]);
    revalidate();
    return {};
  });
}

export async function deleteAccount(id: string): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    await db.execute("UPDATE ACCOUNT SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [parseId(id), ws]);
    revalidate();
    return {};
  });
}

async function upsertSnapshot(ws: string, accountId: string, month: string, balance: number): Promise<void> {
  const [owned] = await db.execute("SELECT 1 FROM ACCOUNT WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [accountId, ws]);
  if ((owned as unknown[]).length === 0) throw new ValidationError("Unknown account");
  await db.execute(
    `INSERT INTO ACCOUNT_SNAPSHOT (ID, WORKSPACE_ID, ACCOUNT_ID, MONTH, BALANCE) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ACCOUNT_ID, MONTH) DO UPDATE SET BALANCE = excluded.BALANCE`,
    [randomUUID(), ws, accountId, month, balance],
  );
}

/** One account's balance for a month (insert or overwrite). */
export async function setBalance(accountId: string, month: string, balance: number): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    await upsertSnapshot(ws, parseId(accountId), parseMonth(month), parseSignedAmount(balance, "Balance"));
    revalidate();
    return {};
  });
}

/** The "Update balances" form: one input per account, blanks are left alone. */
export async function snapshotAll(month: string, balances: Array<{ accountId: string; balance: string }>): Promise<ActionResult<{ saved: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const m = parseMonth(month);
    const entries = balances
      .filter((b) => b.balance.trim() !== "")
      .map((b) => ({ accountId: parseId(b.accountId), balance: parseSignedAmount(b.balance, "Balance") }));
    if (entries.length === 0) throw new ValidationError("Enter at least one balance");
    const ids = new Set(
      ((await db.execute("SELECT ID FROM ACCOUNT WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]))[0] as { ID: string }[]).map((r) => r.ID),
    );
    if (entries.some((e) => !ids.has(e.accountId))) throw new ValidationError("Unknown account");
    db.transaction((tx) => {
      for (const e of entries) {
        tx.run(
          `INSERT INTO ACCOUNT_SNAPSHOT (ID, WORKSPACE_ID, ACCOUNT_ID, MONTH, BALANCE) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(ACCOUNT_ID, MONTH) DO UPDATE SET BALANCE = excluded.BALANCE`,
          [randomUUID(), ws, e.accountId, m, e.balance],
        );
      }
    });
    revalidate();
    return { saved: entries.length };
  });
}
