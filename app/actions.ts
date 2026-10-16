"use server";

import { randomUUID } from "node:crypto";
import db from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { ledgerToCsv, type LedgerCsvRow } from "@/lib/csv";
import { addMonths } from "@/lib/months";
import * as ledger from "@/lib/ledger";
import {
  ValidationError,
  parseAmount,
  parseCategory,
  parseColor,
  parseId,
  parseMonth,
  parseName,
  parseOptionalDate,
  parseOptionalDay,
  parseOptionalId,
  parseOptionalText,
  parsePattern,
  parseTagsText,
  parseYear,
} from "@/lib/validate";
import { revalidatePath } from "next/cache";
import type { ExpenseGroup, Kind } from "@/types/expense";

// Every exported action calls requireAuth() first. The proxy already blocks
// unauthenticated requests, but Server Actions are POSTs to whatever page
// invoked them, so a matcher change must never be the only line of defence.
//
// Mutations driven by a form return ActionResult: validation problems come
// back as { ok: false, error } for the UI to toast; anything else is a bug
// and propagates. Actions that only take ids/months from our own UI throw
// on bad input instead, since that can only mean a programming error.

export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

async function attempt<T extends object>(fn: () => T | Promise<T>): Promise<ActionResult<T>> {
  try {
    const value = await fn();
    return { ok: true, ...value } as ActionResult<T>;
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    throw e;
  }
}

// ============================================
// LEDGER ACTIONS (expenses + income)
// ============================================

function readKind(formData: FormData): Kind {
  return formData.get("kind") === "income" ? "income" : "expense";
}

// A picked date wins over the page's month, so a receipt from last month can
// be entered from this month's view. No date → the page's month, no day.
function readLedgerForm(formData: FormData): { row: ledger.LedgerSource; month: string } {
  const date = parseOptionalDate(formData.get("date"));
  const month = date ? date.month : parseMonth(formData.get("month"));
  const row: ledger.LedgerSource = {
    KIND: readKind(formData),
    CATEGORY: parseCategory(formData.get("category")),
    GROUP_ID: parseOptionalId(formData.get("group_id"), "Group"),
    NAME: parseName(formData.get("name")),
    AMOUNT: parseAmount(formData.get("amount")),
    NOTES: parseOptionalText(formData.get("notes"), "Notes"),
    IS_RECURRING: formData.get("is_recurring") === "1" ? 1 : 0,
    TAGS: parseTagsText(formData.get("tags")),
    DAY: date ? date.day : parseOptionalDay(formData.get("day"), month),
  };
  return { row, month };
}

export async function createExpense(formData: FormData): Promise<ActionResult> {
  await requireAuth();
  return attempt(() => {
    const { row, month } = readLedgerForm(formData);
    db.transaction((tx) => {
      ledger.assertGroupExists(tx, row.GROUP_ID);
      ledger.insertRow(tx, row, month);
    });
    revalidatePath("/");
    return {};
  });
}

export async function updateExpense(id: string, formData: FormData): Promise<ActionResult> {
  await requireAuth();
  return attempt(() => {
    const rowId = parseId(id);
    const { row, month } = readLedgerForm(formData);
    db.transaction((tx) => {
      ledger.assertGroupExists(tx, row.GROUP_ID);
      ledger.auditedUpdate(tx, rowId, "update", () => {
        tx.run(
          "UPDATE LEDGER SET KIND=?, CATEGORY=?, GROUP_ID=?, NAME=?, AMOUNT=?, MONTH=?, DAY=?, NOTES=?, IS_RECURRING=?, TAGS=? WHERE ID=? AND DELETED_AT IS NULL",
          [row.KIND, row.CATEGORY, row.GROUP_ID, row.NAME, row.AMOUNT, month, row.DAY, row.NOTES, row.IS_RECURRING, row.TAGS, rowId],
        );
        ledger.syncTags(tx, rowId, row.TAGS);
      });
    });
    revalidatePath("/");
    return {};
  });
}

export async function updateExpenseAmount(id: string, newAmount: number): Promise<ActionResult> {
  await requireAuth();
  return attempt(async () => {
    const rowId = parseId(id);
    const amount = parseAmount(newAmount);
    db.transaction((tx) => ledger.auditedUpdate(tx, rowId, "update", () => {
      tx.run("UPDATE LEDGER SET AMOUNT=? WHERE ID=? AND DELETED_AT IS NULL", [amount, rowId]);
    }));
    revalidatePath("/");
    return {};
  });
}

export async function deleteExpense(id: string) {
  await requireAuth();
  const rowId = parseId(id);
  db.transaction((tx) => ledger.auditedUpdate(tx, rowId, "delete", () => {
    tx.run("UPDATE LEDGER SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND DELETED_AT IS NULL", [rowId]);
  }));
  revalidatePath("/");
}

export async function undoDeleteExpense(id: string) {
  await requireAuth();
  const rowId = parseId(id);
  db.transaction((tx) => ledger.auditedUpdate(tx, rowId, "restore", () => {
    tx.run("UPDATE LEDGER SET DELETED_AT=NULL WHERE ID=?", [rowId]);
  }));
  revalidatePath("/");
  revalidatePath("/activity");
}

