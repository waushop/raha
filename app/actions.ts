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

/** Name of the signed-in user, for the sidebar. Null when signed out. */
export async function whoAmI(): Promise<{ name: string; isAdmin: boolean } | null> {
  const { getAuthContext } = await import("@/lib/auth");
  const ctx = await getAuthContext();
  return ctx ? { name: ctx.name, isAdmin: ctx.isAdmin } : null;
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
    GOAL_ID: parseOptionalId(formData.get("goal_id"), "Goal"),
  };
  return { row, month };
}

export async function createExpense(formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const { row, month } = readLedgerForm(formData);
    db.transaction((tx) => {
      ledger.assertGroupExists(tx, ws, row.GROUP_ID);
      ledger.assertGoalExists(tx, ws, row.GOAL_ID);
      ledger.insertRow(tx, ws, row, month);
    });
    revalidatePath("/");
    return {};
  });
}

export async function updateExpense(id: string, formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const rowId = parseId(id);
    const { row, month } = readLedgerForm(formData);
    db.transaction((tx) => {
      ledger.assertGroupExists(tx, ws, row.GROUP_ID);
      ledger.assertGoalExists(tx, ws, row.GOAL_ID);
      ledger.auditedUpdate(tx, rowId, "update", () => {
        tx.run(
          "UPDATE LEDGER SET KIND=?, CATEGORY=?, GROUP_ID=?, NAME=?, AMOUNT=?, MONTH=?, DAY=?, NOTES=?, IS_RECURRING=?, TAGS=?, GOAL_ID=? WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL",
          [row.KIND, row.CATEGORY, row.GROUP_ID, row.NAME, row.AMOUNT, month, row.DAY, row.NOTES, row.IS_RECURRING, row.TAGS, row.GOAL_ID ?? null, rowId, ws],
        );
        ledger.syncTags(tx, rowId, row.TAGS);
      });
    });
    revalidatePath("/");
    return {};
  });
}

export async function updateExpenseAmount(id: string, newAmount: number): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const rowId = parseId(id);
    const amount = parseAmount(newAmount);
    db.transaction((tx) => ledger.auditedUpdate(tx, rowId, "update", () => {
      tx.run("UPDATE LEDGER SET AMOUNT=? WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [amount, rowId, ws]);
    }));
    revalidatePath("/");
    return {};
  });
}

