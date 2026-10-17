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
  parseIcon, parseColor,
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

import { attempt, type ActionResult } from "@/lib/action-result";
import { applyRules, type Rule } from "@/lib/rules";

/** Name of the signed-in user, for the sidebar. Null when signed out. */
export async function whoAmI(): Promise<{ name: string; isAdmin: boolean; workspaceName: string; workspaceKind: "personal" | "shared" } | null> {
  const { getAuthContext } = await import("@/lib/auth");
  const ctx = await getAuthContext();
  return ctx ? { name: ctx.name, isAdmin: ctx.isAdmin, workspaceName: ctx.workspaceName, workspaceKind: ctx.workspaceKind } : null;
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
    PAID_BY: parseOptionalId(formData.get("paid_by"), "Paid by"),
  };
  return { row, month };
}

export async function createExpense(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { workspaceId: ws, workspaceKind, userId } = await requireAuth();
  return attempt(() => {
    const { row, month } = readLedgerForm(formData);
    // In a household every expense has a payer; default to whoever is adding it.
    if (workspaceKind === "shared" && row.KIND === "expense" && !row.PAID_BY) row.PAID_BY = userId;
    if (workspaceKind !== "shared") row.PAID_BY = null;
    const id = db.transaction((tx) => {
      ledger.assertMember(tx, ws, row.PAID_BY);
      ledger.assertGroupExists(tx, ws, row.GROUP_ID);
      ledger.assertGoalExists(tx, ws, row.GOAL_ID);
      // Rules only normalise the name and add tags on manual entry; the
      // category the user picked stands.
      if (row.KIND === "expense") {
        const hit = applyRules(ledger.loadRules(tx, ws), { text: row.NAME, amount: row.AMOUNT });
        if (hit?.name) row.NAME = hit.name;
        if (hit?.tags) row.TAGS = ledger.mergeTags(row.TAGS, hit.tags);
      }
      return ledger.insertRow(tx, ws, row, month);
    });
    revalidatePath("/");
    return { id };
  });
}

export async function updateExpense(id: string, formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws, workspaceKind } = await requireAuth();
  return attempt(() => {
    const rowId = parseId(id);
    const { row, month } = readLedgerForm(formData);
    if (workspaceKind !== "shared") row.PAID_BY = null;
    db.transaction((tx) => {
      ledger.assertMember(tx, ws, row.PAID_BY);
      ledger.assertGroupExists(tx, ws, row.GROUP_ID);
      ledger.assertGoalExists(tx, ws, row.GOAL_ID);
      ledger.auditedUpdate(tx, rowId, "update", () => {
        tx.run(
          "UPDATE LEDGER SET KIND=?, CATEGORY=?, GROUP_ID=?, NAME=?, AMOUNT=?, MONTH=?, DAY=?, NOTES=?, IS_RECURRING=?, TAGS=?, GOAL_ID=?, PAID_BY=COALESCE(?, PAID_BY) WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL",
          [row.KIND, row.CATEGORY, row.GROUP_ID, row.NAME, row.AMOUNT, month, row.DAY, row.NOTES, row.IS_RECURRING, row.TAGS, row.GOAL_ID ?? null, workspaceKind === "shared" ? row.PAID_BY : null, rowId, ws],
        );
        ledger.syncTags(tx, rowId, row.TAGS);
      });
      ledger.linkSubscription(tx, ws, rowId);
    });
    revalidatePath("/");
    revalidatePath("/subscriptions");
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
      ledger.linkSubscription(tx, ws, ID);
    }
    return ids.length;
  });
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/subscriptions");
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
  db.transaction((tx) => {
    ledger.auditedUpdate(tx, rowId, "update", () => {
      tx.run("UPDATE LEDGER SET IS_RECURRING = NOT IS_RECURRING WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [rowId, ws]);
    });
    ledger.linkSubscription(tx, ws, rowId);
  });
  revalidatePath("/");
  revalidatePath("/subscriptions");
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
    "SELECT ID, NAME, ICON, COLOR, SORT_ORDER FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY SORT_ORDER, NAME",
    [ws],
  );
  return rows as ExpenseGroup[];
}

