// Ledger write logic shared by Server Actions and the CSV import route, and
// unit-tested against an in-memory database. Actions stay thin: auth,
// validation, call here, revalidate.
import { randomUUID } from "node:crypto";
import db, { type Tx } from "./db";
import type { Kind, LedgerKind } from "@/types/expense";
import { ValidationError } from "./validate";
import { currentMonth, daysInMonth } from "./months";
import { syncRowLink } from "./subscriptions";
import { applyRules, type Rule } from "./rules";
import { formatTags, parseTags } from "./tags";
import { merchantKey } from "./classifier";
import { cleanMerchant } from "./merchants";

export type LedgerSource = {
  KIND: LedgerKind;
  CATEGORY: string;
  GROUP_ID: string | null;
  NAME: string;
  AMOUNT: number;
  NOTES: string | null;
  IS_RECURRING: number;
  TAGS: string | null;
  DAY: number | null;
  GOAL_ID?: string | null;
  SPLIT_GROUP?: string | null;
  PAID_BY?: string | null;
  /** The bank's transaction id (bank sync); never copied by SOURCE_COLUMNS. */
  EXTERNAL_ID?: string | null;
  /** 1 = a bank line shown in /transactions and the stats but not the month view. */
  FEED_ONLY?: number;
};

export const SOURCE_COLUMNS = "KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, NOTES, IS_RECURRING, TAGS, DAY, GOAL_ID, SPLIT_GROUP, PAID_BY";