/** Flags every live expense row with this name as recurring. Returns rows changed. */
export async function markRecurringByName(name: string): Promise<number> {
  await requireAuth();
  const target = parseName(name);
  const changed = db.transaction((tx) => {
    const ids = tx.all<{ ID: string }>("SELECT ID FROM LEDGER WHERE NAME = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND IS_RECURRING = 0", [target]);
    for (const { ID } of ids) {
      ledger.auditedUpdate(tx, ID, "update", () => tx.run("UPDATE LEDGER SET IS_RECURRING = 1 WHERE ID = ?", [ID]));
    }
    return ids.length;
  });
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/recurring");
  return changed;
}

export async function duplicateExpense(id: string, month: string) {
  await requireAuth();
  const rowId = parseId(id);
  const target = parseMonth(month);
  db.transaction((tx) => {
    const rows = tx.all<ledger.LedgerSource>(
      `SELECT ${ledger.SOURCE_COLUMNS} FROM LEDGER WHERE ID = ? AND DELETED_AT IS NULL`,
      [rowId],
    );
    if (rows.length > 0) ledger.insertRow(tx, rows[0], target);
  });
  revalidatePath("/");
}

export async function toggleRecurring(id: string) {
  await requireAuth();
  const rowId = parseId(id);
  db.transaction((tx) => ledger.auditedUpdate(tx, rowId, "update", () => {
    tx.run("UPDATE LEDGER SET IS_RECURRING = NOT IS_RECURRING WHERE ID=? AND DELETED_AT IS NULL", [rowId]);
  }));
  revalidatePath("/");
}

// Bulk-copy every ledger row from `sourceMonth` into each of `targetMonths`.
// Re-running is a no-op thanks to NAME+AMOUNT dedup. Returns rows inserted.
export async function backfillMonth(sourceMonth: string, targetMonths: string[]) {
  await requireAuth();
  const source = parseMonth(sourceMonth);
  const targets = targetMonths.map(parseMonth);
  if (targets.length === 0) return 0;
  const inserted = ledger.backfill(source, targets);
  if (inserted > 0) revalidatePath("/");
  return inserted;
}

export async function copyFromPreviousMonth(targetMonth: string) {
  await requireAuth();
  const target = parseMonth(targetMonth);
  const inserted = ledger.copyMonth(addMonths(target, -1), target);
  if (inserted > 0) revalidatePath("/");
  return inserted;
}

export async function copyRecurringToMonth(targetMonth: string) {
  await requireAuth();
  const added = ledger.copyRecurring(parseMonth(targetMonth));
  if (added > 0) revalidatePath("/");
  return added;
}

export async function listMonths(): Promise<string[]> {
  await requireAuth();
  const [rows] = await db.execute("SELECT DISTINCT MONTH FROM LEDGER WHERE DELETED_AT IS NULL ORDER BY MONTH DESC");
  return (rows as Array<{ MONTH: string }>).map((r) => r.MONTH);
}

export async function getRecentNames(category: string, kind: Kind = "expense"): Promise<{ NAME: string; AMOUNT: number }[]> {
  await requireAuth();
  let cat: string;
  try { cat = parseCategory(category); } catch { return []; }
  const [rows] = await db.execute(
    `SELECT NAME, CAST(MAX(AMOUNT) AS REAL) AS AMOUNT FROM LEDGER
     WHERE CATEGORY = ? AND KIND = ? AND DELETED_AT IS NULL
     GROUP BY NAME ORDER BY MAX(CREATED_AT) DESC LIMIT 15`,
    [cat, kind === "income" ? "income" : "expense"],
  );
  return rows as { NAME: string; AMOUNT: number }[];
}

/** Tags in use, most common first — suggestions for the form and the search filter. */
export async function getTags(): Promise<{ TAG: string; N: number }[]> {
  await requireAuth();
  const [rows] = await db.execute(
    `SELECT t.TAG, COUNT(*) AS N FROM LEDGER_TAG t JOIN LEDGER e ON e.ID = t.LEDGER_ID AND e.DELETED_AT IS NULL
     GROUP BY t.TAG ORDER BY N DESC, t.TAG LIMIT 40`,
  );
  return rows as { TAG: string; N: number }[];
}

export async function exportCsv(month?: string, year?: string): Promise<string> {
  await requireAuth();
  let query = `SELECT e.MONTH, e.KIND, e.CATEGORY, e.NAME, CAST(e.AMOUNT AS REAL) AS AMOUNT, e.NOTES, e.IS_RECURRING, e.CREATED_AT, e.DAY, g.NAME AS GROUP_NAME
     FROM LEDGER e LEFT JOIN CATEGORY_GROUP g ON e.GROUP_ID = g.ID AND g.DELETED_AT IS NULL WHERE e.DELETED_AT IS NULL`;
  const params: string[] = [];
  if (month) { query += " AND e.MONTH = ?"; params.push(parseMonth(month)); }
  else if (year) { const y = parseYear(year); query += " AND e.MONTH >= ? AND e.MONTH <= ?"; params.push(`${y}-01`, `${y}-12`); }
  query += " ORDER BY e.MONTH, g.NAME, e.CATEGORY, e.NAME";
  const [rows] = await db.execute(query, params);
  return ledgerToCsv(rows as LedgerCsvRow[]);
}

