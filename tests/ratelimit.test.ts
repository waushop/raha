import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  HARD_LOCK_MS, LOCKOUT_THRESHOLD, LOCK_MS, RESET_AFTER_MS,
  clearFailures, listLocks, lockoutRemainingMs, recordFailure, resetRateLimiterForTests, unlock,
} from "@/lib/ratelimit";

const t0 = 1_000_000;
const fail = (key: string, times: number, now: number) => { let r = 0; for (let i = 0; i < times; i++) r = recordFailure(key, now); return r; };

describe("pin rate limiter", () => {
  beforeEach(() => resetRateLimiterForTests());

  test("five failures → one-minute lock, then the counter starts over", () => {
    assert.equal(fail("ip", LOCKOUT_THRESHOLD - 1, t0), 0);
    assert.equal(recordFailure("ip", t0), LOCK_MS);
    assert.equal(lockoutRemainingMs("ip", t0 + 30_000), LOCK_MS - 30_000);
    assert.equal(lockoutRemainingMs("ip", t0 + LOCK_MS), 0, "lock expires");
    assert.equal(fail("ip", LOCKOUT_THRESHOLD - 1, t0 + LOCK_MS), 0, "fresh counter after the lock");
  });

  test("hitting the limit a second time → 24-hour hard lock", () => {
    fail("ip", LOCKOUT_THRESHOLD, t0);
    const later = t0 + LOCK_MS + 1000;
    const lock = fail("ip", LOCKOUT_THRESHOLD, later);
    assert.equal(lock, HARD_LOCK_MS);
    assert.equal(lockoutRemainingMs("ip", later + 23 * 60 * 60_000), 60 * 60_000);
    assert.deepEqual(listLocks(later).map((l) => ({ key: l.key, hard: l.hard, lockouts: l.lockouts })), [{ key: "ip", hard: true, lockouts: 2 }]);
    // and it survives an hour of quiet — only unexpired soft state is forgotten
    assert.ok(lockoutRemainingMs("ip", later + RESET_AFTER_MS + 1) > 0);
  });

  test("an hour of quiet resets failures and the lockout count", () => {
    fail("ip", LOCKOUT_THRESHOLD, t0);               // first lockout
    const quiet = t0 + LOCK_MS + RESET_AFTER_MS + 1;  // lock long expired, then silence
    assert.equal(lockoutRemainingMs("ip", quiet), 0);
    assert.equal(fail("ip", LOCKOUT_THRESHOLD, quiet), LOCK_MS, "counts as a first lockout again, not a hard lock");
  });

  test("success clears; admin unlock clears; keys are independent", () => {
    fail("a", LOCKOUT_THRESHOLD, t0);
    assert.equal(lockoutRemainingMs("b", t0), 0);
    clearFailures("a");
    assert.equal(lockoutRemainingMs("a", t0), 0);
    fail("c", LOCKOUT_THRESHOLD * 2, t0);
    assert.ok(lockoutRemainingMs("c", t0) >= HARD_LOCK_MS - 1);
    assert.equal(unlock("c"), true);
    assert.equal(lockoutRemainingMs("c", t0), 0);
    assert.equal(listLocks(t0).length, 0);
  });
});
