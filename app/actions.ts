"use server";

import { randomUUID } from "crypto";
import db from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { ledgerToCsv, type LedgerCsvRow } from "@/lib/csv";
import { revalidatePath } from "next/cache";
import type { ExpenseGroup, Kind } from "@/types/expense";

// Every exported action calls requireAuth() first. The proxy already blocks
// unauthenticated requests, but Server Actions are POSTs to whatever page
// invoked them, so a matcher change must never be the only line of defence.

// ============================================
// LEDGER ACTIONS (expenses + income)
// ============================================

function readKind(formData: FormData): Kind {
  const raw = formData.get("kind");
  return raw === "income" ? "income" : "expense";
}

type LedgerSource = {
  KIND: Kind;
  CATEGORY: string;
  GROUP_ID: string | null;
  NAME: string;
  AMOUNT: number;
  NOTES: string | null;
  IS_RECURRING: number;
  TAGS: string | null;
};

const INSERT_LEDGER = `INSERT INTO LEDGER (ID, KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, NOTES, IS_RECURRING, TAGS)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertParams(row: LedgerSource, month: string): unknown[] {
  return [randomUUID(), row.KIND, row.CATEGORY, row.GROUP_ID, row.NAME, row.AMOUNT, month, row.NOTES, row.IS_RECURRING, row.TAGS];
}

export async function createExpense(formData: FormData) {
  await requireAuth();
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

  await db.execute(INSERT_LEDGER, [id, kind, category, groupId, name, amount, month, notes, isRecurring, tags]);
  revalidatePath("/");
}

export async function updateExpense(id: string, formData: FormData) {
  await requireAuth();
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
  await requireAuth();
  await db.execute("UPDATE LEDGER SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND DELETED_AT IS NULL", [id]);
  revalidatePath("/");
}

export async function undoDeleteExpense(id: string) {
  await requireAuth();
  await db.execute("UPDATE LEDGER SET DELETED_AT=NULL WHERE ID=?", [id]);
  revalidatePath("/");
}

// Bulk-copy every ledger row from `sourceMonth` into each of `targetMonths`.
// Skips targets where a row with the same NAME+AMOUNT already exists, so
// re-running is a no-op. Atomic: either every target is filled or none.
// Returns total rows inserted.
export async function backfillMonth(sourceMonth: string, targetMonths: string[]) {
  await requireAuth();
  if (!sourceMonth || targetMonths.length === 0) return 0;

  const inserted = db.transaction((tx) => {
    const source = tx.all<LedgerSource>(
      `SELECT KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, NOTES, IS_RECURRING, TAGS
       FROM LEDGER WHERE MONTH = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT`,
      [sourceMonth],
    );
    if (source.length === 0) return 0;

    let count = 0;
    for (const month of targetMonths) {
      if (month === sourceMonth) continue;
      for (const row of source) {
        const existing = tx.all(
          "SELECT 1 FROM LEDGER WHERE NAME = ? AND AMOUNT = ? AND MONTH = ? AND DELETED_AT IS NULL LIMIT 1",
          [row.NAME, row.AMOUNT, month],
        );
        if (existing.length > 0) continue;
        tx.run(INSERT_LEDGER, insertParams(row, month));
        count++;
      }
    }
    return count;
  });

  if (inserted > 0) revalidatePath("/");
  return inserted;
}

export async function setBudget(category: string, amount: number | null) {
  await requireAuth();
  const { setBudgetAmount } = await import("@/lib/budgets");
  await setBudgetAmount(category, amount);
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

export async function resetAllBudgets() {
  await requireAuth();
  const { resetBudgets } = await import("@/lib/budgets");
  await resetBudgets();
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

export async function listMonths(): Promise<string[]> {
  await requireAuth();
  const [rows] = await db.execute(
    "SELECT DISTINCT MONTH FROM LEDGER WHERE DELETED_AT IS NULL ORDER BY MONTH DESC",
  );
  return (rows as Array<{ MONTH: string }>).map((r) => r.MONTH);
}

// Copies last month's rows (both kinds) into `targetMonth`, skipping rows
// whose NAME+AMOUNT already exist there so a double-click can't duplicate.
export async function copyFromPreviousMonth(targetMonth: string) {
  await requireAuth();
  const [y, m] = targetMonth.split("-").map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  const inserted = db.transaction((tx) => {
    const rows = tx.all<LedgerSource>(
      `SELECT KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, NOTES, IS_RECURRING, TAGS
       FROM LEDGER WHERE MONTH = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT`,
      [prevMonth],
    );
    const existing = new Set(
      tx.all<{ NAME: string; AMOUNT: number }>(
        "SELECT NAME, AMOUNT FROM LEDGER WHERE MONTH = ? AND DELETED_AT IS NULL",
        [targetMonth],
      ).map((r) => `${r.NAME}\u0000${r.AMOUNT}`),
    );

    let count = 0;
    for (const row of rows) {
      if (existing.has(`${row.NAME}\u0000${row.AMOUNT}`)) continue;
      tx.run(INSERT_LEDGER, insertParams(row, targetMonth));
      count++;
    }
    return count;
  });

  if (inserted > 0) revalidatePath("/");
  return inserted;
}

// Adds every recurring row from the most recent earlier month that isn't
// already present (by NAME) in `targetMonth`. Recurring income (salary) is
// copied too; KIND is preserved.
export async function copyRecurringToMonth(targetMonth: string) {
  await requireAuth();

  const added = db.transaction((tx) => {
    const rows = tx.all<LedgerSource>(
      `SELECT KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, NOTES, IS_RECURRING, TAGS FROM LEDGER
       WHERE IS_RECURRING = 1 AND DELETED_AT IS NULL AND MONTH < ?
         AND MONTH = (SELECT MAX(MONTH) FROM LEDGER WHERE IS_RECURRING = 1 AND DELETED_AT IS NULL AND MONTH < ?)
       ORDER BY CREATED_AT`,
      [targetMonth, targetMonth],
    );
    const existingNames = new Set(
      tx.all<{ NAME: string }>("SELECT NAME FROM LEDGER WHERE MONTH = ? AND DELETED_AT IS NULL", [targetMonth]).map((r) => r.NAME),
    );

    let count = 0;
    for (const row of rows) {
      if (existingNames.has(row.NAME)) continue;
      tx.run(INSERT_LEDGER, insertParams({ ...row, IS_RECURRING: 1 }, targetMonth));
      count++;
    }
    return count;
  });

  if (added > 0) revalidatePath("/");
  return added;
}

export async function getRecentNames(category: string): Promise<{ NAME: string; AMOUNT: number }[]> {
  await requireAuth();
  const [rows] = await db.execute(
    `SELECT NAME, CAST(MAX(AMOUNT) AS REAL) AS AMOUNT FROM LEDGER
     WHERE CATEGORY = ? AND DELETED_AT IS NULL
     GROUP BY NAME ORDER BY MAX(CREATED_AT) DESC LIMIT 15`,
    [category]
  );
  return rows as { NAME: string; AMOUNT: number }[];
}

export async function duplicateExpense(id: string, month: string) {
  await requireAuth();
  const [rows] = await db.execute(
    "SELECT KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, NOTES, IS_RECURRING, TAGS FROM LEDGER WHERE ID = ? AND DELETED_AT IS NULL",
    [id]
  ) as [LedgerSource[], unknown];
  if (rows.length === 0) return;
  await db.execute(INSERT_LEDGER, insertParams(rows[0], month));
  revalidatePath("/");
}

export async function toggleRecurring(id: string) {
  await requireAuth();
  await db.execute("UPDATE LEDGER SET IS_RECURRING = NOT IS_RECURRING WHERE ID=? AND DELETED_AT IS NULL", [id]);
  revalidatePath("/");
}

export async function exportCsv(month?: string, year?: string): Promise<string> {
  await requireAuth();
  let query = `SELECT e.MONTH, e.KIND, e.CATEGORY, e.NAME, CAST(e.AMOUNT AS REAL) AS AMOUNT, e.NOTES, e.IS_RECURRING, e.CREATED_AT, g.NAME AS GROUP_NAME
     FROM LEDGER e LEFT JOIN CATEGORY_GROUP g ON e.GROUP_ID = g.ID WHERE e.DELETED_AT IS NULL`;
  const params: string[] = [];
  if (month) { query += " AND e.MONTH = ?"; params.push(month); }
  else if (year) { query += " AND e.MONTH >= ? AND e.MONTH <= ?"; params.push(`${year}-01`, `${year}-12`); }
  query += " ORDER BY e.MONTH, g.NAME, e.CATEGORY, e.NAME";

  const [rows] = await db.execute(query, params);
  return ledgerToCsv(rows as LedgerCsvRow[]);
}

// ============================================
// GROUP ACTIONS
// ============================================

export async function getGroups(): Promise<ExpenseGroup[]> {
  await requireAuth();
  const [rows] = await db.execute(
    "SELECT ID, NAME, EMOJI, COLOR, SORT_ORDER FROM CATEGORY_GROUP WHERE DELETED_AT IS NULL ORDER BY SORT_ORDER, NAME"
  );
  return rows as ExpenseGroup[];
}

export async function createGroup(formData: FormData) {
  await requireAuth();
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
  await requireAuth();
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
  await requireAuth();
  const params: (string | number)[] = [newAmount, name, category, oldAmount];
  let query = "UPDATE LEDGER SET AMOUNT=? WHERE NAME=? AND CATEGORY=? AND AMOUNT=? AND DELETED_AT IS NULL";
  if (fromMonth) {
    query += " AND MONTH >= ?";
    params.push(fromMonth);
  }
  const [result] = await db.execute(query, params) as [{ affectedRows: number }, unknown];
  revalidatePath("/");
  return result.affectedRows ?? 0;
}

export async function updateExpenseAmount(id: string, newAmount: number) {
  await requireAuth();
  await db.execute(
    "UPDATE LEDGER SET AMOUNT=? WHERE ID=? AND DELETED_AT IS NULL",
    [newAmount, id]
  );
  revalidatePath("/");
}

export async function deleteGroup(id: string) {
  await requireAuth();
  db.transaction((tx) => {
    tx.run("UPDATE CATEGORY_GROUP SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=?", [id]);
    // Unlink ledger rows from this group
    tx.run("UPDATE LEDGER SET GROUP_ID=NULL WHERE GROUP_ID=?", [id]);
  });
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
  await requireAuth();
  const [rows] = await db.execute(
    "SELECT ID, PATTERN, CATEGORY, GROUP_ID, PRIORITY FROM IMPORT_PATTERN ORDER BY PRIORITY DESC, PATTERN"
  );
  return rows as ImportPatternRow[];
}

export async function createImportPattern(pattern: string, category: string, groupId?: string | null) {
  await requireAuth();
  const id = randomUUID();
  await db.execute(
    "INSERT INTO IMPORT_PATTERN (ID, PATTERN, CATEGORY, GROUP_ID) VALUES (?, ?, ?, ?)",
    [id, pattern, category, groupId || null]
  );
  return id;
}

export async function deleteImportPattern(id: string) {
  await requireAuth();
  await db.execute("DELETE FROM IMPORT_PATTERN WHERE ID = ?", [id]);
}

export async function importTransactions(
  transactions: Array<{ category: string; groupId: string | null; name: string; amount: number; month: string; notes: string | null; kind?: Kind }>
) {
  await requireAuth();

  const imported = db.transaction((tx) => {
    let count = 0;
    for (const t of transactions) {
      // Dedup: skip if same name + amount + month already exists
      const existing = tx.all(
        "SELECT 1 FROM LEDGER WHERE NAME = ? AND AMOUNT = ? AND MONTH = ? AND DELETED_AT IS NULL LIMIT 1",
        [t.name, t.amount, t.month]
      );
      if (existing.length > 0) continue;

      tx.run(INSERT_LEDGER, [
        randomUUID(), t.kind === "income" ? "income" : "expense", t.category, t.groupId, t.name, t.amount, t.month, t.notes, 0, null,
      ]);
      count++;
    }
    return count;
  });

  if (imported > 0) revalidatePath("/");
  return imported;
}
