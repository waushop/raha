import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import db from "./db";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  getSessionSecret,
  verifySessionTokenWithCurrentSecret,
} from "./session";

const PIN_KEY = "pin_hash";

export function hashPin(pin: string): string {
  return createHash("sha256").update(pin).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const PIN_REGEX = /^\d{6}$/;

async function readPinFromDb(): Promise<string | null> {
  const [rows] = await db.execute(
    "SELECT VALUE FROM APP_SETTING WHERE NAME = ?",
    [PIN_KEY],
  );
  const row = (rows as Array<{ VALUE: string }>)[0];
  return row?.VALUE ?? null;
}

export async function isPinSetInDb(): Promise<boolean> {
  return (await readPinFromDb()) !== null;
}

// DB takes precedence; env var is a one-shot bootstrap that becomes
// authoritative only until a successful login persists it to the DB
// (see persistEnvHashIfNeeded).
export async function getPinHash(): Promise<string | null> {
  return (await readPinFromDb()) ?? process.env.AUTH_PIN_HASH ?? null;
}

export async function setPinHash(hash: string): Promise<void> {
  await db.execute(
    `INSERT INTO APP_SETTING (NAME, VALUE) VALUES (?, ?)
     ON CONFLICT(NAME) DO UPDATE SET VALUE = excluded.VALUE`,
    [PIN_KEY, hash],
  );
}

// Called after a successful env-var login so the hash lives in the DB and
// the env var can be dropped from the SealedSecret on the next deploy.
export async function persistEnvHashIfNeeded(verifiedHash: string): Promise<void> {
  if (await isPinSetInDb()) return;
  await setPinHash(verifiedHash);
}

// ============================================
// SESSION COOKIE
// ============================================

/** Mints a fresh signed token and stores it in the session cookie. */
export async function issueSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, createSessionToken(getSessionSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** True when the request carries a validly signed, unexpired session cookie. */
export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifySessionTokenWithCurrentSecret(cookieStore.get(SESSION_COOKIE)?.value);
}

/**
 * Guard for Server Actions and route handlers. The proxy already rejects
 * unauthenticated requests, but Next.js recommends verifying inside every
 * server function too, so a future matcher change can't expose a mutation.
 */
export async function requireAuth(): Promise<void> {
  if (!(await isAuthenticated())) {
    throw new Error("Unauthorized");
  }
}
