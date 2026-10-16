import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import db from "./db";
import {
  SESSION_COOKIE,
  createSessionToken,
  getSessionSecret,
  parseSessionTokenWithCurrentSecret,
  sessionCookieOptions,
} from "./session";

export { PIN_REGEX, constantTimeEqual, hashPin, isLegacyPinHash, verifyPin } from "./pin";

// ============================================
// USERS + WORKSPACES
// ============================================

export type UserRow = { ID: string; NAME: string; PIN_HASH: string; IS_ADMIN: number; SESSION_VERSION: number };
export type AuthContext = { userId: string; name: string; isAdmin: boolean; workspaceId: string };

export async function listUsers(): Promise<Array<{ ID: string; NAME: string; IS_ADMIN: number }>> {
  const [rows] = await db.execute("SELECT ID, NAME, IS_ADMIN FROM USER WHERE DELETED_AT IS NULL ORDER BY SORT_ORDER, CREATED_AT");
  return rows as Array<{ ID: string; NAME: string; IS_ADMIN: number }>;
}

export async function getUser(id: string): Promise<UserRow | null> {
  const [rows] = await db.execute("SELECT ID, NAME, PIN_HASH, IS_ADMIN, SESSION_VERSION FROM USER WHERE ID = ? AND DELETED_AT IS NULL", [id]);
  return (rows as UserRow[])[0] ?? null;
}

export async function hasAnyUser(): Promise<boolean> {
  const [rows] = await db.execute("SELECT 1 FROM USER WHERE DELETED_AT IS NULL LIMIT 1");
  return (rows as unknown[]).length > 0;
}

/** Creates a user together with their personal workspace. Returns the user id. */
export function createUserWithWorkspace(name: string, pinHash: string, isAdmin: boolean): string {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  db.transaction((tx) => {
    const { n } = tx.all<{ n: number }>("SELECT COUNT(*) AS n FROM USER")[0];
    tx.run("INSERT INTO USER (ID, NAME, PIN_HASH, IS_ADMIN, SORT_ORDER) VALUES (?, ?, ?, ?, ?)", [userId, name, pinHash, isAdmin ? 1 : 0, n]);
    tx.run("INSERT INTO WORKSPACE (ID, NAME, KIND) VALUES (?, ?, 'personal')", [workspaceId, `${name}'s ledger`]);
    tx.run("INSERT INTO WORKSPACE_MEMBER (WORKSPACE_ID, USER_ID, ROLE) VALUES (?, ?, 'owner')", [workspaceId, userId]);
  });
  return userId;
}

/** Stores a new PIN hash and bumps SESSION_VERSION so that user's other sessions end. */
export async function setUserPin(userId: string, pinHash: string): Promise<void> {
  await db.execute("UPDATE USER SET PIN_HASH = ?, SESSION_VERSION = SESSION_VERSION + 1 WHERE ID = ?", [pinHash, userId]);
}

async function personalWorkspaceId(userId: string): Promise<string | null> {
  const [rows] = await db.execute(
    `SELECT w.ID FROM WORKSPACE w JOIN WORKSPACE_MEMBER m ON m.WORKSPACE_ID = w.ID
     WHERE m.USER_ID = ? ORDER BY CASE w.KIND WHEN 'personal' THEN 0 ELSE 1 END, w.CREATED_AT LIMIT 1`,
    [userId],
  );
  return (rows as Array<{ ID: string }>)[0]?.ID ?? null;
}

// ============================================
// SESSION COOKIE
// ============================================

/** Mints a fresh signed token for `user` and stores it in the session cookie. */
export async function issueSessionCookie(user: UserRow): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE,
    createSessionToken(getSessionSecret(), { userId: user.ID, version: user.SESSION_VERSION }),
    sessionCookieOptions(process.env.NODE_ENV === "production"),
  );
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/**
 * The signed-in user and their workspace, or null. Signature and expiry are
 * checked by the token; the user must still exist and the token's version
 * must match (a PIN change bumps it).
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const claims = parseSessionTokenWithCurrentSecret(cookieStore.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const user = await getUser(claims.userId);
  if (!user || user.SESSION_VERSION !== claims.version) return null;
  const workspaceId = await personalWorkspaceId(user.ID);
  if (!workspaceId) return null;
  return { userId: user.ID, name: user.NAME, isAdmin: user.IS_ADMIN === 1, workspaceId };
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getAuthContext()) !== null;
}

/**
 * Guard for Server Actions and route handlers: returns who is calling and
 * which workspace their data lives in, or throws. The proxy already rejects
 * unauthenticated requests, but a matcher change must never expose a mutation.
 */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new Error("Unauthorized");
  return ctx;
}

/** Same as requireAuth for pages: sends the browser to /login instead of throwing. */
export async function currentContext(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  return ctx;
}