export async function deleteExpense(id: string) {
  const { workspaceId: ws } = await requireAuth();
  const rowId = parseId(id);
  db.transaction((tx) => ledger.auditedUpdate(tx, rowId, "delete", () => {
    tx.run("UPDATE LEDGER SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [rowId, ws]);
  }));
  revalidatePath("/");
}

export async function undoDeleteExpense(id: string) {
  const { workspaceId: ws } = await requireAuth();
  const rowId = parseId(id);
  db.transaction((tx) => ledger.auditedUpdate(tx, rowId, "restore", () => {
    tx.run("UPDATE LEDGER SET DELETED_AT=NULL WHERE ID=? AND WORKSPACE_ID=?", [rowId, ws]);
  }));
  revalidatePath("/");
  revalidatePath("/activity");
}

/** Flags every live expense row with this name as recurring. Returns rows changed. */
export async function markRecurringByName(name: string): Promise<number> {
  const { workspaceId: ws } = await requireAuth();
  const target = parseName(name);
  const changed = db.transaction((tx) => {
    const ids = tx.all<{ ID: string }>("SELECT ID FROM LEDGER WHERE WORKSPACE_ID = ? AND NAME = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND IS_RECURRING = 0", [ws, target]);
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
  const { workspaceId: ws } = await requireAuth();
  const rowId = parseId(id);
  const target = parseMonth(month);
  db.transaction((tx) => {
    const rows = tx.all<ledger.LedgerSource>(
      `SELECT ${ledger.SOURCE_COLUMNS} FROM LEDGER WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL`,
      [rowId, ws],
    );
    if (rows.length > 0) ledger.insertRow(tx, ws, rows[0], target);
  });
  revalidatePath("/");
}

export async function toggleRecurring(id: string) {
  const { workspaceId: ws } = await requireAuth();
  const rowId = parseId(id);
  db.transaction((tx) => ledger.auditedUpdate(tx, rowId, "update", () => {
    tx.run("UPDATE LEDGER SET IS_RECURRING = NOT IS_RECURRING WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [rowId, ws]);
  }));
  revalidatePath("/");
}

// Bulk-copy every ledger row from `sourceMonth` into each of `targetMonths`.
// Re-running is a no-op thanks to NAME+AMOUNT dedup. Returns rows inserted.
export async function backfillMonth(sourceMonth: string, targetMonths: string[]) {
  const { workspaceId: ws } = await requireAuth();
  const source = parseMonth(sourceMonth);
  const targets = targetMonths.map(parseMonth);
  if (targets.length === 0) return 0;
  const inserted = ledger.backfill(ws, source, targets);
  if (inserted > 0) revalidatePath("/");
  return inserted;
}

export async function copyFromPreviousMonth(targetMonth: string) {
  const { workspaceId: ws } = await requireAuth();
  const target = parseMonth(targetMonth);
  const inserted = ledger.copyMonth(ws, addMonths(target, -1), target);
  if (inserted > 0) revalidatePath("/");
  return inserted;
}

export async function copyRecurringToMonth(targetMonth: string) {
  const { workspaceId: ws } = await requireAuth();
  const added = ledger.copyRecurring(ws, parseMonth(targetMonth));
  if (added > 0) revalidatePath("/");
  return added;
}

export async function listMonths(): Promise<string[]> {
  const { workspaceId: ws } = await requireAuth();
  const [rows] = await db.execute("SELECT DISTINCT MONTH FROM LEDGER WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY MONTH DESC", [ws]);
  return (rows as Array<{ MONTH: string }>).map((r) => r.MONTH);
}

export async function getRecentNames(category: string, kind: Kind = "expense"): Promise<{ NAME: string; AMOUNT: number }[]> {
  const { workspaceId: ws } = await requireAuth();
  let cat: string;
  try { cat = parseCategory(category); } catch { return []; }
  const [rows] = await db.execute(
    `SELECT NAME, CAST(MAX(AMOUNT) AS REAL) AS AMOUNT FROM LEDGER
     WHERE WORKSPACE_ID = ? AND CATEGORY = ? AND KIND = ? AND DELETED_AT IS NULL
     GROUP BY NAME ORDER BY MAX(CREATED_AT) DESC LIMIT 15`,
    [ws, cat, kind === "income" ? "income" : "expense"],
  );
  return rows as { NAME: string; AMOUNT: number }[];
}

/** Tags in use, most common first — suggestions for the form and the search filter. */
export async function getTags(): Promise<{ TAG: string; N: number }[]> {
  const { workspaceId: ws } = await requireAuth();
  const [rows] = await db.execute(
    `SELECT t.TAG, COUNT(*) AS N FROM LEDGER_TAG t JOIN LEDGER e ON e.ID = t.LEDGER_ID AND e.DELETED_AT IS NULL AND e.WORKSPACE_ID = ?
     GROUP BY t.TAG ORDER BY N DESC, t.TAG LIMIT 40`,
    [ws],
  );
  return rows as { TAG: string; N: number }[];
}

export async function exportCsv(month?: string, year?: string): Promise<string> {
  const { workspaceId: ws } = await requireAuth();
  let query = `SELECT e.MONTH, e.KIND, e.CATEGORY, e.NAME, CAST(e.AMOUNT AS REAL) AS AMOUNT, e.NOTES, e.IS_RECURRING, e.CREATED_AT, e.DAY, g.NAME AS GROUP_NAME
     FROM LEDGER e LEFT JOIN CATEGORY_GROUP g ON e.GROUP_ID = g.ID AND g.DELETED_AT IS NULL WHERE e.WORKSPACE_ID = ? AND e.DELETED_AT IS NULL`;
  const params: string[] = [ws];
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
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const key = category === "_total" ? "_total" : parseCategory(category);
    const value = amount === null ? null : parseAmount(amount, "Budget");
    const { setBudgetAmount } = await import("@/lib/budgets");
    await setBudgetAmount(ws, key, value);
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    return {};
  });
}

export async function resetAllBudgets() {
  const { workspaceId: ws } = await requireAuth();
  const { resetBudgets } = await import("@/lib/budgets");
  await resetBudgets(ws);
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

// ============================================
// GROUP ACTIONS
// ============================================

export async function getGroups(): Promise<ExpenseGroup[]> {
  const { workspaceId: ws } = await requireAuth();
  const [rows] = await db.execute(
    "SELECT ID, NAME, EMOJI, COLOR, SORT_ORDER FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY SORT_ORDER, NAME",
    [ws],
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
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const g = readGroupForm(formData);
    const id = randomUUID();
    await db.execute(
      "INSERT INTO CATEGORY_GROUP (ID, WORKSPACE_ID, NAME, EMOJI, COLOR, SORT_ORDER) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(SORT_ORDER), -1) + 1 FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL))",
      [id, ws, g.name, g.emoji, g.color, ws],
    );
    revalidatePath("/");
    revalidatePath("/groups");
    return { id };
  });
}

export async function updateGroup(id: string, formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const gid = parseId(id);
    const g = readGroupForm(formData);
    await db.execute("UPDATE CATEGORY_GROUP SET NAME=?, EMOJI=?, COLOR=? WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [g.name, g.emoji, g.color, gid, ws]);
    revalidatePath("/");
    revalidatePath("/groups");
    return {};
  });
}

export async function moveGroup(id: string, direction: -1 | 1) {
  const { workspaceId: ws } = await requireAuth();
  ledger.reorderGroup(ws, parseId(id), direction);
  revalidatePath("/");
  revalidatePath("/groups");
}

export async function deleteGroup(id: string) {
  const { workspaceId: ws } = await requireAuth();
  ledger.removeGroup(ws, parseId(id));
  revalidatePath("/");
  revalidatePath("/groups");
}

// ============================================
// SAVINGS GOALS
// ============================================

function readGoalForm(formData: FormData) {
  const targetMonthRaw = String(formData.get("target_month") ?? "").trim();
  return {
    name: parseName(formData.get("name"), "Goal name", 60),
    emoji: parseOptionalText(formData.get("emoji"), "Icon", 8),
    target: parseAmount(formData.get("target_amount"), "Target"),
    targetMonth: targetMonthRaw ? parseMonth(targetMonthRaw) : null,
    starting: String(formData.get("starting_amount") ?? "").trim() ? parseAmount(formData.get("starting_amount"), "Already saved") : 0,
  };
}

export async function createGoal(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const g = readGoalForm(formData);
    const id = randomUUID();
    await db.execute(
      "INSERT INTO SAVINGS_GOAL (ID, WORKSPACE_ID, NAME, EMOJI, TARGET_AMOUNT, TARGET_MONTH, STARTING_AMOUNT) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, ws, g.name, g.emoji, g.target, g.targetMonth, g.starting],
    );
    revalidatePath("/goals");
    revalidatePath("/dashboard");
    return { id };
  });
}

