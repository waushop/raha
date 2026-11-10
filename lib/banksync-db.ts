// Bank sync, the database side: pull transactions and balances for a
// connection's enabled accounts, reconcile them against the ledger in one
// transaction per account, record the balance for cash flow / net worth,
// and keep the connection's status honest. Never throws for an API problem:
// the error lands in BANK_CONNECTION.LAST_ERROR instead.
import { randomUUID } from "node:crypto";
import db, { type Tx } from "./db";
import { getBankApi, isSessionGone, type BankApi, type BankTransaction } from "./enablebanking";
import { categorize, isOwnTransfer, mapTransactions, normalizeIban, pickBalance, reconcile, syncWindowStart, transferNameKey, type ExistingRow, type MappedTx } from "./banksync";
import { insertRow, auditedUpdate, billMatchKey, learnedBills, loadRules, markTransfer, payBills, rememberBillMatch } from "./ledger";
import { TRAINING_ROWS_SQL, train } from "./classifier";
import { currentMonth } from "./months";

export type BankConnectionRow = {
  ID: string;
  WORKSPACE_ID: string;
  USER_ID: string;
  ASPSP_NAME: string;
  COUNTRY: string;
  SESSION_ID: string | null;
  VALID_UNTIL: string | null;
  STATUS: "pending" | "active" | "expired" | "error" | "revoked";
  LAST_SYNC_AT: string | null;
  LAST_ERROR: string | null;
  CREATED_AT: string;
};

export type BankAccountRow = {
  ID: string;
  CONNECTION_ID: string;
  UID: string;
  IBAN: string | null;
  NAME: string | null;
  CURRENCY: string | null;
  ENABLED: number;
  SYNC_FROM: string | null;
  LAST_BOOKING_DATE: string | null;
  NETWORTH_ACCOUNT_ID: string | null;
  CREATED_AT: string;
};

export type SyncResult = { inserted: number; linked: number; skipped: number; pending: number; transfers: number; accounts: number; error: string | null };

const CONNECTION_COLUMNS = "ID, WORKSPACE_ID, USER_ID, ASPSP_NAME, COUNTRY, SESSION_ID, VALID_UNTIL, STATUS, LAST_SYNC_AT, LAST_ERROR, CREATED_AT";
const ACCOUNT_COLUMNS = "ID, CONNECTION_ID, UID, IBAN, NAME, CURRENCY, ENABLED, SYNC_FROM, LAST_BOOKING_DATE, NETWORTH_ACCOUNT_ID, CREATED_AT";
const MAX_PAGES = 50;

const isoToday = (): string => new Date().toISOString().slice(0, 10);
const nowSql = (): string => new Date().toISOString().slice(0, 19).replace("T", " ");

export async function listConnections(ws: string): Promise<BankConnectionRow[]> {
  const [rows] = await db.execute(`SELECT ${CONNECTION_COLUMNS} FROM BANK_CONNECTION WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL AND STATUS <> 'pending' ORDER BY CREATED_AT`, [ws]);
  return rows as BankConnectionRow[];
}

export async function listBankAccounts(ws: string): Promise<BankAccountRow[]> {
  const [rows] = await db.execute(`SELECT ${ACCOUNT_COLUMNS} FROM BANK_ACCOUNT WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY CREATED_AT`, [ws]);
  return rows as BankAccountRow[];
}

export async function getConnection(ws: string, id: string): Promise<BankConnectionRow | null> {
  const [rows] = await db.execute(`SELECT ${CONNECTION_COLUMNS} FROM BANK_CONNECTION WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL`, [id, ws]);
  return (rows as BankConnectionRow[])[0] ?? null;
}

