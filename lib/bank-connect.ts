// Connecting a bank: the auth round-trip with Enable Banking.
//   beginAuth    → a BANK_CONNECTION (new, or the existing one for that bank
//                  when reconnecting) gets a fresh random STATE; POST /auth
//                  returns the bank's URL to send the user to.
//   completeAuth → the callback finds the connection by STATE (must belong to
//                  a workspace the user is a member of and be < 1 h old),
//                  POST /sessions, stores the accounts, clears STATE.
import { randomBytes, randomUUID } from "node:crypto";
import db from "./db";
import { ValidationError } from "./validate";
import { getBankApi, type BankApi, type BankAccountResource } from "./enablebanking";

const STATE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_VALIDITY_DAYS = 90;
const MAX_VALIDITY_DAYS = 180;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** First day of last month: a new account starts there so the current month fills in without re-importing old history. */
export function defaultSyncFrom(now = new Date()): string {
  return isoDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
}

export async function beginAuth(
  ctx: { workspaceId: string; userId: string },
  aspsp: { name: string; country: string },
  redirectUrl: string,
  reconnectId: string | null = null,
  api: BankApi | null = getBankApi(),
): Promise<{ url: string; connectionId: string }> {
  if (!api) throw new ValidationError("Bank sync is not configured");
  const ws = ctx.workspaceId;
  // Old abandoned round-trips are dropped.
  await db.execute("UPDATE BANK_CONNECTION SET DELETED_AT = CURRENT_TIMESTAMP, STATE = NULL WHERE WORKSPACE_ID = ? AND STATUS = 'pending' AND DELETED_AT IS NULL AND CREATED_AT < datetime('now', '-1 day')", [ws]);

  const [existing] = reconnectId
    ? await db.execute("SELECT ID, ASPSP_NAME, COUNTRY FROM BANK_CONNECTION WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [reconnectId, ws])
    : await db.execute(
        "SELECT ID, ASPSP_NAME, COUNTRY FROM BANK_CONNECTION WHERE WORKSPACE_ID = ? AND ASPSP_NAME = ? AND COUNTRY = ? AND STATUS <> 'pending' AND DELETED_AT IS NULL ORDER BY CREATED_AT DESC LIMIT 1",
        [ws, aspsp.name, aspsp.country],
      );
  const found = (existing as { ID: string; ASPSP_NAME: string; COUNTRY: string }[])[0];
  if (reconnectId && !found) throw new ValidationError("That connection no longer exists");
  const target = found ? { name: found.ASPSP_NAME, country: found.COUNTRY } : aspsp;

  // Ask for as long as the bank allows (capped at 180 days).
  let days = DEFAULT_VALIDITY_DAYS;
  try {
    const max = (await api.listAspsps(target.country)).find((a) => a.name === target.name)?.maximum_consent_validity;
    if (max && max > 0) days = Math.min(MAX_VALIDITY_DAYS, Math.floor(max / 86400));
  } catch { /* keep the default */ }
  const validUntil = new Date(Date.now() + days * 86_400_000).toISOString();

  const state = randomBytes(24).toString("base64url");
  let connectionId: string;
  let created = false;
  if (found) {
    connectionId = found.ID;
    await db.execute("UPDATE BANK_CONNECTION SET STATE = ?, USER_ID = ? WHERE ID = ? AND WORKSPACE_ID = ?", [state, ctx.userId, connectionId, ws]);
  } else {
    connectionId = randomUUID();
    created = true;
    await db.execute(
      "INSERT INTO BANK_CONNECTION (ID, WORKSPACE_ID, USER_ID, ASPSP_NAME, COUNTRY, STATUS, STATE) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      [connectionId, ws, ctx.userId, target.name, target.country, state],
    );
  }
  try {
    const r = await api.startAuth({ aspsp: target, state, redirectUrl, validUntil, psuType: "personal" });
    return { url: r.url, connectionId };
  } catch (e) {
    if (created) await db.execute("UPDATE BANK_CONNECTION SET DELETED_AT = CURRENT_TIMESTAMP, STATE = NULL WHERE ID = ? AND WORKSPACE_ID = ?", [connectionId, ws]);
    else await db.execute("UPDATE BANK_CONNECTION SET STATE = NULL WHERE ID = ? AND WORKSPACE_ID = ?", [connectionId, ws]);
    throw new ValidationError(`The bank could not be reached: ${(e as Error).message}`);
  }
}

type PendingConnection = { ID: string; WORKSPACE_ID: string; SESSION_ID: string | null; UPDATED_AT: string; STATUS: string };

/** The connection waiting for this STATE, if the user may finish it. */
export async function findPending(userId: string, state: string): Promise<PendingConnection | null> {
  if (!state || state.length > 200) return null;
  const [rows] = await db.execute(
    `SELECT c.ID, c.WORKSPACE_ID, c.SESSION_ID, c.UPDATED_AT, c.STATUS FROM BANK_CONNECTION c
     JOIN WORKSPACE_MEMBER m ON m.WORKSPACE_ID = c.WORKSPACE_ID AND m.USER_ID = ?
     WHERE c.STATE = ? AND c.DELETED_AT IS NULL`,
    [userId, state],
  );
  const row = (rows as PendingConnection[])[0];
  if (!row) return null;
  const updated = Date.parse(`${row.UPDATED_AT.replace(" ", "T")}Z`);
  if (!Number.isFinite(updated) || Date.now() - updated > STATE_TTL_MS) return null;
  return row;
}

/** The bank said no (user cancelled, consent refused): forget the round-trip. */
export async function failAuth(conn: PendingConnection, message: string): Promise<void> {
  if (conn.STATUS === "pending") {
    await db.execute("UPDATE BANK_CONNECTION SET DELETED_AT = CURRENT_TIMESTAMP, STATE = NULL WHERE ID = ?", [conn.ID]);
  } else {
    await db.execute("UPDATE BANK_CONNECTION SET STATE = NULL, LAST_ERROR = ? WHERE ID = ?", [message.slice(0, 500), conn.ID]);
  }
}

const ibanOf = (a: BankAccountResource): string | null => a.account_id?.iban?.replace(/\s+/g, "") || null;

/** Exchanges the code for a session and stores its accounts. Returns the connection id. */
export async function completeAuth(conn: PendingConnection, code: string, api: BankApi | null = getBankApi()): Promise<string> {
  if (!api) throw new ValidationError("Bank sync is not configured");
  const session = await api.createSession(code);
  const ws = conn.WORKSPACE_ID;
  const oldSession = conn.SESSION_ID;
  db.transaction((tx) => {
    tx.run(
      `UPDATE BANK_CONNECTION SET SESSION_ID = ?, VALID_UNTIL = ?, STATUS = 'active', STATE = NULL, LAST_ERROR = NULL,
         ASPSP_NAME = COALESCE(?, ASPSP_NAME), COUNTRY = COALESCE(?, COUNTRY) WHERE ID = ? AND WORKSPACE_ID = ?`,
      [session.session_id, session.access?.valid_until ?? null, session.aspsp?.name ?? null, session.aspsp?.country ?? null, conn.ID, ws],
    );
    const current = tx.all<{ ID: string; UID: string; IBAN: string | null; NAME: string | null; CURRENCY: string | null }>(
      "SELECT ID, UID, IBAN, NAME, CURRENCY FROM BANK_ACCOUNT WHERE WORKSPACE_ID = ? AND CONNECTION_ID = ? AND DELETED_AT IS NULL", [ws, conn.ID],
    );
    const kept = new Set<string>();
    for (const a of session.accounts ?? []) {
      const iban = ibanOf(a);
      // Account uids are per session: match a reconnect by IBAN (or name + currency).
      const match = current.find((c) => !kept.has(c.ID) && (c.UID === a.uid || (iban && c.IBAN === iban) || (!iban && !c.IBAN && c.NAME === (a.name ?? null) && c.CURRENCY === (a.currency ?? null))));
      if (match) {
        kept.add(match.ID);
        tx.run("UPDATE BANK_ACCOUNT SET UID = ?, IBAN = ?, NAME = ?, CURRENCY = ? WHERE ID = ?", [a.uid, iban, a.name ?? a.product ?? null, a.currency ?? null, match.ID]);
        continue;
      }
      // Same IBAN seen before in this workspace (an older connection): keep its sync position and links.
      const prior = iban
        ? tx.all<{ ENABLED: number; SYNC_FROM: string | null; LAST_BOOKING_DATE: string | null; NETWORTH_ACCOUNT_ID: string | null }>(
            "SELECT ENABLED, SYNC_FROM, LAST_BOOKING_DATE, NETWORTH_ACCOUNT_ID FROM BANK_ACCOUNT WHERE WORKSPACE_ID = ? AND IBAN = ? ORDER BY CREATED_AT DESC LIMIT 1", [ws, iban],
          )[0]
        : undefined;
      const id = randomUUID();
      kept.add(id);
      tx.run(
        `INSERT INTO BANK_ACCOUNT (ID, WORKSPACE_ID, CONNECTION_ID, UID, IBAN, NAME, CURRENCY, ENABLED, SYNC_FROM, LAST_BOOKING_DATE, NETWORTH_ACCOUNT_ID)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ws, conn.ID, a.uid, iban, a.name ?? a.product ?? null, a.currency ?? null, prior?.ENABLED ?? 1, prior?.SYNC_FROM ?? defaultSyncFrom(), prior?.LAST_BOOKING_DATE ?? null, prior?.NETWORTH_ACCOUNT_ID ?? null],
      );
    }
    for (const c of current) {
      if (!kept.has(c.ID)) tx.run("UPDATE BANK_ACCOUNT SET DELETED_AT = CURRENT_TIMESTAMP WHERE ID = ?", [c.ID]);
    }
  });
  if (oldSession && oldSession !== session.session_id) await api.deleteSession(oldSession).catch(() => undefined);
  return conn.ID;
}