export async function updateGoal(id: string, formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const gid = parseId(id);
    const g = readGoalForm(formData);
    await db.execute(
      "UPDATE SAVINGS_GOAL SET NAME=?, EMOJI=?, TARGET_AMOUNT=?, TARGET_MONTH=?, STARTING_AMOUNT=? WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL",
      [g.name, g.emoji, g.target, g.targetMonth, g.starting, gid, ws],
    );
    revalidatePath("/goals");
    revalidatePath("/dashboard");
    return {};
  });
}

export async function deleteGoal(id: string) {
  const { workspaceId: ws } = await requireAuth();
  const gid = parseId(id);
  db.transaction((tx) => {
    const hit = tx.run("UPDATE SAVINGS_GOAL SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [gid, ws]);
    // Contributions stay as ordinary ledger rows; they just stop counting.
    if (hit.affectedRows > 0) tx.run("UPDATE LEDGER SET GOAL_ID=NULL WHERE GOAL_ID=? AND DELETED_AT IS NULL", [gid]);
  });
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  revalidatePath("/");
}

export async function getGoalOptions(): Promise<{ ID: string; NAME: string; EMOJI: string | null }[]> {
  const { workspaceId: ws } = await requireAuth();
  const [rows] = await db.execute("SELECT ID, NAME, EMOJI FROM SAVINGS_GOAL WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT", [ws]);
  return rows as { ID: string; NAME: string; EMOJI: string | null }[];
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
  const { workspaceId: ws } = await requireAuth();
  const [rows] = await db.execute("SELECT ID, PATTERN, CATEGORY, GROUP_ID, PRIORITY FROM IMPORT_PATTERN WHERE WORKSPACE_ID = ? ORDER BY PRIORITY DESC, PATTERN", [ws]);
  return rows as ImportPatternRow[];
}

export async function createImportPattern(pattern: string, category: string, groupId?: string | null): Promise<ActionResult<{ id: string }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO IMPORT_PATTERN (ID, WORKSPACE_ID, PATTERN, CATEGORY, GROUP_ID) VALUES (?, ?, ?, ?, ?)",
      [id, ws, parsePattern(pattern), parseCategory(category), parseOptionalId(groupId, "Group")],
    );
    revalidatePath("/import");
    return { id };
  });
}

export async function deleteImportPattern(id: string) {
  const { workspaceId: ws } = await requireAuth();
  await db.execute("DELETE FROM IMPORT_PATTERN WHERE ID = ? AND WORKSPACE_ID = ?", [parseId(id), ws]);
  revalidatePath("/import");
}

const MAX_IMPORT_ROWS = 5000;

export async function importTransactions(
  transactions: Array<{ category: string; groupId: string | null; name: string; amount: number; month: string; notes: string | null; kind?: Kind; day?: number | null }>,
): Promise<ActionResult<{ count: number }>> {
  const { workspaceId: ws } = await requireAuth();
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
    const count = ledger.importRows(ws, rows);
    if (count > 0) revalidatePath("/");
    return { count };
  });
}