/** When the workspace's newest successful bank sync ran (for the dashboard), or null without connections. */
export async function lastBankSync(ws: string): Promise<{ at: string | null; hoursAgo: number | null } | null> {
  const [rows] = await db.execute(
    "SELECT MAX(LAST_SYNC_AT) AS AT, COUNT(*) AS N FROM BANK_CONNECTION WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL AND STATUS IN ('active', 'error', 'expired')", [ws],
  );
  const r = (rows as { AT: string | null; N: number }[])[0];
  if (!r || r.N === 0) return null;
  const at = r.AT ? Date.parse(`${r.AT.replace(" ", "T")}Z`) : NaN;
  return { at: r.AT, hoursAgo: Number.isFinite(at) ? Math.max(0, Math.floor((Date.now() - at) / 3_600_000)) : null };
}

async function fetchAll(api: BankApi, uid: string, dateFrom: string): Promise<BankTransaction[]> {
  const out: BankTransaction[] = [];
  let key: string | null | undefined = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await api.getTransactions(uid, { dateFrom, continuationKey: key });
    out.push(...(r.transactions ?? []));
    key = r.continuation_key;
    if (!key) break;
  }
  return out;
}

/** Ledger rows the reconciler needs: live hand-entered rows in the window's months, and every row (even deleted) that carries a bank id. */
function existingRows(tx: Tx, ws: string, fromMonth: string, toMonth: string): ExistingRow[] {
  return tx.all<{ ID: string; MONTH: string; DAY: number | null; AMOUNT: number; KIND: ExistingRow["KIND"]; EXTERNAL_ID: string | null; DELETED: number }>(
    `SELECT ID, MONTH, DAY, CAST(AMOUNT AS REAL) AS AMOUNT, KIND, EXTERNAL_ID, CASE WHEN DELETED_AT IS NULL THEN 0 ELSE 1 END AS DELETED
     FROM LEDGER WHERE WORKSPACE_ID = ?
       AND (EXTERNAL_ID IS NOT NULL OR (DELETED_AT IS NULL AND MONTH >= ? AND MONTH <= ?))`,
    [ws, fromMonth, toMonth],
  ).map((r) => ({ ...r, DELETED: r.DELETED === 1 }));
}

/**
 * What tells a transfer apart in this workspace: the IBANs of every connected
 * account, and the counterparties the user marked as transfers before, keyed
 * by direction (a lender's payout is a transfer; repaying it is spending).
 */
