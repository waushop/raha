"use server";

import { randomUUID } from "crypto";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";
import type { ExpenseGroup } from "@/types/expense";

// ============================================
// LEDGER ACTIONS (expenses + income)
// ============================================

function readKind(formData: FormData): "expense" | "income" {
  const raw = formData.get("kind");
  return raw === "income" ? "income" : "expense";
}

export async function createExpense(formData: FormData) {
  const id = randomUUID();
  const kind = readKind(formData);
  const category = formData.get("category") as string;
  const groupId = (formData.get("group_id") as string) || null;
  const name = formData.get("name") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const month = formData.get("month") as string;
  const notes = (formData.get("notes") as string) || null;
  const isRecurring = formData.get("is_recurring") === "1" ? 1 : 0;
  const tags = (formData.get("tags") as string) || null;

  await db.execute(
    "INSERT INTO LEDGER (ID, KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, NOTES, IS_RECURRING, TAGS) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, kind, category, groupId, name, amount, month, notes, isRecurring, tags]
  );
  revalidatePath("/");
}

export async function updateExpense(id: string, formData: FormData) {
  const kind = readKind(formData);
  const category = formData.get("category") as string;
  const groupId = (formData.get("group_id") as string) || null;
  const name = formData.get("name") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const notes = (formData.get("notes") as string) || null;
  const isRecurring = formData.get("is_recurring") === "1" ? 1 : 0;
  const tags = (formData.get("tags") as string) || null;

  await db.execute(
    "UPDATE LEDGER SET KIND=?, CATEGORY=?, GROUP_ID=?, NAME=?, AMOUNT=?, NOTES=?, IS_RECURRING=?, TAGS=? WHERE ID=? AND DELETED_AT IS NULL",
    [kind, category, groupId, name, amount, notes, isRecurring, tags, id]
  );
  revalidatePath("/");
}

export async function deleteExpense(id: string) {
  await db.execute("UPDATE LEDGER SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND DELETED_AT IS NULL", [id]);
  revalidatePath("/");
}

export async function undoDeleteExpense(id: string) {
  await db.execute("UPDATE LEDGER SET DELETED_AT=NULL WHERE ID=?", [id]);
  revalidatePath("/");
}

