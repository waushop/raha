// Stateless, HMAC-signed session tokens.
//
// This module deliberately has no dependency on the database or on Next.js
// so that proxy.ts (which runs before any route and must stay cheap) can
// verify cookies with the same code path the login action uses to mint them.
//
// Token layout:  v1.<expiresAtUnixSeconds>.<nonceHex>.<hmacHex>
//   hmac = HMAC-SHA256(secret, "v1.<exp>.<nonce>")
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

const SECRET_BYTES = 32;
const TOKEN_VERSION = "v1";

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
  nowMs: number = Date.now(),
  ttlSeconds: number = SESSION_TTL_SECONDS,
): string {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const nonce = randomBytes(16).toString("hex");
  const payload = `${TOKEN_VERSION}.${exp}.${nonce}`;
  return `${payload}.${sign(secret, payload)}`;
}

/**
 * Pure verification: true only when the token is well-formed, unexpired,
 * and its signature matches `secret`. Never throws.
 */
export function verifySessionToken(
  secret: Buffer,
  token: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [version, expStr, nonce, sig] = parts;
  if (version !== TOKEN_VERSION) return false;
  if (!/^\d{1,12}$/.test(expStr)) return false;
  if (!/^[0-9a-f]{32}$/.test(nonce)) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;

  const exp = Number(expStr);
  if (exp * 1000 <= nowMs) return false;

  const expected = sign(secret, `${version}.${expStr}.${nonce}`);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verifies against the cached secret, and on failure retries once with a
 * freshly-read secret so a rotation done by another process is honoured
 * without a restart. Cheap on the happy path, one file read on a miss.
 */
export function verifySessionTokenWithCurrentSecret(token: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!token) return false;
  if (verifySessionToken(getSessionSecret(), token, nowMs)) return true;
  return verifySessionToken(getSessionSecret({ fresh: true }), token, nowMs);
}
