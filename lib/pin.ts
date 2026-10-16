// PIN hashing. New hashes are salted scrypt; the original unsalted SHA-256
// format (also what AUTH_PIN_HASH carries) is still verified so existing
// installs keep working, and the login action upgrades it on first success.
// No Next.js imports here so the unit tests can exercise it directly.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const PIN_REGEX = /^\d{6}$/;

const SCRYPT_PREFIX = "scrypt$";
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function legacyHashPin(pin: string): string {
  return createHash("sha256").update(pin).digest("hex");
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(pin, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `${SCRYPT_PREFIX}${salt.toString("hex")}$${key.toString("hex")}`;
}

export function isLegacyPinHash(stored: string): boolean {
  return !stored.startsWith(SCRYPT_PREFIX);
}

export function verifyPin(pin: string, stored: string): boolean {
  if (isLegacyPinHash(stored)) return constantTimeEqual(legacyHashPin(pin), stored);
  const [, saltHex, keyHex] = stored.split("$");
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length, SCRYPT_PARAMS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
