// User lookups that need the database but not Next.js, so they can be unit
// tested. lib/auth.ts re-exports them.
import db from "./db";
import { verifyPin } from "./pin";

export type UserRow = { ID: string; NAME: string; PIN_HASH: string; IS_ADMIN: number; SESSION_VERSION: number };

const COLUMNS = "ID, NAME, PIN_HASH, IS_ADMIN, SESSION_VERSION";

export async function listUserRows(): Promise<UserRow[]> {
  const [rows] = await db.execute(`SELECT ${COLUMNS} FROM USER WHERE DELETED_AT IS NULL ORDER BY SORT_ORDER, CREATED_AT`);
  return rows as UserRow[];
}

/**
 * The PIN alone identifies the user: every live user's hash is checked, and
 * the (unique) match wins. PINs are kept unique across users on every write,
 * so at most one can match.
 */
export async function findUserByPin(pin: string): Promise<UserRow | null> {
  for (const u of await listUserRows()) {
    if (verifyPin(pin, u.PIN_HASH)) return u;
  }
  return null;
}

/** True when another live user (not `exceptUserId`) already uses this PIN. */
export async function pinTaken(pin: string, exceptUserId?: string): Promise<boolean> {
  for (const u of await listUserRows()) {
    if (u.ID !== exceptUserId && verifyPin(pin, u.PIN_HASH)) return true;
  }
  return false;
}
