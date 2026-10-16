// In-memory PIN attempt limiter. Single-process deployment, so a Map is the
// right size of solution: after LOCKOUT_THRESHOLD failures the key is locked
// for BASE_LOCK_MS, doubling per further failure up to MAX_LOCK_MS. Success
// clears the key. `now` is injectable for tests.
type Entry = { failures: number; lockedUntil: number; touched: number };

export const LOCKOUT_THRESHOLD = 5;
export const BASE_LOCK_MS = 60_000;
export const MAX_LOCK_MS = 15 * 60_000;
const MAX_KEYS = 1000;

const buckets = new Map<string, Entry>();

function prune(now: number): void {
  if (buckets.size < MAX_KEYS) return;
  for (const [k, e] of buckets) {
    if (e.lockedUntil < now && now - e.touched > MAX_LOCK_MS) buckets.delete(k);
  }
  while (buckets.size >= MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

export function lockoutRemainingMs(key: string, now: number = Date.now()): number {
  const e = buckets.get(key);
  return e ? Math.max(0, e.lockedUntil - now) : 0;
}

/** Records a failed attempt; returns how long the key is now locked (0 = not locked). */
export function recordFailure(key: string, now: number = Date.now()): number {
  prune(now);
  const e = buckets.get(key) ?? { failures: 0, lockedUntil: 0, touched: now };
  e.failures += 1;
  e.touched = now;
  if (e.failures >= LOCKOUT_THRESHOLD) {
    const steps = e.failures - LOCKOUT_THRESHOLD;
    e.lockedUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** steps);
  }
  buckets.set(key, e);
  return Math.max(0, e.lockedUntil - now);
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}

export function resetRateLimiterForTests(): void {
  buckets.clear();
}
