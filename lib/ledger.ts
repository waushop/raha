// Ledger write logic shared by Server Actions and the CSV import route, and
// unit-tested against an in-memory database. Actions stay thin: auth,
// validation, call here, revalidate.
import { randomUUID } from "node:crypto";
import db, { type Tx } from "./db";
import type { Kind } from "@/types/expense";
import { ValidationError } from "./validate";
import { daysInMonth } from "./months";
import { parseTags } from "./tags";

export type LedgerSource = {
  KIND: Kind;
  CATEGORY: string;
  GROUP_ID: string | null;
  NAME: string;
  AMOUNT: number;
  NOTES: string | null;
  IS_RECURRING: number;
  TAGS: string | null;
  DAY: number | null;
  GOAL_ID?: string | null;
};

export const SOURCE_COLUMNS = "KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, NOTES, IS_RECURRING, TAGS, DAY, GOAL_ID";

const INSERT_LEDGER = `INSERT INTO LEDGER (ID, WORKSPACE_ID, KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, NOTES, IS_RECURRING, TAGS, DAY, GOAL_ID)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** A copied row keeps its day where the target month has it (31st → 30th otherwise). */
export function clampDay(day: number | null, month: string): number | null {
  return day === null ? null : Math.min(day, daysInMonth(month));
}

// ---------- audit ----------
export type AuditAction = "create" | "update" | "delete" | "restore";
export type AuditSnapshot = Record<string, unknown>;
const AUDIT_COLUMNS = "ID, KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, DAY, NOTES, IS_RECURRING, TAGS, GOAL_ID";

/** The row as stored right now (live or deleted), or null if it doesn't exist. */
export function snapshotRow(tx: Tx, id: string): AuditSnapshot | null {
  return tx.all<AuditSnapshot>(`SELECT ${AUDIT_COLUMNS} FROM LEDGER WHERE ID = ?`, [id])[0] ?? null;
}

export function audit(tx: Tx, ledgerId: string, action: AuditAction, before: AuditSnapshot | null, after: AuditSnapshot | null): void {
  tx.run("INSERT INTO LEDGER_AUDIT (ID, LEDGER_ID, ACTION, BEFORE_JSON, AFTER_JSON) VALUES (?, ?, ?, ?, ?)", [
    randomUUID(), ledgerId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
  ]);
}

/** Runs `mutate` for one row and records before/after. Returns false if the row wasn't found. */
export function auditedUpdate(tx: Tx, id: string, action: AuditAction, mutate: () => void): boolean {
  const before = snapshotRow(tx, id);
  if (!before) return false;
  mutate();
  audit(tx, id, action, before, snapshotRow(tx, id));
  return true;
}

/** Rewrites LEDGER_TAG for one row from its free-text TAGS value. */
export function syncTags(tx: Tx, id: string, tagsText: string | null): void {
  tx.run("DELETE FROM LEDGER_TAG WHERE LEDGER_ID = ?", [id]);
  for (const tag of parseTags(tagsText)) tx.run("INSERT OR IGNORE INTO LEDGER_TAG (LEDGER_ID, TAG) VALUES (?, ?)", [id, tag]);
}

// Dedup key: same name and amount (to the cent). Used by every copy/import so
// a double-click or a re-uploaded file never duplicates rows.
const dedupKey = (name: string, amount: number): string => `${name}\u0000${Math.round(amount * 100)}`;

function existingKeys(tx: Tx, ws: string, month: string): Set<string> {
  return new Set(
    tx.all<{ NAME: string; AMOUNT: number }>("SELECT NAME, AMOUNT FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL", [ws, month])
      .map((r) => dedupKey(r.NAME, r.AMOUNT)),
  );
}

// Referenced groups/goals must exist *in this workspace*; ids from another
// user's workspace are rejected the same way as deleted ones.
export function assertGoalExists(tx: Tx, ws: string, id: string | null | undefined): void {
  if (!id) return;
  if (tx.all("SELECT 1 FROM SAVINGS_GOAL WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [id, ws]).length === 0) {
    throw new ValidationError("That goal no longer exists");
  }
}

export function assertGroupExists(tx: Tx, ws: string, id: string | null): void {
  if (!id) return;
  if (tx.all("SELECT 1 FROM CATEGORY_GROUP WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [id, ws]).length === 0) {
    throw new ValidationError("That group no longer exists");
  }
}

export function insertRow(tx: Tx, ws: string, row: LedgerSource, month: string): string {
  const id = randomUUID();
  const day = clampDay(row.DAY, month);
  tx.run(INSERT_LEDGER, [id, ws, row.KIND, row.CATEGORY, row.GROUP_ID, row.NAME, row.AMOUNT, month, row.NOTES, row.IS_RECURRING, row.TAGS, day, row.GOAL_ID ?? null]);
  if (row.TAGS) syncTags(tx, id, row.TAGS);
  audit(tx, id, "create", null, { ID: id, ...row, MONTH: month, DAY: day });
  return id;
}

/** Copies every live row of `sourceMonth` into `targetMonth`, skipping duplicates. */
export function copyMonth(ws: string, sourceMonth: string, targetMonth: string): number {
  if (sourceMonth === targetMonth) return 0;
  return db.transaction((tx) => {
    const rows = tx.all<LedgerSource>(
      `SELECT ${SOURCE_COLUMNS} FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT`,
      [ws, sourceMonth],
    );
    const existing = existingKeys(tx, ws, targetMonth);
    let count = 0;
    for (const row of rows) {
      const key = dedupKey(row.NAME, row.AMOUNT);
      if (existing.has(key)) continue;
      insertRow(tx, ws, row, targetMonth);
      existing.add(key);
      count++;
    }
    return count;
  });
}

/** Copies `sourceMonth` into each target month. Atomic across all targets. */
export function backfill(ws: string, sourceMonth: string, targetMonths: string[]): number {
  return db.transaction((tx) => {
    const source = tx.all<LedgerSource>(
      `SELECT ${SOURCE_COLUMNS} FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT`,
      [ws, sourceMonth],
    );
    if (source.length === 0) return 0;
    let count = 0;
    for (const month of new Set(targetMonths)) {
      if (month === sourceMonth) continue;
      const existing = existingKeys(tx, ws, month);
      for (const row of source) {
        const key = dedupKey(row.NAME, row.AMOUNT);
        if (existing.has(key)) continue;
        insertRow(tx, ws, row, month);
        existing.add(key);
        count++;
      }
    }
    return count;
  });
}

/**
 * Adds every recurring row from the most recent earlier month that isn't
 * already present (by name) in `targetMonth`. Recurring income is copied
 * too; KIND is preserved.
 */
export function copyRecurring(ws: string, targetMonth: string): number {
  return db.transaction((tx) => {
    const rows = tx.all<LedgerSource>(
      `SELECT ${SOURCE_COLUMNS} FROM LEDGER
       WHERE WORKSPACE_ID = ? AND IS_RECURRING = 1 AND DELETED_AT IS NULL AND MONTH < ?
         AND MONTH = (SELECT MAX(MONTH) FROM LEDGER WHERE WORKSPACE_ID = ? AND IS_RECURRING = 1 AND DELETED_AT IS NULL AND MONTH < ?)
       ORDER BY CREATED_AT`,
      [ws, targetMonth, ws, targetMonth],
    );
    const names = new Set(
      tx.all<{ NAME: string }>("SELECT NAME FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL", [ws, targetMonth]).map((r) => r.NAME),
    );
    let count = 0;
    for (const row of rows) {
      if (names.has(row.NAME)) continue;
      insertRow(tx, ws, { ...row, IS_RECURRING: 1 }, targetMonth);
      names.add(row.NAME);
      count++;
    }
    return count;
  });
}

export type ImportRow = {
  kind?: Kind;
  category: string;
  groupId: string | null;
  name: string;
  amount: number;
  month: string;
  notes: string | null;
  isRecurring?: boolean;
  tags?: string | null;
  day?: number | null;
};

/** Inserts rows that don't already exist (name + amount + month). One transaction. */
export function importRows(ws: string, rows: ImportRow[]): number {
  return db.transaction((tx) => {
    const seen = new Map<string, Set<string>>();
    let count = 0;
    for (const r of rows) {
      let keys = seen.get(r.month);
      if (!keys) { keys = existingKeys(tx, ws, r.month); seen.set(r.month, keys); }
      const key = dedupKey(r.name, r.amount);
      if (keys.has(key)) continue;
      insertRow(tx, ws, {
        KIND: r.kind === "income" ? "income" : "expense",
        CATEGORY: r.category,
        GROUP_ID: r.groupId,
        NAME: r.name,
        AMOUNT: r.amount,
        NOTES: r.notes,
        IS_RECURRING: r.isRecurring ? 1 : 0,
        TAGS: r.tags ?? null,
        DAY: r.day ?? null,
      }, r.month);
      keys.add(key);
      count++;
    }
    return count;
  });
}

/** Soft-deletes a group and unlinks live rows and import patterns from it. */
export function removeGroup(ws: string, id: string): void {
  db.transaction((tx) => {
    const hit = tx.run("UPDATE CATEGORY_GROUP SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [id, ws]);
    if (hit.affectedRows === 0) return;
    // Soft-deleted ledger rows keep their GROUP_ID so an undo restores them intact.
    tx.run("UPDATE LEDGER SET GROUP_ID=NULL WHERE GROUP_ID=? AND DELETED_AT IS NULL", [id]);
    tx.run("UPDATE IMPORT_PATTERN SET GROUP_ID=NULL WHERE GROUP_ID=?", [id]);
  });
}

/** Swaps a group with its neighbour and renumbers SORT_ORDER 0..n-1. */
export function reorderGroup(ws: string, id: string, direction: -1 | 1): void {
  db.transaction((tx) => {
    const ids = tx
      .all<{ ID: string }>("SELECT ID FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY SORT_ORDER, NAME", [ws])
      .map((r) => r.ID);
    const i = ids.indexOf(id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    ids.forEach((gid, idx) => tx.run("UPDATE CATEGORY_GROUP SET SORT_ORDER=? WHERE ID=?", [idx, gid]));
  });
}