function transferContext(tx: Tx, ws: string): { ibans: Set<string>; names: Set<string> } {
  const ibans = new Set(
    tx.all<{ IBAN: string | null }>("SELECT IBAN FROM BANK_ACCOUNT WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws])
      .map((r) => normalizeIban(r.IBAN)).filter((i): i is string => !!i),
  );
  const names = new Set(
    tx.all<{ NAME: string; OUT: number }>("SELECT NAME, AMOUNT < 0 AS OUT FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'transfer' AND DELETED_AT IS NULL", [ws])
      .map((r) => `${r.OUT ? "expense" : "income"}:${transferNameKey(r.NAME)}`),
  );
  return { ibans, names };
}

const transferCheck = (ctx: { ibans: Set<string>; names: Set<string> }, t: MappedTx) =>
  isOwnTransfer(t, ctx.ibans, new Set([...ctx.names].filter((n) => n.startsWith(`${t.kind}:`)).map((n) => n.slice(t.kind.length + 1))));

/** Applies one account's transactions to the ledger. Synchronous: call inside db.transaction. */
export function applyTransactions(tx: Tx, ws: string, txs: BankTransaction[]): Omit<SyncResult, "accounts" | "error"> & { lastBooking: string | null } {
  const mapped = mapTransactions(txs);
  const result = { inserted: 0, linked: 0, skipped: 0, pending: 0, transfers: 0, lastBooking: null as string | null };
  if (mapped.length === 0) return result;
  const months = mapped.map((m) => m.month).sort();
  const decisions = reconcile(mapped, existingRows(tx, ws, months[0], months[months.length - 1]));
  const rules = loadRules(tx, ws);
  const transfers = transferContext(tx, ws);
  let model: ReturnType<typeof train> | null = null;
  for (const d of decisions) {
    if (d.action !== "pending" && (!result.lastBooking || d.tx.date > result.lastBooking)) result.lastBooking = d.tx.date;
    if (d.action === "pending") { result.pending++; continue; }
    if (d.action === "skip") {
      // A line sync filed as income/spending that turns out to be a transfer
      // (and nobody has touched since) is corrected on the next pass.
      if (d.rowId && transferCheck(transfers, d.tx) && tx.all(
        `SELECT 1 FROM LEDGER L WHERE L.ID = ? AND L.FEED_ONLY = 1 AND L.KIND <> 'transfer' AND L.DELETED_AT IS NULL
           AND NOT EXISTS (SELECT 1 FROM LEDGER_AUDIT A WHERE A.LEDGER_ID = L.ID AND A.ACTION = 'update')`, [d.rowId],
      ).length > 0) {
        markTransfer(tx, ws, d.rowId, true);
        result.transfers++;
      }
      result.skipped++;
      continue;
    }
    if (transferCheck(transfers, d.tx)) {
      insertRow(tx, ws, {
        KIND: "transfer", CATEGORY: "other", GROUP_ID: null, NAME: d.tx.merchant.slice(0, 120),
        AMOUNT: d.tx.kind === "expense" ? -d.tx.amount : d.tx.amount,
        NOTES: `Bank: ${d.tx.rawText}`.slice(0, 1000), IS_RECURRING: 0, TAGS: null, DAY: d.tx.day,
        EXTERNAL_ID: d.tx.externalId, FEED_ONLY: 1,
      }, d.tx.month);
      result.inserted++;
      result.transfers++;
      continue;
    }
    if (d.action === "link") {
      auditedUpdate(tx, d.rowId, "update", () => {
        tx.run("UPDATE LEDGER SET EXTERNAL_ID = ?, DAY = COALESCE(DAY, ?) WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [d.tx.externalId, d.tx.day, d.rowId, ws]);
      });
      const bill = tx.all<{ NAME: string; FEED_ONLY: number }>("SELECT NAME, FEED_ONLY FROM LEDGER WHERE ID = ?", [d.rowId])[0];
      if (bill && bill.FEED_ONLY === 0) rememberBillMatch(tx, ws, billMatchKey(d.tx.rawText), d.tx.kind, bill.NAME);
      result.linked++;
      continue;
    }
    // Train lazily: only when something new needs a category.
    model ??= train(
      tx.all<{ NAME: string; CATEGORY: string; GROUP_ID: string | null }>(TRAINING_ROWS_SQL, [ws])
        .map((r) => ({ name: r.NAME, category: r.CATEGORY, groupId: r.GROUP_ID })),
    );
    const c = categorize(d.tx, rules, model);
    const ownGroup = c.groupId && tx.all("SELECT 1 FROM CATEGORY_GROUP WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [c.groupId, ws]).length > 0 ? c.groupId : null;
    const lineId = insertRow(tx, ws, {
      KIND: d.tx.kind,
      CATEGORY: c.category,
      GROUP_ID: ownGroup,
      NAME: c.name.slice(0, 120),
      AMOUNT: d.tx.amount,
      NOTES: `Bank: ${d.tx.rawText}`.slice(0, 1000),
      IS_RECURRING: c.isRecurring ? 1 : 0,
      TAGS: c.tags,
      DAY: d.tx.day,
      EXTERNAL_ID: d.tx.externalId,
      FEED_ONLY: 1,
    }, d.tx.month);
    // A merchant matched to a bill before pays this month's open bill of that name, whatever the amount.
    const billIds = learnedBills(tx, ws, billMatchKey(d.tx.rawText), d.tx.kind, d.tx.month);
    if (billIds.length > 0) { payBills(tx, ws, billIds, lineId); result.linked++; continue; }
    result.inserted++;
  }
  return result;
}

const running = new Set<string>();

function markError(ws: string, id: string, message: string, expired: boolean): void {
  db.transaction((tx) => {
    tx.run("UPDATE BANK_CONNECTION SET STATUS = ?, LAST_ERROR = ? WHERE ID = ? AND WORKSPACE_ID = ?", [expired ? "expired" : "error", message.slice(0, 500), id, ws]);
  });
}

/** Records the main account's balance for cash flow (one checkpoint per day, overwritten by later syncs). */
function writeCheckpoint(tx: Tx, ws: string, amount: number, label: string): void {
  const today = isoToday();
  const note = `Bank sync: ${label}`.slice(0, 120);
  const hit = tx.run("UPDATE BALANCE_CHECKPOINT SET AMOUNT = ? WHERE WORKSPACE_ID = ? AND DATE = ? AND NOTE = ?", [amount, ws, today, note]);
  if (hit.affectedRows === 0) tx.run("INSERT INTO BALANCE_CHECKPOINT (ID, WORKSPACE_ID, DATE, AMOUNT, NOTE) VALUES (?, ?, ?, ?, ?)", [randomUUID(), ws, today, amount, note]);
}

function writeSnapshot(tx: Tx, ws: string, accountId: string, balance: number): void {
  if (tx.all("SELECT 1 FROM ACCOUNT WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [accountId, ws]).length === 0) return;
  tx.run(
    `INSERT INTO ACCOUNT_SNAPSHOT (ID, WORKSPACE_ID, ACCOUNT_ID, MONTH, BALANCE) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ACCOUNT_ID, MONTH) DO UPDATE SET BALANCE = excluded.BALANCE`,
    [randomUUID(), ws, accountId, currentMonth(), balance],
  );
}

/** The workspace's main bank account: the oldest enabled one on a live connection. */
async function mainAccountId(ws: string): Promise<string | null> {
  const [rows] = await db.execute(
    `SELECT a.ID FROM BANK_ACCOUNT a JOIN BANK_CONNECTION c ON c.ID = a.CONNECTION_ID AND c.DELETED_AT IS NULL AND c.STATUS IN ('active', 'error')
     WHERE a.WORKSPACE_ID = ? AND a.DELETED_AT IS NULL AND a.ENABLED = 1 ORDER BY c.CREATED_AT, a.CREATED_AT LIMIT 1`, [ws],
  );
  return (rows as { ID: string }[])[0]?.ID ?? null;
}

/**
 * Syncs one connection: every enabled account's transactions since
 * max(SYNC_FROM, LAST_BOOKING_DATE − 5 days), then balances. Returns what
 * happened; on failure the error is stored on the connection and returned.
 */
export async function syncConnection(ws: string, connectionId: string, api: BankApi | null = getBankApi()): Promise<SyncResult> {
  const total: SyncResult = { inserted: 0, linked: 0, skipped: 0, pending: 0, transfers: 0, accounts: 0, error: null };
  const conn = await getConnection(ws, connectionId);
  if (!conn || !conn.SESSION_ID || conn.STATUS === "revoked" || conn.STATUS === "pending") return { ...total, error: "Connection is not active" };
  if (conn.VALID_UNTIL && Date.parse(conn.VALID_UNTIL) <= Date.now()) {
    markError(ws, conn.ID, "Bank consent expired — reconnect to keep syncing", true);
    return { ...total, error: "Bank consent expired" };
  }
  if (!api) return { ...total, error: "Bank sync is not configured" };
  if (running.has(conn.ID)) return { ...total, error: "A sync is already running" };
  running.add(conn.ID);
  try {
    const accounts = (await listBankAccounts(ws)).filter((a) => a.CONNECTION_ID === conn.ID && a.ENABLED === 1);
    const main = await mainAccountId(ws);
    const today = isoToday();
    for (const a of accounts) {
      const txs = await fetchAll(api, a.UID, syncWindowStart(a.SYNC_FROM, a.LAST_BOOKING_DATE, today));
      const balances = await api.getBalances(a.UID).catch(() => []);
      const balance = pickBalance(balances);
      db.transaction((tx) => {
        const r = applyTransactions(tx, ws, txs);
        total.inserted += r.inserted;
        total.linked += r.linked;
        total.skipped += r.skipped;
        total.pending += r.pending;
        total.transfers += r.transfers;
        tx.run(
          "UPDATE BANK_ACCOUNT SET LAST_BOOKING_DATE = CASE WHEN LAST_BOOKING_DATE IS NULL OR LAST_BOOKING_DATE < ? THEN ? ELSE LAST_BOOKING_DATE END WHERE ID = ? AND WORKSPACE_ID = ?",
          [r.lastBooking ?? "", r.lastBooking, a.ID, ws],
        );
        if (balance) {
          if (a.ID === main) writeCheckpoint(tx, ws, balance.amount, a.NAME || conn.ASPSP_NAME);
          if (a.NETWORTH_ACCOUNT_ID) writeSnapshot(tx, ws, a.NETWORTH_ACCOUNT_ID, balance.amount);
        }
      });
      total.accounts++;
    }
    db.transaction((tx) => {
      tx.run("UPDATE BANK_CONNECTION SET STATUS = 'active', LAST_ERROR = NULL, LAST_SYNC_AT = ? WHERE ID = ? AND WORKSPACE_ID = ?", [nowSql(), conn.ID, ws]);
    });
    return total;
  } catch (e) {
    const message = (e as Error).message || "Sync failed";
    markError(ws, conn.ID, isSessionGone(e) ? "The bank ended this consent — reconnect to keep syncing" : message, isSessionGone(e));
    return { ...total, error: message };
  } finally {
    running.delete(conn.ID);
  }
}

/** Every live connection (scheduler). Connections whose consent ran out are marked expired. */
export async function syncAll(minMinutesBetween = 0): Promise<{ connections: number; inserted: number; transfers: number; failed: number; errors: string[] }> {
  const cutoff = new Date(Date.now() - minMinutesBetween * 60_000).toISOString().slice(0, 19).replace("T", " ");
  const [rows] = await db.execute(
    `SELECT ID, WORKSPACE_ID, ASPSP_NAME FROM BANK_CONNECTION WHERE DELETED_AT IS NULL AND STATUS IN ('active', 'error') AND SESSION_ID IS NOT NULL
       AND (LAST_ATTEMPT_AT IS NULL OR LAST_ATTEMPT_AT <= ?)`, [cutoff],
  );
  const api = getBankApi();
  const out = { connections: 0, inserted: 0, transfers: 0, failed: 0, errors: [] as string[] };
  for (const r of rows as { ID: string; WORKSPACE_ID: string; ASPSP_NAME: string }[]) {
    db.transaction((tx) => { tx.run("UPDATE BANK_CONNECTION SET LAST_ATTEMPT_AT = ? WHERE ID = ?", [nowSql(), r.ID]); });
    const res = await syncConnection(r.WORKSPACE_ID, r.ID, api);
    out.connections++;
    out.inserted += res.inserted;
    out.transfers += res.transfers;
    if (res.error) { out.failed++; out.errors.push(`${r.ASPSP_NAME}: ${res.error}`.slice(0, 200)); }
  }
  return out;
}

/** Inputs for the bank nudges (lib/nudges.ts). */
export async function bankNudgeInputs(ws: string): Promise<Array<{ id: string; name: string; status: string; validUntil: string | null; lastError: string | null; lastSyncAt: string | null }>> {
  const list = await listConnections(ws);
  return list.filter((c) => c.STATUS !== "revoked").map((c) => ({ id: c.ID, name: c.ASPSP_NAME, status: c.STATUS, validUntil: c.VALID_UNTIL, lastError: c.LAST_ERROR, lastSyncAt: c.LAST_SYNC_AT }));
}