const INSERT_LEDGER = `INSERT INTO LEDGER (ID, WORKSPACE_ID, KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, NOTES, IS_RECURRING, TAGS, DAY, GOAL_ID, SPLIT_GROUP, PAID_BY, EXTERNAL_ID, FEED_ONLY)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** A copied row keeps its day where the target month has it (31st → 30th otherwise). */
export function clampDay(day: number | null, month: string): number | null {
  return day === null ? null : Math.min(day, daysInMonth(month));
}

// ---------- audit ----------
export type AuditAction = "create" | "update" | "delete" | "restore";
export type AuditSnapshot = Record<string, unknown>;
const AUDIT_COLUMNS = "ID, KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, DAY, NOTES, IS_RECURRING, TAGS, GOAL_ID, FEED_ONLY";

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

/** A payer must be a member of the workspace (null = unassigned). */
export function assertMember(tx: Tx, ws: string, userId: string | null | undefined): void {
  if (!userId) return;
  if (tx.all("SELECT 1 FROM WORKSPACE_MEMBER WHERE WORKSPACE_ID = ? AND USER_ID = ?", [ws, userId]).length === 0) throw new ValidationError("That person is not in this household");
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
  tx.run(INSERT_LEDGER, [id, ws, row.KIND, row.CATEGORY, row.GROUP_ID, row.NAME, row.AMOUNT, month, row.NOTES, row.IS_RECURRING, row.TAGS, day, row.GOAL_ID ?? null, row.SPLIT_GROUP ?? null, row.PAID_BY ?? null, row.EXTERNAL_ID ?? null, row.FEED_ONLY ?? 0]);
  if (row.TAGS) syncTags(tx, id, row.TAGS);
  audit(tx, id, "create", null, { ID: id, ...row, MONTH: month, DAY: day });
  if (row.IS_RECURRING && row.KIND === "expense") linkSubscription(tx, ws, id);
  return id;
}

/** Keeps LEDGER.SUBSCRIPTION_ID in step with the row's recurring flag and identity. */
export function linkSubscription(tx: Tx, ws: string, id: string): void {
  syncRowLink(tx, ws, id, currentMonth(), randomUUID);
}

/** Recurring rows of paused/cancelled subscriptions must not be copied forward. */
function stoppedSubscriptionKeys(tx: Tx, ws: string): Set<string> {
  return new Set(
    tx.all<{ NAME: string; CATEGORY: string; GROUP_ID: string | null }>(
      "SELECT NAME, CATEGORY, GROUP_ID FROM SUBSCRIPTION WHERE WORKSPACE_ID = ? AND STATUS <> 'active' AND DELETED_AT IS NULL", [ws],
    ).map((r) => `${r.NAME}\u0000${r.CATEGORY}\u0000${r.GROUP_ID ?? ""}`),
  );
}
const isStopped = (stopped: Set<string>, r: LedgerSource) => r.IS_RECURRING === 1 && stopped.has(`${r.NAME}\u0000${r.CATEGORY}\u0000${r.GROUP_ID ?? ""}`);

/** Copies every live month-view row of `sourceMonth` into `targetMonth` (bank lines stay behind), skipping duplicates. */
export function copyMonth(ws: string, sourceMonth: string, targetMonth: string): number {
  if (sourceMonth === targetMonth) return 0;
  return db.transaction((tx) => {
    const rows = tx.all<LedgerSource>(
      `SELECT ${SOURCE_COLUMNS} FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL AND FEED_ONLY = 0 ORDER BY CREATED_AT`,
      [ws, sourceMonth],
    );
    const existing = existingKeys(tx, ws, targetMonth);
    const stopped = stoppedSubscriptionKeys(tx, ws);
    let count = 0;
    for (const row of rows) {
      const key = dedupKey(row.NAME, row.AMOUNT);
      if (existing.has(key) || isStopped(stopped, row)) continue;
      insertRow(tx, ws, { ...row, SPLIT_GROUP: null }, targetMonth);
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
      `SELECT ${SOURCE_COLUMNS} FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL AND FEED_ONLY = 0 ORDER BY CREATED_AT`,
      [ws, sourceMonth],
    );
    if (source.length === 0) return 0;
    const stopped = stoppedSubscriptionKeys(tx, ws);
    let count = 0;
    for (const month of new Set(targetMonths)) {
      if (month === sourceMonth) continue;
      const existing = existingKeys(tx, ws, month);
      for (const row of source) {
        const key = dedupKey(row.NAME, row.AMOUNT);
        if (existing.has(key) || isStopped(stopped, row)) continue;
        insertRow(tx, ws, { ...row, SPLIT_GROUP: null }, month);
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
       WHERE WORKSPACE_ID = ? AND IS_RECURRING = 1 AND DELETED_AT IS NULL AND FEED_ONLY = 0 AND MONTH < ?
         AND MONTH = (SELECT MAX(MONTH) FROM LEDGER WHERE WORKSPACE_ID = ? AND IS_RECURRING = 1 AND DELETED_AT IS NULL AND FEED_ONLY = 0 AND MONTH < ?)
       ORDER BY CREATED_AT`,
      [ws, targetMonth, ws, targetMonth],
    );
    const names = new Set(
      tx.all<{ NAME: string }>("SELECT NAME FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL", [ws, targetMonth]).map((r) => r.NAME),
    );
    const stopped = stoppedSubscriptionKeys(tx, ws);
    let count = 0;
    for (const row of rows) {
      if (names.has(row.NAME) || isStopped(stopped, row)) continue;
      insertRow(tx, ws, { ...row, IS_RECURRING: 1, SPLIT_GROUP: null }, targetMonth);
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
  /** Original bank description; rows imported before merchant cleaning carry it as NAME. */
  rawName?: string | null;
};