function readGroupForm(formData: FormData) {
  return {
    name: parseName(formData.get("name"), "Group name", 40),
    icon: parseIcon(formData.get("icon")),
    color: parseColor(formData.get("color")),
  };
}

export async function createGroup(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const g = readGroupForm(formData);
    const id = randomUUID();
    await db.execute(
      "INSERT INTO CATEGORY_GROUP (ID, WORKSPACE_ID, NAME, ICON, COLOR, SORT_ORDER) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(SORT_ORDER), -1) + 1 FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL))",
      [id, ws, g.name, g.icon, g.color, ws],
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
    await db.execute("UPDATE CATEGORY_GROUP SET NAME=?, ICON=?, COLOR=? WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [g.name, g.icon, g.color, gid, ws]);
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
    icon: parseIcon(formData.get("icon")),
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
      "INSERT INTO SAVINGS_GOAL (ID, WORKSPACE_ID, NAME, ICON, TARGET_AMOUNT, TARGET_MONTH, STARTING_AMOUNT) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, ws, g.name, g.icon, g.target, g.targetMonth, g.starting],
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
      "UPDATE SAVINGS_GOAL SET NAME=?, ICON=?, TARGET_AMOUNT=?, TARGET_MONTH=?, STARTING_AMOUNT=? WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL",
      [g.name, g.icon, g.target, g.targetMonth, g.starting, gid, ws],
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

export async function getGoalOptions(): Promise<{ ID: string; NAME: string; ICON: string | null }[]> {
  const { workspaceId: ws } = await requireAuth();
  const [rows] = await db.execute("SELECT ID, NAME, ICON FROM SAVINGS_GOAL WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT", [ws]);
  return rows as { ID: string; NAME: string; ICON: string | null }[];
}

// ============================================
// IMPORT PATTERN ACTIONS
// ============================================

/** A rule (lib/rules.ts); the table is still called IMPORT_PATTERN. */
export type ImportPatternRow = Rule;

export async function getImportPatterns(): Promise<ImportPatternRow[]> {
  const { workspaceId: ws } = await requireAuth();
  const [rows] = await db.execute(`SELECT ${ledger.RULE_COLUMNS} FROM IMPORT_PATTERN WHERE WORKSPACE_ID = ? ORDER BY PRIORITY DESC, PATTERN`, [ws]);
  return rows as ImportPatternRow[];
}

export type RuleOptions = {
  priority?: number;
  setName?: string | null;
  setTags?: string | null;
  /** true = mark recurring, false = mark not recurring, null/undefined = leave alone */
  setRecurring?: boolean | null;
  amountMin?: number | null;
  amountMax?: number | null;
};

function readRuleOptions(o: RuleOptions) {
  const min = o.amountMin == null || o.amountMin === 0 ? null : parseAmount(o.amountMin, "Minimum");
  const max = o.amountMax == null || o.amountMax === 0 ? null : parseAmount(o.amountMax, "Maximum");
  if (min !== null && max !== null && min > max) throw new ValidationError("Minimum is above maximum");
  const priority = o.priority === undefined ? 0 : Number(o.priority);
  if (!Number.isInteger(priority) || priority < -100 || priority > 100) throw new ValidationError("Priority must be a whole number between -100 and 100");
  return {
    priority,
    setName: o.setName ? parseName(o.setName, "Name", 120) : null,
    setTags: o.setTags ? parseTagsText(o.setTags) : null,
    setRecurring: o.setRecurring == null ? null : o.setRecurring ? 1 : 0,
    min, max,
  };
}

export async function createImportPattern(pattern: string, category: string, groupId?: string | null, options: RuleOptions = {}): Promise<ActionResult<{ id: string }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const id = randomUUID();
    const o = readRuleOptions(options);
    await db.execute(
      "INSERT INTO IMPORT_PATTERN (ID, WORKSPACE_ID, PATTERN, CATEGORY, GROUP_ID, PRIORITY, SET_NAME, SET_TAGS, SET_RECURRING, AMOUNT_MIN, AMOUNT_MAX) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, ws, parsePattern(pattern), parseCategory(category), parseOptionalId(groupId, "Group"), o.priority, o.setName, o.setTags, o.setRecurring, o.min, o.max],
    );
    revalidatePath("/import");
    return { id };
  });
}