// ============================================
// BUDGET ACTIONS
// ============================================

export async function setBudget(category: string, amount: number | null): Promise<ActionResult> {
  await requireAuth();
  return attempt(async () => {
    const key = category === "_total" ? "_total" : parseCategory(category);
    const value = amount === null ? null : parseAmount(amount, "Budget");
    const { setBudgetAmount } = await import("@/lib/budgets");
    await setBudgetAmount(key, value);
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    return {};
  });
}

export async function resetAllBudgets() {
  await requireAuth();
  const { resetBudgets } = await import("@/lib/budgets");
  await resetBudgets();
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

// ============================================
// GROUP ACTIONS
// ============================================

export async function getGroups(): Promise<ExpenseGroup[]> {
  await requireAuth();
  const [rows] = await db.execute(
    "SELECT ID, NAME, EMOJI, COLOR, SORT_ORDER FROM CATEGORY_GROUP WHERE DELETED_AT IS NULL ORDER BY SORT_ORDER, NAME",
  );
  return rows as ExpenseGroup[];
}

function readGroupForm(formData: FormData) {
  return {
    name: parseName(formData.get("name"), "Group name", 40),
    emoji: parseOptionalText(formData.get("emoji"), "Icon", 8),
    color: parseColor(formData.get("color")),
  };
}

export async function createGroup(formData: FormData): Promise<ActionResult<{ id: string }>> {
  await requireAuth();
  return attempt(async () => {
    const g = readGroupForm(formData);
    const id = randomUUID();
    await db.execute(
      "INSERT INTO CATEGORY_GROUP (ID, NAME, EMOJI, COLOR, SORT_ORDER) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(SORT_ORDER), -1) + 1 FROM CATEGORY_GROUP WHERE DELETED_AT IS NULL))",
      [id, g.name, g.emoji, g.color],
    );
    revalidatePath("/");
    revalidatePath("/groups");
    return { id };
  });
}

export async function updateGroup(id: string, formData: FormData): Promise<ActionResult> {
  await requireAuth();
  return attempt(async () => {
    const gid = parseId(id);
    const g = readGroupForm(formData);
    await db.execute("UPDATE CATEGORY_GROUP SET NAME=?, EMOJI=?, COLOR=? WHERE ID=? AND DELETED_AT IS NULL", [g.name, g.emoji, g.color, gid]);
    revalidatePath("/");
    revalidatePath("/groups");
    return {};
  });
}

export async function moveGroup(id: string, direction: -1 | 1) {
  await requireAuth();
  ledger.reorderGroup(parseId(id), direction);
  revalidatePath("/");
  revalidatePath("/groups");
}

export async function deleteGroup(id: string) {
  await requireAuth();
  ledger.removeGroup(parseId(id));
  revalidatePath("/");
  revalidatePath("/groups");
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
  const [rows] = await db.execute("SELECT ID, PATTERN, CATEGORY, GROUP_ID, PRIORITY FROM IMPORT_PATTERN ORDER BY PRIORITY DESC, PATTERN");
  return rows as ImportPatternRow[];
}

export async function createImportPattern(pattern: string, category: string, groupId?: string | null): Promise<ActionResult<{ id: string }>> {
  await requireAuth();
  return attempt(async () => {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO IMPORT_PATTERN (ID, PATTERN, CATEGORY, GROUP_ID) VALUES (?, ?, ?, ?)",
      [id, parsePattern(pattern), parseCategory(category), parseOptionalId(groupId, "Group")],
    );
    revalidatePath("/import");
    return { id };
  });
}

export async function deleteImportPattern(id: string) {
  await requireAuth();
  await db.execute("DELETE FROM IMPORT_PATTERN WHERE ID = ?", [parseId(id)]);
  revalidatePath("/import");
}

const MAX_IMPORT_ROWS = 5000;

export async function importTransactions(
  transactions: Array<{ category: string; groupId: string | null; name: string; amount: number; month: string; notes: string | null; kind?: Kind; day?: number | null }>,
): Promise<ActionResult<{ count: number }>> {
  await requireAuth();
  return attempt(() => {
    if (!Array.isArray(transactions)) throw new ValidationError("Nothing to import");
    if (transactions.length > MAX_IMPORT_ROWS) throw new ValidationError(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);
    const rows: ledger.ImportRow[] = transactions.map((t) => ({
      kind: t.kind === "income" ? "income" : "expense",
      category: parseCategory(t.category),
      groupId: parseOptionalId(t.groupId, "Group"),
      name: parseName(t.name),
      amount: parseAmount(t.amount),
      month: parseMonth(t.month),
      notes: parseOptionalText(t.notes, "Notes"),
      day: parseOptionalDay(t.day ?? "", parseMonth(t.month)),
    }));
    const count = ledger.importRows(rows);
    if (count > 0) revalidatePath("/");
    return { count };
  });
}
