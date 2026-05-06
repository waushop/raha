import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import db from "./db";

const PIN_KEY = "pin_hash";

export function hashPin(pin: string): string {
  return createHash("sha256").update(pin).digest("hex");
}

export function generateAuthToken(): string {
  // The cookie stores the SHA-256 of a 32-byte random value, the same
  // double-step the original auth used. Middleware just checks length, so
  // this is opaque to it; the hash makes the cookie value indistinguishable
  // from random if it ever leaks into a log.
  return createHash("sha256").update(randomBytes(32)).digest("hex");
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