export async function updateImportPattern(id: string, pattern: string, category: string, groupId: string | null, options: RuleOptions = {}): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const o = readRuleOptions(options);
    await db.execute(
      "UPDATE IMPORT_PATTERN SET PATTERN=?, CATEGORY=?, GROUP_ID=?, PRIORITY=?, SET_NAME=?, SET_TAGS=?, SET_RECURRING=?, AMOUNT_MIN=?, AMOUNT_MAX=? WHERE ID=? AND WORKSPACE_ID=?",
      [parsePattern(pattern), parseCategory(category), parseOptionalId(groupId, "Group"), o.priority, o.setName, o.setTags, o.setRecurring, o.min, o.max, parseId(id), ws],
    );
    revalidatePath("/import");
    return {};
  });
}

/** Re-runs one rule (or all) over the existing expense rows. Returns rows changed. */
export async function applyRulesToExisting(ruleId?: string | null): Promise<ActionResult<{ changed: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    const changed = ledger.applyRulesToRows(ws, ruleId ? parseId(ruleId) : null);
    if (changed > 0) { revalidatePath("/"); revalidatePath("/dashboard"); revalidatePath("/subscriptions"); }
    return { changed };
  });
}

// ---------- splits and bulk edits ----------

export async function splitExpense(id: string, parts: Array<{ category: string; groupId: string | null; name?: string | null; amount: number }>): Promise<ActionResult<{ ids: string[] }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    if (!Array.isArray(parts) || parts.length < 2 || parts.length > 10) throw new ValidationError("Split into 2 to 10 parts");
    const clean = parts.map((p) => ({
      category: parseCategory(p.category),
      groupId: parseOptionalId(p.groupId, "Group"),
      name: p.name ? parseName(p.name, "Name", 120) : null,
      amount: parseAmount(p.amount),
    }));
    const ids = ledger.splitRow(ws, parseId(id), clean);
    revalidatePath("/");
    return { ids };
  });
}

export async function bulkUpdateExpenses(ids: string[], patch: { category?: string; groupId?: string | null; tags?: string | null; isRecurring?: boolean; month?: string }): Promise<ActionResult<{ changed: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) throw new ValidationError("Select 1 to 500 rows");
    const clean: ledger.BulkPatch = {};
    if (patch.category !== undefined) clean.category = parseCategory(patch.category);
    if (patch.groupId !== undefined) clean.groupId = parseOptionalId(patch.groupId, "Group");
    if (patch.tags !== undefined) clean.tags = parseTagsText(patch.tags);
    if (patch.isRecurring !== undefined) clean.isRecurring = !!patch.isRecurring;
    if (patch.month !== undefined) clean.month = parseMonth(patch.month);
    const changed = ledger.bulkUpdate(ws, ids.map((i) => parseId(i)), clean);
    revalidatePath("/"); revalidatePath("/dashboard"); revalidatePath("/subscriptions");
    return { changed };
  });
}

export async function bulkDeleteExpenses(ids: string[]): Promise<ActionResult<{ changed: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(() => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) throw new ValidationError("Select 1 to 500 rows");
    const changed = ledger.bulkDelete(ws, ids.map((i) => parseId(i)));
    revalidatePath("/"); revalidatePath("/dashboard"); revalidatePath("/activity");
    return { changed };
  });
}

export async function deleteImportPattern(id: string) {
  const { workspaceId: ws } = await requireAuth();
  await db.execute("DELETE FROM IMPORT_PATTERN WHERE ID = ? AND WORKSPACE_ID = ?", [parseId(id), ws]);
  revalidatePath("/import");
}

const MAX_IMPORT_ROWS = 5000;

export async function importTransactions(
  transactions: Array<{ category: string; groupId: string | null; name: string; amount: number; month: string; notes: string | null; kind?: Kind; day?: number | null; tags?: string | null; isRecurring?: boolean }>,
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
      tags: t.tags ? parseTagsText(t.tags) : null,
      isRecurring: !!t.isRecurring,
    }));
    const count = ledger.importRows(ws, rows);
    if (count > 0) revalidatePath("/");
    return { count };
  });
}
