import { NextRequest, NextResponse } from "next/server";
import { iconFromLegacy } from "@/lib/icon-names";
import { CADENCES, STATUSES, backfillSubscriptions } from "@/lib/subscriptions";
import { PLAN_KINDS } from "@/lib/plan";
import { PAYDAY_CADENCES } from "@/lib/cashflow";
import { ACCOUNT_TYPES } from "@/lib/networth";
import { currentMonth } from "@/lib/months";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { getAuthContext } from "@/lib/auth";
import { syncTags } from "@/lib/ledger";
import { CATEGORY_KEYS, GROUP_COLORS } from "@/types/expense";

// Backup format history:
//   v2  expenses only, no KIND
//   v3  + KIND per row
//   v4  + GROUP_ID per row, plus groups / budgets / import_patterns sections.
//       Rows keep their original IDs so restoring the same file twice is a
//       no-op, and restoring an older backup puts rows back to their backed-
//       up values (including un-deleting them). Rows that exist only in the
//       database are never touched.
//   v5  + DAY per row, plus budget_history section. LEDGER_TAG is derived
//       from TAGS on restore, so it is not backed up separately.
//   v6  + GOAL_ID per row, plus goals section.
//   v7  groups and goals carry ICON (a lib/icon-names.ts name) instead of
//       EMOJI; older files' EMOJI values are mapped on restore.
//   v8  + subscriptions section and SUBSCRIPTION_ID per row.
//   v9  + plan_lines section (zero-based plan).
//   v10 + paydays and balance_checkpoints sections (cash flow).
//   v11 + SPLIT_GROUP per row; import_patterns carry the rule fields.
//   v12 + accounts and account_snapshots sections (net worth).
//   v13 + PAID_BY per row (households).
//   v14 + EXTERNAL_ID per row (bank sync), so a restored ledger is not
//       re-imported by the next sync. Bank connections and accounts are NOT
//       backed up or restored: their SESSION_ID / STATE are live credentials
//       for one consent, which expires anyway; reconnect after a restore.
const BACKUP_VERSION = 14;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const isCategory = (v: unknown): v is string => typeof v === "string" && (CATEGORY_KEYS as string[]).includes(v);
const isColor = (v: unknown): v is string => typeof v === "string" && (GROUP_COLORS as readonly string[]).includes(v);