/** Inserts rows that don't already exist (name + amount + month). One transaction. */
export function importRows(ws: string, rows: ImportRow[]): number {
  return db.transaction((tx) => {
    const ownGroups = new Set(tx.all<{ ID: string }>("SELECT ID FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]).map((g) => g.ID));
    const seen = new Map<string, Set<string>>();
    let count = 0;
    for (const r of rows) {
      let keys = seen.get(r.month);
      if (!keys) { keys = existingKeys(tx, ws, r.month); seen.set(r.month, keys); }
      const key = dedupKey(r.name, r.amount);
      if (keys.has(key) || (r.rawName && keys.has(dedupKey(r.rawName, r.amount)))) continue;
      insertRow(tx, ws, {
        KIND: r.kind === "income" ? "income" : "expense",
        CATEGORY: r.category,
        GROUP_ID: r.groupId && ownGroups.has(r.groupId) ? r.groupId : null,
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

// ---------- splits, bulk edits, rules ----------

export type SplitPart = { category: string; groupId: string | null; name?: string | null; amount: number };

/**
 * Splits one row into several (same month/day/notes/kind) that share a
 * SPLIT_GROUP. The original row keeps its id and becomes the first part; the
 * parts must add up to the original amount (±0.01).
 */
export function splitRow(ws: string, id: string, parts: SplitPart[]): string[] {
  if (parts.length < 2) throw new ValidationError("A split needs at least two parts");
  return db.transaction((tx) => {
    const row = tx.all<LedgerSource & { ID: string; MONTH: string }>(
      `SELECT ID, MONTH, FEED_ONLY, ${SOURCE_COLUMNS} FROM LEDGER WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL`, [id, ws],
    )[0];
    if (!row) throw new ValidationError("Row not found");
    const total = parts.reduce((s, p) => s + p.amount, 0);
    if (Math.abs(total - row.AMOUNT) > 0.011) throw new ValidationError(`Parts add up to ${total.toFixed(2)}, the row is ${row.AMOUNT.toFixed(2)}`);
    for (const p of parts) assertGroupExists(tx, ws, p.groupId);
    const group = row.SPLIT_GROUP ?? id;
    const [first, ...rest] = parts;
    auditedUpdate(tx, id, "update", () => {
      tx.run("UPDATE LEDGER SET CATEGORY=?, GROUP_ID=?, NAME=?, AMOUNT=?, SPLIT_GROUP=? WHERE ID=?", [first.category, first.groupId, first.name?.trim() || row.NAME, first.amount, group, id]);
    });
    const ids = [id];
    for (const p of rest) {
      ids.push(insertRow(tx, ws, { ...row, CATEGORY: p.category, GROUP_ID: p.groupId, NAME: p.name?.trim() || row.NAME, AMOUNT: p.amount, IS_RECURRING: 0, GOAL_ID: null, SPLIT_GROUP: group }, row.MONTH));
    }
    return ids;
  });
}

/** Moves a bank line from the feed into the month view. Returns false when there was nothing to move. */
export function addToMonth(ws: string, id: string): boolean {
  return db.transaction((tx) => {
    const live = tx.all("SELECT 1 FROM LEDGER WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL AND FEED_ONLY = 1", [id, ws]).length > 0;
    return live && auditedUpdate(tx, id, "update", () => tx.run("UPDATE LEDGER SET FEED_ONLY = 0 WHERE ID = ? AND WORKSPACE_ID = ?", [id, ws]));
  });
}

/**
 * Marks a bank feed line as a transfer (not income or spending) or back.
 * The direction survives in the sign of AMOUNT while it is a transfer.
 */
export function setTransfer(ws: string, id: string, on: boolean): boolean {
  return db.transaction((tx) => markTransfer(tx, ws, id, on));
}

/** setTransfer inside an open transaction (bank sync uses it too). */
export function markTransfer(tx: Tx, ws: string, id: string, on: boolean): boolean {
  const row = tx.all<{ KIND: LedgerKind; AMOUNT: number }>(
    "SELECT KIND, CAST(AMOUNT AS REAL) AS AMOUNT FROM LEDGER WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL AND FEED_ONLY = 1", [id, ws],
  )[0];
  if (!row || (row.KIND === "transfer") === on) return false;
  const [kind, amount] = on
    ? ["transfer", row.KIND === "expense" ? -row.AMOUNT : row.AMOUNT]
    : [row.AMOUNT < 0 ? "expense" : "income", Math.abs(row.AMOUNT)];
  return auditedUpdate(tx, id, "update", () => tx.run(
    "UPDATE LEDGER SET KIND = ?, AMOUNT = ?, SUBSCRIPTION_ID = NULL, IS_RECURRING = 0 WHERE ID = ? AND WORKSPACE_ID = ?", [kind, amount, id, ws],
  ));
}

// ---------- bank line ↔ bill ----------
//
// A bill is a month-view row; bank lines pay it. A paying line is folded into
// the bill: soft-deleted with BILL_ID pointing at it (it keeps its bank id, so
// a re-sync never brings it back, and the money counts once, as the bill).
// Bills paid in parts (a loan's principal + interest) collect several lines;
// the bill is settled at the real total once the parts reach it.

/** Amount of bank lines folded into each bill (SQL fragment, alias `e` = the bill). */
export const BILL_PAID_SQL = "(SELECT COALESCE(SUM(p.AMOUNT), 0) FROM LEDGER p WHERE p.BILL_ID = e.ID AND p.WORKSPACE_ID = e.WORKSPACE_ID)";
/** A month-view row still waiting for its money (alias `e`). */
export const BILL_OPEN_SQL = `e.FEED_ONLY = 0 AND e.EXTERNAL_ID IS NULL AND e.KIND IN ('expense', 'income') AND e.DELETED_AT IS NULL AND ${BILL_PAID_SQL} < e.AMOUNT - 0.005`;

/**
 * What identifies "the same payee" across months: the cleaned merchant, plus
 * the contract number when the text has one (two loans from the same bank,
 * paid to the same short name, are different bills).
 */
export function billMatchKey(rawText: string): string {
  const base = merchantKey(cleanMerchant(rawText));
  const contract = rawText.match(/\b\d{2}-\d{6}-[A-Z]{2}\b/)?.[0];
  return contract ? `${base} ${contract.toLowerCase()}` : base;
}

/** billMatchKey of a stored bank line, from the "Bank: …" text sync keeps in NOTES. */
export function bankMerchantKey(notes: string | null, fallbackName: string): string {
  const raw = notes?.startsWith("Bank:") ? notes.slice(5).trim() : "";
  return billMatchKey(raw || fallbackName);
}

export function rememberBillMatch(tx: Tx, ws: string, key: string, kind: Kind, billName: string): void {
  if (!key) return;
  tx.run(
    `INSERT INTO BILL_MATCH (WORKSPACE_ID, MERCHANT_KEY, KIND, BILL_NAME) VALUES (?, ?, ?, ?)
     ON CONFLICT(WORKSPACE_ID, MERCHANT_KEY, KIND) DO UPDATE SET BILL_NAME = excluded.BILL_NAME, UPDATED_AT = CURRENT_TIMESTAMP`,
    [ws, key, kind, billName],
  );
}

/** The open bill of this month that a merchant paid before (learned pairing), or null. */
export function learnedBill(tx: Tx, ws: string, key: string, kind: Kind, month: string): string | null {
  const name = tx.all<{ BILL_NAME: string }>("SELECT BILL_NAME FROM BILL_MATCH WHERE WORKSPACE_ID = ? AND MERCHANT_KEY = ? AND KIND = ?", [ws, key, kind])[0]?.BILL_NAME;
  if (!name) return null;
  return tx.all<{ ID: string }>(
    `SELECT e.ID FROM LEDGER e WHERE e.WORKSPACE_ID = ? AND e.MONTH = ? AND e.KIND = ? AND e.NAME = ? AND ${BILL_OPEN_SQL} ORDER BY e.CREATED_AT LIMIT 1`,
    [ws, month, kind, name],
  )[0]?.ID ?? null;
}

/** A line within this share of what is left on the bill settles it (variable bills); smaller lines are parts. */
const SETTLE_SHARE = 0.75;

/**
 * Folds a bank line into a bill. The bill keeps its name, category and
 * group; once paid in full (or by one line close to what was left) it takes
 * the real total and the latest payment day.
 */
export function payBill(tx: Tx, ws: string, billId: string, lineId: string): void {
  const bill = tx.all<{ AMOUNT: number }>("SELECT CAST(AMOUNT AS REAL) AS AMOUNT FROM LEDGER WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [billId, ws])[0];
  const line = tx.all<{ AMOUNT: number; DAY: number | null }>("SELECT CAST(AMOUNT AS REAL) AS AMOUNT, DAY FROM LEDGER WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [lineId, ws])[0];
  if (!bill || !line) throw new ValidationError("Bill or bank line not found");
  const paidBefore = tx.all<{ S: number }>("SELECT COALESCE(SUM(AMOUNT), 0) AS S FROM LEDGER WHERE BILL_ID = ? AND WORKSPACE_ID = ?", [billId, ws])[0].S;
  const left = bill.AMOUNT - paidBefore;
  auditedUpdate(tx, lineId, "delete", () => tx.run("UPDATE LEDGER SET BILL_ID = ?, DELETED_AT = CURRENT_TIMESTAMP WHERE ID = ?", [billId, lineId]));
  const paid = paidBefore + line.AMOUNT;
  if (paid >= bill.AMOUNT - 0.005 || line.AMOUNT >= left * SETTLE_SHARE) {
    auditedUpdate(tx, billId, "update", () => tx.run("UPDATE LEDGER SET AMOUNT = ?, DAY = COALESCE(?, DAY) WHERE ID = ?", [Math.round(paid * 100) / 100, line.DAY, billId]));
  } else if (line.DAY !== null) {
    tx.run("UPDATE LEDGER SET DAY = COALESCE(DAY, ?) WHERE ID = ?", [line.DAY, billId]);
  }
}

/** "Match bill": the feed line pays a month-view bill; the merchant is remembered for next month. */
export function matchToBill(ws: string, lineId: string, billId: string): void {
  db.transaction((tx) => {
    type R = { ID: string; KIND: LedgerKind; MONTH: string; NAME: string; NOTES: string | null; EXTERNAL_ID: string | null; FEED_ONLY: number };
    const line = tx.all<R>("SELECT ID, KIND, MONTH, NAME, NOTES, EXTERNAL_ID, FEED_ONLY FROM LEDGER WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [lineId, ws])[0];
    const bill = tx.all<R>(`SELECT e.ID, e.KIND, e.MONTH, e.NAME, e.NOTES, e.EXTERNAL_ID, e.FEED_ONLY FROM LEDGER e WHERE e.ID = ? AND e.WORKSPACE_ID = ? AND ${BILL_OPEN_SQL}`, [billId, ws])[0];
    if (!line || line.FEED_ONLY !== 1 || !line.EXTERNAL_ID || line.KIND === "transfer") throw new ValidationError("That bank line can't be matched");
    if (!bill) throw new ValidationError("That bill is already paid or gone");
    if (bill.KIND !== line.KIND || bill.MONTH !== line.MONTH) throw new ValidationError("Pick a bill of the same month and kind");
    payBill(tx, ws, bill.ID, line.ID);
    rememberBillMatch(tx, ws, bankMerchantKey(line.NOTES, line.NAME), line.KIND as Kind, bill.NAME);
  });
}

/** Undoes "Match bill": the line is back in the feed; the bill keeps its amount (edit it if needed). */
export function unmatchLine(ws: string, lineId: string): boolean {
  return db.transaction((tx) => {
    const line = tx.all<{ ID: string }>("SELECT ID FROM LEDGER WHERE ID = ? AND WORKSPACE_ID = ? AND BILL_ID IS NOT NULL AND DELETED_AT IS NOT NULL", [lineId, ws])[0];
    return !!line && auditedUpdate(tx, lineId, "restore", () => tx.run("UPDATE LEDGER SET BILL_ID = NULL, DELETED_AT = NULL WHERE ID = ?", [lineId]));
  });
}

/** The subset of ids that are live rows of this workspace (keeps bulk edits honest). */
function ownedLiveIds(tx: Tx, ws: string, ids: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = tx.all<{ ID: string }>(`SELECT ID FROM LEDGER WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL AND ID IN (${chunk.map(() => "?").join(",")})`, [ws, ...chunk]);
    out.push(...rows.map((r) => r.ID));
  }
  return out;
}

export type BulkPatch = { category?: string; groupId?: string | null; tags?: string | null; isRecurring?: boolean; month?: string };

/** Applies the same change to many rows; returns how many changed. */
export function bulkUpdate(ws: string, ids: string[], patch: BulkPatch): number {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.category !== undefined) { sets.push("CATEGORY=?"); params.push(patch.category); }
  if (patch.groupId !== undefined) { sets.push("GROUP_ID=?"); params.push(patch.groupId); }
  if (patch.tags !== undefined) { sets.push("TAGS=?"); params.push(patch.tags); }
  if (patch.isRecurring !== undefined) { sets.push("IS_RECURRING=?"); params.push(patch.isRecurring ? 1 : 0); }
  if (patch.month !== undefined) { sets.push("MONTH=?", "DAY=CASE WHEN DAY IS NULL THEN NULL ELSE MIN(DAY, ?) END"); params.push(patch.month, daysInMonth(patch.month)); }
  if (sets.length === 0) return 0;
  return db.transaction((tx) => {
    if (patch.groupId) assertGroupExists(tx, ws, patch.groupId);
    let n = 0;
    for (const id of ownedLiveIds(tx, ws, ids)) {
      const changed = auditedUpdate(tx, id, "update", () => {
        tx.run(`UPDATE LEDGER SET ${sets.join(", ")} WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL`, [...params, id, ws]);
      });
      if (!changed) continue;
      if (patch.tags !== undefined) syncTags(tx, id, patch.tags);
      if (patch.isRecurring !== undefined || patch.category !== undefined || patch.groupId !== undefined) linkSubscription(tx, ws, id);
      n++;
    }
    return n;
  });
}

export function bulkDelete(ws: string, ids: string[]): number {
  return db.transaction((tx) => {
    let n = 0;
    for (const id of ownedLiveIds(tx, ws, ids)) {
      if (auditedUpdate(tx, id, "delete", () => tx.run("UPDATE LEDGER SET DELETED_AT=CURRENT_TIMESTAMP WHERE ID=? AND WORKSPACE_ID=? AND DELETED_AT IS NULL", [id, ws]))) n++;
    }
    return n;
  });
}

export const RULE_COLUMNS = "ID, PATTERN, CATEGORY, GROUP_ID, PRIORITY, SET_NAME, SET_TAGS, SET_RECURRING, CAST(AMOUNT_MIN AS REAL) AS AMOUNT_MIN, CAST(AMOUNT_MAX AS REAL) AS AMOUNT_MAX";

export function loadRules(tx: Tx, ws: string): Rule[] {
  return tx.all<Rule>(`SELECT ${RULE_COLUMNS} FROM IMPORT_PATTERN WHERE WORKSPACE_ID = ? ORDER BY PRIORITY DESC, PATTERN`, [ws]);
}

/**
 * Re-runs the rules over live expense rows (optionally only one rule) and
 * rewrites category/group/name/tags/recurring where a rule matches the
 * row's name or notes. Returns rows changed.
 */
export function applyRulesToRows(ws: string, ruleId: string | null = null): number {
  return db.transaction((tx) => {
    const rules = loadRules(tx, ws).filter((r) => ruleId === null || r.ID === ruleId);
    if (rules.length === 0) return 0;
    const rows = tx.all<{ ID: string; NAME: string; NOTES: string | null; AMOUNT: number; CATEGORY: string; GROUP_ID: string | null; TAGS: string | null; IS_RECURRING: number }>(
      "SELECT ID, NAME, NOTES, CAST(AMOUNT AS REAL) AS AMOUNT, CATEGORY, GROUP_ID, TAGS, IS_RECURRING FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL AND SPLIT_GROUP IS NULL", [ws],
    );
    let n = 0;
    for (const r of rows) {
      const patch = applyRules(rules, { text: `${r.NAME} ${r.NOTES ?? ""}`, amount: r.AMOUNT });
      if (!patch) continue;
      const name = patch.name ?? r.NAME;
      const tags = patch.tags !== undefined ? mergeTags(r.TAGS, patch.tags) : r.TAGS;
      const recurring = patch.isRecurring !== undefined ? (patch.isRecurring ? 1 : 0) : r.IS_RECURRING;
      if (patch.category === r.CATEGORY && (patch.groupId ?? null) === (r.GROUP_ID ?? null) && name === r.NAME && tags === r.TAGS && recurring === r.IS_RECURRING) continue;
      auditedUpdate(tx, r.ID, "update", () => {
        tx.run("UPDATE LEDGER SET CATEGORY=?, GROUP_ID=?, NAME=?, TAGS=?, IS_RECURRING=? WHERE ID=?", [patch.category, patch.groupId, name, tags, recurring, r.ID]);
      });
      syncTags(tx, r.ID, tags);
      if (recurring === 1 || recurring !== r.IS_RECURRING) linkSubscription(tx, ws, r.ID);
      n++;
    }
    return n;
  });
}

/** Union of two "#a, #b" strings. */
export function mergeTags(a: string | null, b: string | null): string | null {
  return formatTags([...new Set([...parseTags(a ?? ""), ...parseTags(b ?? "")])]);
}
