// Stateless, HMAC-signed session tokens.
//
// This module deliberately has no dependency on the database or on Next.js
// so that proxy.ts (which runs before any route and must stay cheap) can
// verify cookies with the same code path the login action uses to mint them.
//
// Token layout:  v2.<expiresAtUnixSeconds>.<userId>.<sessionVersion>.<nonceHex>.<hmacHex>
//   hmac = HMAC-SHA256(secret, "v2.<exp>.<userId>.<version>.<nonce>")
// sessionVersion is bumped on the USER row when that user changes their PIN,
// which invalidates only their own sessions (checked by requireAuth, which
// has database access; the proxy only checks signature and expiry).
//
// The signing secret is 32 random bytes persisted next to the SQLite file
// (`<dirname DB_PATH>/.auth-secret`). It is generated on first use and
// rotated whenever the PIN changes, which invalidates every outstanding
// session except the one re-issued to the caller.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SESSION_COOKIE = "auth";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;

/** Cookie attributes shared by the login action and the proxy's sliding refresh. */
export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, maxAge: SESSION_TTL_SECONDS, path: "/" };
}

export type SessionClaims = { userId: string; version: number };

/** Expiry (unix seconds) baked into a token, or null if it is malformed. Does not verify. */
export function sessionTokenExpiry(token: string | null | undefined): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== TOKEN_VERSION || !/^\d{1,12}$/.test(parts[1])) return null;
  return Number(parts[1]);
}

const SECRET_BYTES = 32;
const TOKEN_VERSION = "v2";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cachedSecret: Buffer | null = null;

export function sessionSecretPath(): string {
  const dbPath = process.env.DB_PATH ?? "./raha.sqlite";
  return join(dirname(dbPath), ".auth-secret");
}

function readSecretFile(path: string): Buffer | null {
  try {
    const buf = readFileSync(path);
    return buf.length >= SECRET_BYTES ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Returns the current signing secret, creating it on first use.
 * `{ fresh: true }` bypasses the in-memory cache and re-reads the file,
 * which lets a verifier pick up a rotation performed by another process
 * (the Next.js proxy bundle and the app bundle are separate module instances).
 */
export function getSessionSecret(opts: { fresh?: boolean } = {}): Buffer {
  if (cachedSecret && !opts.fresh) return cachedSecret;

  const path = sessionSecretPath();
  const existing = readSecretFile(path);
  if (existing) {
    cachedSecret = existing;
    return existing;
  }

  const generated = randomBytes(SECRET_BYTES);
  mkdirSync(dirname(path), { recursive: true });
  try {
    // "wx" fails if the file exists, so two processes racing on first boot
    // cannot clobber each other: the loser re-reads the winner's secret.
    writeFileSync(path, generated, { flag: "wx", mode: 0o600 });
    cachedSecret = generated;
    return generated;
  } catch {
    const winner = readSecretFile(path);
    if (!winner) throw new Error(`Cannot create session secret at ${path}`);
    cachedSecret = winner;
    return winner;
  }
}

/** Replaces the secret with a new random one. Every existing token becomes invalid. */
export function rotateSessionSecret(): Buffer {
  const path = sessionSecretPath();
  const next = randomBytes(SECRET_BYTES);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next, { mode: 0o600 });
  cachedSecret = next;
  return next;
}

function sign(secret: Buffer, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function createSessionToken(
  secret: Buffer,
  claims: SessionClaims,
  nowMs: number = Date.now(),
  ttlSeconds: number = SESSION_TTL_SECONDS,
): string {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const nonce = randomBytes(16).toString("hex");
  const payload = `${TOKEN_VERSION}.${exp}.${claims.userId}.${claims.version}.${nonce}`;
  return `${payload}.${sign(secret, payload)}`;
}

/**
 * Pure verification: the claims when the token is well-formed, unexpired
 * and its signature matches `secret`; null otherwise. Never throws.
 */
export function parseSessionToken(
  secret: Buffer,
  token: string | null | undefined,
  nowMs: number = Date.now(),
): (SessionClaims & { exp: number }) | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 6) return null;
  const [version, expStr, userId, verStr, nonce, sig] = parts;
  if (version !== TOKEN_VERSION) return null;
  if (!/^\d{1,12}$/.test(expStr)) return null;
  if (!UUID_RE.test(userId)) return null;
  if (!/^\d{1,9}$/.test(verStr)) return null;
  if (!/^[0-9a-f]{32}$/.test(nonce)) return null;
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;

  const exp = Number(expStr);
  if (exp * 1000 <= nowMs) return null;

  const expected = sign(secret, `${version}.${expStr}.${userId}.${verStr}.${nonce}`);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { userId, version: Number(verStr), exp };
}

export function verifySessionToken(secret: Buffer, token: string | null | undefined, nowMs: number = Date.now()): boolean {
  return parseSessionToken(secret, token, nowMs) !== null;
}

/**
 * Parses against the cached secret, and on failure retries once with a
 * freshly-read secret so a rotation done by another process is honoured
 * without a restart. Cheap on the happy path, one file read on a miss.
 */
export function parseSessionTokenWithCurrentSecret(token: string | null | undefined, nowMs: number = Date.now()): (SessionClaims & { exp: number }) | null {
  if (!token) return null;
  return parseSessionToken(getSessionSecret(), token, nowMs) ?? parseSessionToken(getSessionSecret({ fresh: true }), token, nowMs);
}

export function verifySessionTokenWithCurrentSecret(token: string | null | undefined, nowMs: number = Date.now()): boolean {
  return parseSessionTokenWithCurrentSecret(token, nowMs) !== null;
}
