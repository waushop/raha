// Email verification codes and remembered devices. Codes are six digits,
// hashed at rest, valid for ten minutes and five attempts. A remembered
// device is a random token whose hash is stored per user for thirty days.
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import db from "./db";

export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_LIMIT = 3; // per CODE_TTL_MS window
export const DEVICE_TTL_MS = 30 * 24 * 60 * 60_000;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();

export type Challenge = { id: string; code: string };

/** Mints a code for `userId`, or null when too many were requested recently. */
export async function createChallenge(userId: string, now: number = Date.now()): Promise<Challenge | null> {
  const [recent] = await db.execute("SELECT COUNT(*) AS N FROM LOGIN_CHALLENGE WHERE USER_ID = ? AND CREATED_AT > ?", [userId, iso(now - CODE_TTL_MS)]);
  if ((recent as Array<{ N: number }>)[0].N >= CODE_RESEND_LIMIT) return null;
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.execute(
    "INSERT INTO LOGIN_CHALLENGE (ID, USER_ID, CODE_HASH, CREATED_AT, EXPIRES_AT) VALUES (?, ?, ?, ?, ?)",
    [id, userId, sha(`${id}:${code}`), iso(now), iso(now + CODE_TTL_MS)],
  );
  return { id, code };
}

export type VerifyResult = "ok" | "wrong" | "expired" | "locked" | "missing";

export async function verifyChallenge(id: string, userId: string, code: string, now: number = Date.now()): Promise<VerifyResult> {
  const [rows] = await db.execute(
    "SELECT CODE_HASH, EXPIRES_AT, ATTEMPTS, CONSUMED_AT FROM LOGIN_CHALLENGE WHERE ID = ? AND USER_ID = ?", [id, userId]);
  const c = (rows as Array<{ CODE_HASH: string; EXPIRES_AT: string; ATTEMPTS: number; CONSUMED_AT: string | null }>)[0];
  if (!c || c.CONSUMED_AT) return "missing";
  if (new Date(c.EXPIRES_AT).getTime() <= now) return "expired";
  if (c.ATTEMPTS >= CODE_MAX_ATTEMPTS) return "locked";
  if (sha(`${id}:${code}`) !== c.CODE_HASH) {
    await db.execute("UPDATE LOGIN_CHALLENGE SET ATTEMPTS = ATTEMPTS + 1 WHERE ID = ?", [id]);
    return c.ATTEMPTS + 1 >= CODE_MAX_ATTEMPTS ? "locked" : "wrong";
  }
  await db.execute("UPDATE LOGIN_CHALLENGE SET CONSUMED_AT = ? WHERE ID = ?", [iso(now), id]);
  return "ok";
}

/** The newest open code for a user (used by email verification in Settings). */
export async function latestChallengeId(userId: string, now: number = Date.now()): Promise<string | null> {
  const [rows] = await db.execute(
    "SELECT ID FROM LOGIN_CHALLENGE WHERE USER_ID = ? AND CONSUMED_AT IS NULL AND EXPIRES_AT > ? ORDER BY CREATED_AT DESC LIMIT 1", [userId, iso(now)]);
  return (rows as Array<{ ID: string }>)[0]?.ID ?? null;
}

// ---------- remembered devices ----------

export type Device = { ID: string; NAME: string; CREATED_AT: string; LAST_SEEN_AT: string; EXPIRES_AT: string };

/** Creates a remembered device and returns the raw token for the cookie. */
export async function issueDevice(userId: string, name: string, now: number = Date.now()): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.execute(
    "INSERT INTO TRUSTED_DEVICE (ID, USER_ID, TOKEN_HASH, NAME, CREATED_AT, LAST_SEEN_AT, EXPIRES_AT) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), userId, sha(token), name.slice(0, 80), iso(now), iso(now), iso(now + DEVICE_TTL_MS)],
  );
  return token;
}

/** True when the token belongs to this user and hasn't expired; bumps LAST_SEEN_AT. */
export async function deviceTrusted(userId: string, token: string | null | undefined, now: number = Date.now()): Promise<boolean> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  const [rows] = await db.execute(
    "SELECT ID FROM TRUSTED_DEVICE WHERE USER_ID = ? AND TOKEN_HASH = ? AND EXPIRES_AT > ?", [userId, sha(token), iso(now)]);
  const d = (rows as Array<{ ID: string }>)[0];
  if (!d) return false;
  await db.execute("UPDATE TRUSTED_DEVICE SET LAST_SEEN_AT = ? WHERE ID = ?", [iso(now), d.ID]);
  return true;
}

export async function listDevices(userId: string, now: number = Date.now()): Promise<Device[]> {
  const [rows] = await db.execute(
    "SELECT ID, NAME, CREATED_AT, LAST_SEEN_AT, EXPIRES_AT FROM TRUSTED_DEVICE WHERE USER_ID = ? AND EXPIRES_AT > ? ORDER BY LAST_SEEN_AT DESC", [userId, iso(now)]);
  return rows as Device[];
}

export async function forgetDevice(userId: string, id: string): Promise<void> {
  await db.execute("DELETE FROM TRUSTED_DEVICE WHERE USER_ID = ? AND ID = ?", [userId, id]);
}

export async function forgetAllDevices(userId: string): Promise<void> {
  await db.execute("DELETE FROM TRUSTED_DEVICE WHERE USER_ID = ?", [userId]);
}

/** "Safari on iPhone" from a user agent, for the devices list. */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${browser} on ${os}`;
}

/** s***@example.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 1)}***@${domain}`;
}