// Bulk-copy every expense from `sourceMonth` into each of `targetMonths`.
// Skips targets where an expense with the same NAME+AMOUNT already exists,
// so re-running is a no-op. Returns total rows inserted.
export async function backfillMonth(sourceMonth: string, targetMonths: string[]) {
  if (!sourceMonth || targetMonths.length === 0) return 0;

  const [rows] = await db.execute(
    `SELECT CATEGORY, GROUP_ID, NAME, AMOUNT, NOTES, IS_RECURRING, TAGS
     FROM LEDGER WHERE MONTH = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT`,
    [sourceMonth],
  );
  const source = rows as Array<{
    CATEGORY: string;
    GROUP_ID: string | null;
    NAME: string;
    AMOUNT: number;
    NOTES: string | null;
    IS_RECURRING: number;
    TAGS: string | null;
  }>;
  if (source.length === 0) return 0;

  let inserted = 0;
  for (const month of targetMonths) {
    if (month === sourceMonth) continue;
    for (const row of source) {
      const [existing] = await db.execute(
        "SELECT 1 FROM LEDGER WHERE NAME = ? AND AMOUNT = ? AND MONTH = ? AND DELETED_AT IS NULL LIMIT 1",
        [row.NAME, row.AMOUNT, month],
      );
      if ((existing as Array<unknown>).length > 0) continue;
      await db.execute(
        `INSERT INTO LEDGER (ID, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, NOTES, IS_RECURRING, TAGS)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          row.CATEGORY,
          row.GROUP_ID,
          row.NAME,
          row.AMOUNT,
          month,
          row.NOTES,
          row.IS_RECURRING,
          row.TAGS,
        ],
      );
      inserted++;
    }
  }
  revalidatePath("/");
  return inserted;
}

export async function setBudget(category: string, amount: number | null) {
  const { setBudgetAmount } = await import("@/lib/budgets");
  await setBudgetAmount(category, amount);
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

export async function resetAllBudgets() {
  const { resetBudgets } = await import("@/lib/budgets");
  await resetBudgets();
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

export async function listMonths(): Promise<string[]> {
  const [rows] = await db.execute(
    "SELECT DISTINCT MONTH FROM LEDGER WHERE DELETED_AT IS NULL ORDER BY MONTH DESC",
  );
  return (rows as Array<{ MONTH: string }>).map((r) => r.MONTH);
}

export async function copyFromPreviousMonth(targetMonth: string) {
  const [y, m] = targetMonth.split("-").map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  const [rows] = await db.execute(
    "SELECT CATEGORY, GROUP_ID, NAME, AMOUNT, IS_RECURRING FROM LEDGER WHERE MONTH = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT",
    [prevMonth]
  ) as [Array<{ CATEGORY: string; GROUP_ID: string | null; NAME: string; AMOUNT: number; IS_RECURRING: number }>, unknown];

  for (const row of rows) {
    await db.execute(
      "INSERT INTO LEDGER (ID, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, IS_RECURRING) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), row.CATEGORY, row.GROUP_ID, row.NAME, row.AMOUNT, targetMonth, row.IS_RECURRING]
    );
  }
  revalidatePath("/");
  return rows.length;
}

export async function copyRecurringToMonth(targetMonth: string) {
  const [rows] = await db.execute(
    `SELECT CATEGORY, GROUP_ID, NAME, AMOUNT FROM LEDGER
     WHERE IS_RECURRING = 1 AND DELETED_AT IS NULL AND MONTH < ?
       AND MONTH = (SELECT MAX(MONTH) FROM LEDGER WHERE IS_RECURRING = 1 AND DELETED_AT IS NULL AND MONTH < ?)
     ORDER BY CREATED_AT`,
    [targetMonth, targetMonth]
  ) as [Array<{ CATEGORY: string; GROUP_ID: string | null; NAME: string; AMOUNT: number }>, unknown];

  const [existing] = await db.execute(
    "SELECT NAME FROM LEDGER WHERE MONTH = ? AND DELETED_AT IS NULL",
    [targetMonth]
  ) as [Array<{ NAME: string }>, unknown];
  const existingNames = new Set(existing.map(r => r.NAME));

  let added = 0;
  for (const row of rows) {
    if (existingNames.has(row.NAME)) continue;
    await db.execute(
      "INSERT INTO LEDGER (ID, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, IS_RECURRING) VALUES (?, ?, ?, ?, ?, ?, 1)",
      [randomUUID(), row.CATEGORY, row.GROUP_ID, row.NAME, row.AMOUNT, targetMonth]
    );
    added++;
  }
  revalidatePath("/");
  return added;
}

export async function getRecentNames(category: string): Promise<{ NAME: string; AMOUNT: number }[]> {
  const [rows] = await db.execute(
    `SELECT NAME, CAST(MAX(AMOUNT) AS REAL) AS AMOUNT FROM LEDGER
     WHERE CATEGORY = ? AND DELETED_AT IS NULL
     GROUP BY NAME ORDER BY MAX(CREATED_AT) DESC LIMIT 15`,
    [category]
  );
  return rows as { NAME: string; AMOUNT: number }[];
}

export async function duplicateExpense(id: string, month: string) {
  const [rows] = await db.execute(
    "SELECT CATEGORY, GROUP_ID, NAME, AMOUNT, IS_RECURRING FROM LEDGER WHERE ID = ?",
    [id]
  ) as [Array<{ CATEGORY: string; GROUP_ID: string | null; NAME: string; AMOUNT: number; IS_RECURRING: number }>, unknown];
  if (rows.length === 0) return;
  const row = rows[0];
  await db.execute(
    "INSERT INTO LEDGER (ID, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, IS_RECURRING) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), row.CATEGORY, row.GROUP_ID, row.NAME, row.AMOUNT, month, row.IS_RECURRING]
  );
  revalidatePath("/");
}

export async function toggleRecurring(id: string) {
  await db.execute("UPDATE LEDGER SET IS_RECURRING = NOT IS_RECURRING WHERE ID=? AND DELETED_AT IS NULL", [id]);
  revalidatePath("/");
}

export async function exportCsv(month?: string, year?: string): Promise<string> {
  let query = `SELECT e.MONTH, e.CATEGORY, e.NAME, CAST(e.AMOUNT AS REAL) AS AMOUNT, e.NOTES, e.IS_RECURRING, e.CREATED_AT, g.NAME AS GROUP_NAME
     FROM LEDGER e LEFT JOIN CATEGORY_GROUP g ON e.GROUP_ID = g.ID WHERE e.DELETED_AT IS NULL`;
  const params: string[] = [];
  if (month) { query += " AND e.MONTH = ?"; params.push(month); }
  else if (year) { query += " AND e.MONTH >= ? AND e.MONTH <= ?"; params.push(`${year}-01`, `${year}-12`); }
  query += " ORDER BY e.MONTH, g.NAME, e.CATEGORY, e.NAME";

  const [rows] = await db.execute(query, params);
  const data = rows as Array<{ MONTH: string; CATEGORY: string; NAME: string; AMOUNT: number; NOTES: string | null; IS_RECURRING: number; CREATED_AT: string; GROUP_NAME: string | null }>;
  const header = "Kuu,Grupp,Kategooria,Nimetus,Summa,Märkmed,Korduv,Lisatud";
  const lines = data.map(r =>
    `${r.MONTH},"${r.GROUP_NAME ?? ""}",${r.CATEGORY},"${r.NAME}",${r.AMOUNT},"${r.NOTES ?? ""}",${r.IS_RECURRING ? "Jah" : "Ei"},${r.CREATED_AT}`
  );
  return [header, ...lines].join("\n");
}

// ============================================
// GROUP ACTIONS
// ============================================

export async function getGroups(): Promise<ExpenseGroup[]> {
  const [rows] = await db.execute(
    "SELECT ID, NAME, EMOJI, COLOR, SORT_ORDER FROM CATEGORY_GROUP WHERE DELETED_AT IS NULL ORDER BY SORT_ORDER, NAME"
  );
  return rows as ExpenseGroup[];
}

export async function createGroup(formData: FormData) {
  const id = randomUUID();
  const name = formData.get("name") as string;
  const emoji = (formData.get("emoji") as string) || null;
  const color = (formData.get("color") as string) || "blue";

  await db.execute(
    "INSERT INTO CATEGORY_GROUP (ID, NAME, EMOJI, COLOR) VALUES (?, ?, ?, ?)",
    [id, name, emoji, color]
  );
  revalidatePath("/");
  return id;
}

export async function updateGroup(id: string, formData: FormData) {
  const name = formData.get("name") as string;
  const emoji = (formData.get("emoji") as string) || null;
  const color = (formData.get("color") as string) || "blue";

  await db.execute(
    "UPDATE CATEGORY_GROUP SET NAME=?, EMOJI=?, COLOR=? WHERE ID=? AND DELETED_AT IS NULL",
    [name, emoji, color, id]
  );
  revalidatePath("/");
}

export async function bulkUpdateAmount(name: string, category: string, oldAmount: number, newAmount: number, fromMonth?: string) {
  const params: (string | number)[] = [newAmount, name, category, oldAmount];
  let query = "UPDATE LEDGER SET AMOUNT=? WHERE NAME=? AND CATEGORY=? AND AMOUNT=? AND DELETED_AT IS NULL";
  if (fromMonth) {
    query += " AND MONTH >= ?";
    params.push(fromMonth);
  }
  const [result] = await db.execute(query, params) as [{ affectedRows: number }, unknown];
  revalidatePath("/");
  return (result as { affectedRows: number }).affectedRows ?? 0;
}

export async function updateExpenseAmount(id: string, newAmount: number) {
  await db.execute(
    "UPDATE LEDGER SET AMOUNT=? WHERE ID=? AND DELETED_AT IS NULL",
    [newAmount, id]
  );
  revalidatePath("/");
}

export async function deleteGroup(id: string) {
  await db.execute("UPDATE CATEGORY_GROUP SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=?", [id]);
  // Unlink expenses from this group
  await db.execute("UPDATE LEDGER SET GROUP_ID=NULL WHERE GROUP_ID=?", [id]);
  revalidatePath("/");
}

// ============================================
// IMPORT PATTERN ACTIONS
// ============================================

export type ImportPatternRow = {
  ID: string;
  PATTERN: string;
  CATEGORY: string;
  GROUP_ID: string | null;
  PRIORITY: number;
};

export async function getImportPatterns(): Promise<ImportPatternRow[]> {
  const [rows] = await db.execute(
    "SELECT ID, PATTERN, CATEGORY, GROUP_ID, PRIORITY FROM IMPORT_PATTERN ORDER BY PRIORITY DESC, PATTERN"
  );
  return rows as ImportPatternRow[];
}

export async function createImportPattern(pattern: string, category: string, groupId?: string | null) {
  const id = randomUUID();
  await db.execute(
    "INSERT INTO IMPORT_PATTERN (ID, PATTERN, CATEGORY, GROUP_ID) VALUES (?, ?, ?, ?)",
    [id, pattern, category, groupId || null]
  );
  return id;
}

export async function deleteImportPattern(id: string) {
  await db.execute("DELETE FROM IMPORT_PATTERN WHERE ID = ?", [id]);
}

export async function importTransactions(
  transactions: Array<{ category: string; groupId: string | null; name: string; amount: number; month: string; notes: string | null }>
) {
  let imported = 0;
  for (const tx of transactions) {
    // Dedup: skip if same name + amount + month already exists
    const [existing] = await db.execute(
      "SELECT ID FROM LEDGER WHERE NAME = ? AND AMOUNT = ? AND MONTH = ? AND DELETED_AT IS NULL LIMIT 1",
      [tx.name, tx.amount, tx.month]
    );
    if ((existing as Array<unknown>).length > 0) continue;

    await db.execute(
      "INSERT INTO LEDGER (ID, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, NOTES) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), tx.category, tx.groupId, tx.name, tx.amount, tx.month, tx.notes]
    );
    imported++;
  }
  revalidatePath("/");
  return imported;
}