// Backups are per workspace: a user downloads and restores their own ledger.
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = ctx.workspaceId;

  const [expenses] = await db.execute(
    `SELECT ID, KIND, CATEGORY, GROUP_ID, NAME, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, DAY, GOAL_ID, SUBSCRIPTION_ID, SPLIT_GROUP, PAID_BY, EXTERNAL_ID, NOTES, IS_RECURRING, TAGS, CREATED_AT
     FROM LEDGER WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY MONTH, CREATED_AT`, [ws]
  );
  const [groups] = await db.execute(
    "SELECT ID, NAME, ICON, COLOR, SORT_ORDER FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY SORT_ORDER, NAME", [ws]
  );
  const [budgets] = await db.execute("SELECT CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT FROM BUDGET WHERE WORKSPACE_ID = ? ORDER BY CATEGORY", [ws]);
  const [patterns] = await db.execute(
    "SELECT ID, PATTERN, CATEGORY, GROUP_ID, PRIORITY, SET_NAME, SET_TAGS, SET_RECURRING, CAST(AMOUNT_MIN AS REAL) AS AMOUNT_MIN, CAST(AMOUNT_MAX AS REAL) AS AMOUNT_MAX FROM IMPORT_PATTERN WHERE WORKSPACE_ID = ? ORDER BY PRIORITY DESC, PATTERN", [ws]
  );
  const [goals] = await db.execute(
    "SELECT ID, NAME, ICON, CAST(TARGET_AMOUNT AS REAL) AS TARGET_AMOUNT, TARGET_MONTH, CAST(STARTING_AMOUNT AS REAL) AS STARTING_AMOUNT FROM SAVINGS_GOAL WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT", [ws]
  );
  const [budgetHistory] = await db.execute("SELECT MONTH, CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT FROM BUDGET_HISTORY WHERE WORKSPACE_ID = ? ORDER BY MONTH, CATEGORY", [ws]);
  const [paydays] = await db.execute("SELECT ID, LABEL, CAST(AMOUNT AS REAL) AS AMOUNT, CADENCE, DAY, START_DATE FROM PAYDAY WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT", [ws]);
  const [checkpoints] = await db.execute("SELECT ID, DATE, CAST(AMOUNT AS REAL) AS AMOUNT, NOTE FROM BALANCE_CHECKPOINT WHERE WORKSPACE_ID = ? ORDER BY DATE", [ws]);
  const [planLines] = await db.execute(
    "SELECT ID, MONTH, KIND, CATEGORY, GROUP_ID, LABEL, CAST(PLANNED AS REAL) AS PLANNED, SORT_ORDER, SUBSCRIPTION_ID FROM PLAN_LINE WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY MONTH, SORT_ORDER", [ws]
  );
  const [accounts] = await db.execute("SELECT ID, NAME, TYPE, SORT_ORDER FROM ACCOUNT WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY SORT_ORDER, CREATED_AT", [ws]);
  const [accountSnapshots] = await db.execute(
    `SELECT s.ID, s.ACCOUNT_ID, s.MONTH, CAST(s.BALANCE AS REAL) AS BALANCE FROM ACCOUNT_SNAPSHOT s
     JOIN ACCOUNT a ON a.ID = s.ACCOUNT_ID AND a.DELETED_AT IS NULL WHERE s.WORKSPACE_ID = ? ORDER BY s.ACCOUNT_ID, s.MONTH`, [ws]
  );
  const [subscriptions] = await db.execute(
    `SELECT ID, NAME, CATEGORY, GROUP_ID, CAST(AMOUNT AS REAL) AS AMOUNT, CADENCE, DAY, MONTH_OF_YEAR, STATUS, STATUS_CHANGED_AT, NOTES, CANCEL_URL, TRIAL_ENDS
     FROM SUBSCRIPTION WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT`, [ws]
  );

  const data = {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    groups,
    budgets,
    budget_history: budgetHistory,
    goals,
    subscriptions,
    plan_lines: planLines,
    paydays,
    balance_checkpoints: checkpoints,
    accounts,
    account_snapshots: accountSnapshots,
    import_patterns: patterns,
    expenses, // legacy field name kept so older importers still find the rows
  };

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="empty-wallet-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

type Json = Record<string, unknown>;
/** True when a row with this id exists in a *different* workspace. */
const foreign = (tx: { all: <T>(sql: string, params?: unknown[]) => T[] }, ws: string, table: string, id: string): boolean =>
  tx.all<{ W: string | null }>(`SELECT WORKSPACE_ID AS W FROM ${table} WHERE ID = ?`, [id]).some((r) => r.W !== null && r.W !== ws);
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

