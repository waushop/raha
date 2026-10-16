// In-memory PIN attempt limiter, keyed by client IP. Single-process
// deployment, so a Map is the right size of solution.
//
//   - 5 wrong PINs → locked for LOCK_MS (1 minute); the counter starts over.
//   - Hitting the limit a second time → HARD_LOCK_MS (24 hours).
//   - An hour with no attempts (RESET_AFTER_MS) forgets everything.
//   - A correct PIN clears the key; an admin can unlock from Settings.
//
// On top of the per-IP rules, a site-wide brake: more than GLOBAL_THRESHOLD
// failures from anywhere within GLOBAL_WINDOW_MS pauses all sign-ins for
// GLOBAL_LOCK_MS. That is what stops an attacker who rotates addresses.
//
// `now` is injectable for tests.
type Entry = { failures: number; lockouts: number; lockedUntil: number; touched: number };

export const LOCKOUT_THRESHOLD = 5;
export const LOCK_MS = 60_000;
export const HARD_LOCK_MS = 24 * 60 * 60_000;
export const RESET_AFTER_MS = 60 * 60_000;
const MAX_KEYS = 1000;

export const GLOBAL_THRESHOLD = 20;
export const GLOBAL_WINDOW_MS = 15 * 60_000;
export const GLOBAL_LOCK_MS = 15 * 60_000;
export const GLOBAL_KEY = "site";

const buckets = new Map<string, Entry>();
let globalFailures: number[] = []; // timestamps of recent failures, any client
let globalLockedUntil = 0;

function noteGlobalFailure(now: number): void {
  globalFailures = globalFailures.filter((t) => now - t < GLOBAL_WINDOW_MS);
  globalFailures.push(now);
  if (globalFailures.length >= GLOBAL_THRESHOLD) {
    globalLockedUntil = now + GLOBAL_LOCK_MS;
    globalFailures = [];
  }
}

/** Remaining site-wide pause, 0 when sign-ins are open. */
export function globalLockoutRemainingMs(now: number = Date.now()): number {
  return Math.max(0, globalLockedUntil - now);
}

function get(key: string, now: number): Entry | undefined {
  const e = buckets.get(key);
  if (!e) return undefined;
  // Quiet for an hour (and not under a hard lock) → clean slate.
  if (now - e.touched > RESET_AFTER_MS && e.lockedUntil <= now) {
    buckets.delete(key);
    return undefined;
  }
  return e;
}

function prune(now: number): void {
  if (buckets.size < MAX_KEYS) return;
  for (const [k, e] of buckets) {
    if (e.lockedUntil <= now && now - e.touched > RESET_AFTER_MS) buckets.delete(k);
  }
  while (buckets.size >= MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

export function lockoutRemainingMs(key: string, now: number = Date.now()): number {
  const e = get(key, now);
  return e ? Math.max(0, e.lockedUntil - now) : 0;
}

/** Records a failed attempt; returns how long the key is now locked (0 = not locked). */
export function recordFailure(key: string, now: number = Date.now()): number {
  prune(now);
  noteGlobalFailure(now);
  const e = get(key, now) ?? { failures: 0, lockouts: 0, lockedUntil: 0, touched: now };
  e.failures += 1;
  e.touched = now;
  if (e.failures >= LOCKOUT_THRESHOLD) {
    e.lockouts += 1;
    e.failures = 0;
    e.lockedUntil = now + (e.lockouts >= 2 ? HARD_LOCK_MS : LOCK_MS);
  }
  buckets.set(key, e);
  return Math.max(0, e.lockedUntil - now);
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}

export type LockInfo = { key: string; remainingMs: number; lockouts: number; hard: boolean };

/** Currently locked keys, for the admin view. */
export function listLocks(now: number = Date.now()): LockInfo[] {
  const out: LockInfo[] = [];
  if (globalLockedUntil > now) out.push({ key: GLOBAL_KEY, remainingMs: globalLockedUntil - now, lockouts: 0, hard: false });
  for (const [key, e] of buckets) {
    if (e.lockedUntil > now) out.push({ key, remainingMs: e.lockedUntil - now, lockouts: e.lockouts, hard: e.lockouts >= 2 });
  }
  return out.sort((a, b) => b.remainingMs - a.remainingMs);
}

export function unlock(key: string): boolean {
  if (key === GLOBAL_KEY) {
    const was = globalLockedUntil > 0;
    globalLockedUntil = 0;
    globalFailures = [];
    return was;
  }
  return buckets.delete(key);
}

export function resetRateLimiterForTests(): void {
  buckets.clear();
  globalFailures = [];
  globalLockedUntil = 0;
}
