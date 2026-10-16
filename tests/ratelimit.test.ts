import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_LOCK_MS, LOCKOUT_THRESHOLD, MAX_LOCK_MS, clearFailures, lockoutRemainingMs, recordFailure, resetRateLimiterForTests,
} from "@/lib/ratelimit";

describe("pin rate limiter", () => {
  beforeEach(() => resetRateLimiterForTests());
  const t0 = 1_000_000;

  test("locks after the threshold, doubling up to the cap", () => {
    for (let i = 1; i < LOCKOUT_THRESHOLD; i++) assert.equal(recordFailure("ip", t0), 0, `attempt ${i} not locked`);
    assert.equal(recordFailure("ip", t0), BASE_LOCK_MS);
    assert.equal(lockoutRemainingMs("ip", t0 + 1000), BASE_LOCK_MS - 1000);
    assert.equal(recordFailure("ip", t0), BASE_LOCK_MS * 2);
    for (let i = 0; i < 10; i++) recordFailure("ip", t0);
    assert.equal(recordFailure("ip", t0), MAX_LOCK_MS);
  });

  test("lock expires with time and success clears the counter", () => {
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) recordFailure("ip", t0);
    assert.equal(lockoutRemainingMs("ip", t0 + BASE_LOCK_MS), 0);
    clearFailures("ip");
    assert.equal(recordFailure("ip", t0), 0, "counter starts over after success");
  });

  test("keys are independent", () => {
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) recordFailure("a", t0);
    assert.equal(lockoutRemainingMs("b", t0), 0);
  });
});