// POST: restore from a JSON backup (v2, v3 or v4). Atomic: a malformed file
// leaves the database untouched.
export async function POST(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = ctx.workspaceId;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "Backup file is too large" }, { status: 413 });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Backup file is too large" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Body is not valid JSON" }, { status: 400 });
  }
  if (!isObj(body) || !Array.isArray(body.expenses)) {
    return NextResponse.json({ error: "Invalid backup format" }, { status: 400 });
  }

  const groups = Array.isArray(body.groups) ? body.groups : [];
  const budgets = Array.isArray(body.budgets) ? body.budgets : [];
  const patterns = Array.isArray(body.import_patterns) ? body.import_patterns : [];
  const budgetHistory = Array.isArray(body.budget_history) ? body.budget_history : [];
  const goals = Array.isArray(body.goals) ? body.goals : [];
  const subscriptions = Array.isArray(body.subscriptions) ? body.subscriptions : [];
  const planLines = Array.isArray(body.plan_lines) ? body.plan_lines : [];
  const paydays = Array.isArray(body.paydays) ? body.paydays : [];
  const checkpoints = Array.isArray(body.balance_checkpoints) ? body.balance_checkpoints : [];
  const accounts = Array.isArray(body.accounts) ? body.accounts : [];
  const accountSnapshots = Array.isArray(body.account_snapshots) ? body.account_snapshots : [];
  const expenses = body.expenses;

  const result = db.transaction((tx) => {
    const stats = { imported: 0, updated: 0, skipped: 0, groups: 0, budgets: 0, patterns: 0, budget_history: 0, goals: 0, subscriptions: 0, plan_lines: 0, paydays: 0, balance_checkpoints: 0, accounts: 0, account_snapshots: 0 };

    for (const g of groups) {
      if (!isObj(g)) continue;
      const id = str(g.ID);
      const name = str(g.NAME);
      if (!id || !UUID_RE.test(id) || !name) continue;
      if (foreign(tx, ws, "CATEGORY_GROUP", id)) continue;
      tx.run(
        `INSERT INTO CATEGORY_GROUP (ID, WORKSPACE_ID, NAME, ICON, COLOR, SORT_ORDER) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET NAME = excluded.NAME, ICON = excluded.ICON, COLOR = excluded.COLOR,
           SORT_ORDER = excluded.SORT_ORDER, DELETED_AT = NULL`,
        [id, ws, name, iconFromLegacy(g.ICON ?? g.EMOJI), isColor(g.COLOR) ? g.COLOR : "blue", num(g.SORT_ORDER) ?? 0],
      );
      stats.groups++;
    }

    for (const g of goals) {
      if (!isObj(g)) continue;
      const id = str(g.ID);
      const name = str(g.NAME);
      const target = num(g.TARGET_AMOUNT);
      if (!id || !UUID_RE.test(id) || !name || target === null || target <= 0) continue;
      const targetMonth = str(g.TARGET_MONTH);
      if (foreign(tx, ws, "SAVINGS_GOAL", id)) continue;
      tx.run(
        `INSERT INTO SAVINGS_GOAL (ID, WORKSPACE_ID, NAME, ICON, TARGET_AMOUNT, TARGET_MONTH, STARTING_AMOUNT) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET NAME = excluded.NAME, ICON = excluded.ICON, TARGET_AMOUNT = excluded.TARGET_AMOUNT,
           TARGET_MONTH = excluded.TARGET_MONTH, STARTING_AMOUNT = excluded.STARTING_AMOUNT, DELETED_AT = NULL`,
        [id, ws, name, iconFromLegacy(g.ICON ?? g.EMOJI), target, targetMonth && MONTH_RE.test(targetMonth) ? targetMonth : null, Math.max(0, num(g.STARTING_AMOUNT) ?? 0)],
      );
      stats.goals++;
    }
    const liveGoalIds = new Set(
      tx.all<{ ID: string }>("SELECT ID FROM SAVINGS_GOAL WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]).map((r) => r.ID),
    );

    const liveGroupIds = new Set(
      tx.all<{ ID: string }>("SELECT ID FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]).map((r) => r.ID),
    );

    for (const sub of subscriptions) {
      if (!isObj(sub)) continue;
      const id = str(sub.ID);
      const name = str(sub.NAME);
      const amount = num(sub.AMOUNT);
      const cadence = str(sub.CADENCE) ?? "monthly";
      const status = str(sub.STATUS) ?? "active";
      if (!id || !UUID_RE.test(id) || !name || amount === null || amount <= 0) continue;
      if (!(CADENCES as readonly string[]).includes(cadence) || !(STATUSES as readonly string[]).includes(status)) continue;
      if (foreign(tx, ws, "SUBSCRIPTION", id)) continue;
      const groupId = str(sub.GROUP_ID);
      const day = num(sub.DAY);
      const moy = num(sub.MONTH_OF_YEAR);
      tx.run(
        `INSERT INTO SUBSCRIPTION (ID, WORKSPACE_ID, NAME, CATEGORY, GROUP_ID, AMOUNT, CADENCE, DAY, MONTH_OF_YEAR, STATUS, STATUS_CHANGED_AT, NOTES, CANCEL_URL, TRIAL_ENDS)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET NAME = excluded.NAME, CATEGORY = excluded.CATEGORY, GROUP_ID = excluded.GROUP_ID, AMOUNT = excluded.AMOUNT,
           CADENCE = excluded.CADENCE, DAY = excluded.DAY, MONTH_OF_YEAR = excluded.MONTH_OF_YEAR, STATUS = excluded.STATUS,
           STATUS_CHANGED_AT = excluded.STATUS_CHANGED_AT, NOTES = excluded.NOTES, CANCEL_URL = excluded.CANCEL_URL, TRIAL_ENDS = excluded.TRIAL_ENDS, DELETED_AT = NULL`,
        [id, ws, name, isCategory(sub.CATEGORY) ? sub.CATEGORY : "subscriptions", groupId && liveGroupIds.has(groupId) ? groupId : null, amount, cadence,
         day !== null && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null, moy !== null && Number.isInteger(moy) && moy >= 1 && moy <= 12 ? moy : null,
         status, str(sub.STATUS_CHANGED_AT), str(sub.NOTES), str(sub.CANCEL_URL), str(sub.TRIAL_ENDS)],
      );
      stats.subscriptions++;
    }
    const memberIds = new Set(tx.all<{ USER_ID: string }>("SELECT USER_ID FROM WORKSPACE_MEMBER WHERE WORKSPACE_ID = ?", [ws]).map((r) => r.USER_ID));
    const liveSubIds = new Set(
      tx.all<{ ID: string }>("SELECT ID FROM SUBSCRIPTION WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]).map((r) => r.ID),
    );

    for (const pd of paydays) {
      if (!isObj(pd)) continue;
      const id = str(pd.ID);
      const label = str(pd.LABEL);
      const amount = num(pd.AMOUNT);
      const cadence = str(pd.CADENCE) ?? "monthly";
      if (!id || !UUID_RE.test(id) || !label || amount === null || amount <= 0 || !(PAYDAY_CADENCES as readonly string[]).includes(cadence)) continue;
      if (foreign(tx, ws, "PAYDAY", id)) continue;
      const day = num(pd.DAY);
      tx.run(
        `INSERT INTO PAYDAY (ID, WORKSPACE_ID, LABEL, AMOUNT, CADENCE, DAY, START_DATE) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET LABEL = excluded.LABEL, AMOUNT = excluded.AMOUNT, CADENCE = excluded.CADENCE, DAY = excluded.DAY, START_DATE = excluded.START_DATE, DELETED_AT = NULL`,
        [id, ws, label, amount, cadence, day !== null && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null, str(pd.START_DATE)],
      );
      stats.paydays++;
    }
    for (const c of checkpoints) {
      if (!isObj(c)) continue;
      const id = str(c.ID);
      const date = str(c.DATE);
      const amount = num(c.AMOUNT);
      if (!id || !UUID_RE.test(id) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || amount === null) continue;
      if (foreign(tx, ws, "BALANCE_CHECKPOINT", id)) continue;
      tx.run(
        "INSERT INTO BALANCE_CHECKPOINT (ID, WORKSPACE_ID, DATE, AMOUNT, NOTE) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ID) DO UPDATE SET DATE = excluded.DATE, AMOUNT = excluded.AMOUNT, NOTE = excluded.NOTE",
        [id, ws, date, amount, str(c.NOTE)],
      );
      stats.balance_checkpoints++;
    }

    for (const a of accounts) {
      if (!isObj(a)) continue;
      const id = str(a.ID);
      const name = str(a.NAME);
      const type = str(a.TYPE) ?? "cash";
      if (!id || !UUID_RE.test(id) || !name || !(ACCOUNT_TYPES as readonly string[]).includes(type)) continue;
      if (foreign(tx, ws, "ACCOUNT", id)) continue;
      tx.run(
        `INSERT INTO ACCOUNT (ID, WORKSPACE_ID, NAME, TYPE, SORT_ORDER) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET NAME = excluded.NAME, TYPE = excluded.TYPE, SORT_ORDER = excluded.SORT_ORDER, DELETED_AT = NULL`,
        [id, ws, name, type, num(a.SORT_ORDER) ?? 0],
      );
      stats.accounts++;
    }
    const liveAccountIds = new Set(
      tx.all<{ ID: string }>("SELECT ID FROM ACCOUNT WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]).map((r) => r.ID),
    );
    for (const sn of accountSnapshots) {
      if (!isObj(sn)) continue;
      const id = str(sn.ID);
      const accountId = str(sn.ACCOUNT_ID);
      const month = str(sn.MONTH);
      const balance = num(sn.BALANCE);
      if (!id || !UUID_RE.test(id) || !accountId || !liveAccountIds.has(accountId) || !month || !MONTH_RE.test(month) || balance === null) continue;
      if (foreign(tx, ws, "ACCOUNT_SNAPSHOT", id)) continue;
      // The (ACCOUNT_ID, MONTH) pair is the real key: a restored row wins over whatever is there.
      tx.run("DELETE FROM ACCOUNT_SNAPSHOT WHERE ACCOUNT_ID = ? AND MONTH = ? AND ID != ?", [accountId, month, id]);
      tx.run(
        `INSERT INTO ACCOUNT_SNAPSHOT (ID, WORKSPACE_ID, ACCOUNT_ID, MONTH, BALANCE) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET ACCOUNT_ID = excluded.ACCOUNT_ID, MONTH = excluded.MONTH, BALANCE = excluded.BALANCE`,
        [id, ws, accountId, month, balance],
      );
      stats.account_snapshots++;
    }

    for (const l of planLines) {
      if (!isObj(l)) continue;
      const id = str(l.ID);
      const month = str(l.MONTH);
      const label = str(l.LABEL);
      const kind = str(l.KIND) ?? "expense";
      const planned = num(l.PLANNED);
      if (!id || !UUID_RE.test(id) || !month || !MONTH_RE.test(month) || !label || planned === null || planned < 0) continue;
      if (!(PLAN_KINDS as readonly string[]).includes(kind)) continue;
      if (foreign(tx, ws, "PLAN_LINE", id)) continue;
      const groupId = str(l.GROUP_ID);
      const subId = str(l.SUBSCRIPTION_ID);
      tx.run(
        `INSERT INTO PLAN_LINE (ID, WORKSPACE_ID, MONTH, KIND, CATEGORY, GROUP_ID, LABEL, PLANNED, SORT_ORDER, SUBSCRIPTION_ID)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET MONTH = excluded.MONTH, KIND = excluded.KIND, CATEGORY = excluded.CATEGORY, GROUP_ID = excluded.GROUP_ID,
           LABEL = excluded.LABEL, PLANNED = excluded.PLANNED, SORT_ORDER = excluded.SORT_ORDER, SUBSCRIPTION_ID = excluded.SUBSCRIPTION_ID, DELETED_AT = NULL`,
        [id, ws, month, kind, isCategory(l.CATEGORY) ? l.CATEGORY : "other", groupId && liveGroupIds.has(groupId) ? groupId : null, label, planned,
         num(l.SORT_ORDER) ?? 0, subId && liveSubIds.has(subId) ? subId : null],
      );
      stats.plan_lines++;
    }

    for (const b of budgets) {
      if (!isObj(b)) continue;
      const category = str(b.CATEGORY);
      const amount = num(b.AMOUNT);
      if (!category || (category !== "_total" && !isCategory(category)) || amount === null || amount <= 0) continue;
      tx.run(
        "INSERT INTO BUDGET (WORKSPACE_ID, CATEGORY, AMOUNT) VALUES (?, ?, ?) ON CONFLICT(WORKSPACE_ID, CATEGORY) DO UPDATE SET AMOUNT = excluded.AMOUNT",
        [ws, category, amount],
      );
      stats.budgets++;
    }

    for (const h of budgetHistory) {
      if (!isObj(h)) continue;
      const month = str(h.MONTH);
      const category = str(h.CATEGORY);
      const amount = num(h.AMOUNT);
      if (!month || !MONTH_RE.test(month) || !category || (category !== "_total" && !isCategory(category)) || amount === null || amount <= 0) continue;
      tx.run(
        "INSERT INTO BUDGET_HISTORY (WORKSPACE_ID, MONTH, CATEGORY, AMOUNT) VALUES (?, ?, ?, ?) ON CONFLICT(WORKSPACE_ID, MONTH, CATEGORY) DO UPDATE SET AMOUNT = excluded.AMOUNT",
        [ws, month, category, amount],
      );
      stats.budget_history++;
    }

    for (const p of patterns) {
      if (!isObj(p)) continue;
      const id = str(p.ID);
      const pattern = str(p.PATTERN);
      const category = str(p.CATEGORY);
      if (!id || !UUID_RE.test(id) || !pattern || !isCategory(category)) continue;
      const groupId = str(p.GROUP_ID);
      if (foreign(tx, ws, "IMPORT_PATTERN", id)) continue;
      const rec = num(p.SET_RECURRING);
      tx.run(
        `INSERT INTO IMPORT_PATTERN (ID, WORKSPACE_ID, PATTERN, CATEGORY, GROUP_ID, PRIORITY, SET_NAME, SET_TAGS, SET_RECURRING, AMOUNT_MIN, AMOUNT_MAX) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET PATTERN = excluded.PATTERN, CATEGORY = excluded.CATEGORY,
           GROUP_ID = excluded.GROUP_ID, PRIORITY = excluded.PRIORITY, SET_NAME = excluded.SET_NAME, SET_TAGS = excluded.SET_TAGS,
           SET_RECURRING = excluded.SET_RECURRING, AMOUNT_MIN = excluded.AMOUNT_MIN, AMOUNT_MAX = excluded.AMOUNT_MAX`,
        [id, ws, pattern, category, groupId && liveGroupIds.has(groupId) ? groupId : null, num(p.PRIORITY) ?? 0,
         str(p.SET_NAME), str(p.SET_TAGS), rec === 1 ? 1 : rec === 0 ? 0 : null, num(p.AMOUNT_MIN), num(p.AMOUNT_MAX)],
      );
      stats.patterns++;
    }

    for (const e of expenses) {
      if (!isObj(e)) { stats.skipped++; continue; }
      const name = str(e.NAME);
      const amount = num(e.AMOUNT);
      const month = str(e.MONTH);
      if (!name || amount === null || amount <= 0 || !month || !MONTH_RE.test(month)) { stats.skipped++; continue; }

      const givenId = str(e.ID);
      let id = givenId && UUID_RE.test(givenId) ? givenId : randomUUID();
      // A row id that belongs to another workspace (restoring someone else's
      // backup into your own) gets a fresh id instead of being hijacked.
      if (foreign(tx, ws, "LEDGER", id)) id = randomUUID();
      const groupId = str(e.GROUP_ID);
      const exists = tx.all("SELECT 1 FROM LEDGER WHERE ID = ?", [id]).length > 0;
      const rawDay = num(e.DAY);
      const day = rawDay !== null && Number.isInteger(rawDay) && rawDay >= 1 && rawDay <= 31 ? rawDay : null;
      const tags = str(e.TAGS);
      const goalId = str(e.GOAL_ID);
      const subId = str(e.SUBSCRIPTION_ID);
      const splitGroup = str(e.SPLIT_GROUP);
      const paidBy = str(e.PAID_BY);
      // Older files have no EXTERNAL_ID: keep whatever the row has. A bank id
      // already owned by a different row stays with that row (unique index).
      const hasExternal = "EXTERNAL_ID" in e;
      let externalId = str(e.EXTERNAL_ID);
      if (externalId && tx.all("SELECT 1 FROM LEDGER WHERE WORKSPACE_ID = ? AND EXTERNAL_ID = ? AND ID <> ?", [ws, externalId, id]).length > 0) externalId = null;

      tx.run(
        `INSERT INTO LEDGER (ID, WORKSPACE_ID, KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, DAY, GOAL_ID, SUBSCRIPTION_ID, SPLIT_GROUP, PAID_BY, NOTES, IS_RECURRING, TAGS, EXTERNAL_ID)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET KIND = excluded.KIND, CATEGORY = excluded.CATEGORY, GROUP_ID = excluded.GROUP_ID,
           NAME = excluded.NAME, AMOUNT = excluded.AMOUNT, MONTH = excluded.MONTH, DAY = excluded.DAY, GOAL_ID = excluded.GOAL_ID,
           SUBSCRIPTION_ID = excluded.SUBSCRIPTION_ID, SPLIT_GROUP = excluded.SPLIT_GROUP, PAID_BY = excluded.PAID_BY, NOTES = excluded.NOTES, IS_RECURRING = excluded.IS_RECURRING, TAGS = excluded.TAGS,
           EXTERNAL_ID = CASE WHEN ? = 1 THEN excluded.EXTERNAL_ID ELSE LEDGER.EXTERNAL_ID END, DELETED_AT = NULL`,
        [
          id,
          ws,
          e.KIND === "income" ? "income" : "expense",
          isCategory(e.CATEGORY) ? e.CATEGORY : "other",
          groupId && liveGroupIds.has(groupId) ? groupId : null,
          name,
          amount,
          month,
          day,
          goalId && liveGoalIds.has(goalId) ? goalId : null,
          subId && liveSubIds.has(subId) ? subId : null,
          splitGroup && UUID_RE.test(splitGroup) ? splitGroup : null,
          paidBy && memberIds.has(paidBy) ? paidBy : null,
          str(e.NOTES),
          num(e.IS_RECURRING) ? 1 : 0,
          tags,
          externalId,
          hasExternal ? 1 : 0,
        ],
      );
      syncTags(tx, id, tags);
      if (exists) stats.updated++;
      else stats.imported++;
    }
    // Recurring rows from older backups (or without a live subscription) get linked now.
    backfillSubscriptions(tx, currentMonth(), randomUUID);
    return stats;
  });

  revalidatePath("/");
  return NextResponse.json(result);
}
