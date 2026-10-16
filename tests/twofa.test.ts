import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DB_PATH = ":memory:";

describe("email codes and remembered devices", () => {
  let db: typeof import("@/lib/db").default;
  let twofa: typeof import("@/lib/twofa");
  const user = randomUUID();
  const other = randomUUID();
  const t0 = Date.UTC(2026, 9, 16, 12, 0, 0);
  before(async () => {
    db = (await import("@/lib/db")).default;
    twofa = await import("@/lib/twofa");
  });
  beforeEach(async () => {
    await db.execute("DELETE FROM LOGIN_CHALLENGE");
    await db.execute("DELETE FROM TRUSTED_DEVICE");
  });

  test("a code verifies once, for its own user, within ten minutes", async () => {
    const ch = (await twofa.createChallenge(user, t0))!;
    assert.match(ch.code, /^\d{6}$/);
    assert.equal(await twofa.verifyChallenge(ch.id, other, ch.code, t0), "missing", "bound to the user");
    assert.equal(await twofa.verifyChallenge(ch.id, user, ch.code, t0 + twofa.CODE_TTL_MS), "expired");
    assert.equal(await twofa.verifyChallenge(ch.id, user, ch.code, t0 + 1000), "ok");
    assert.equal(await twofa.verifyChallenge(ch.id, user, ch.code, t0 + 2000), "missing", "consumed");
  });

  test("five wrong guesses lock the code", async () => {
    const ch = (await twofa.createChallenge(user, t0))!;
    const wrong = ch.code === "000000" ? "111111" : "000000";
    for (let i = 1; i < twofa.CODE_MAX_ATTEMPTS; i++) assert.equal(await twofa.verifyChallenge(ch.id, user, wrong, t0), "wrong");
    assert.equal(await twofa.verifyChallenge(ch.id, user, wrong, t0), "locked");
    assert.equal(await twofa.verifyChallenge(ch.id, user, ch.code, t0), "locked", "even the right code no longer works");
  });

  test("at most three codes per ten minutes; the latest open one is findable", async () => {
    const a = await twofa.createChallenge(user, t0);
    const b = await twofa.createChallenge(user, t0 + 1000);
    const c = await twofa.createChallenge(user, t0 + 2000);
    assert.ok(a && b && c);
    assert.equal(await twofa.createChallenge(user, t0 + 3000), null);
    assert.equal(await twofa.latestChallengeId(user, t0 + 2500), c!.id);
    const d = await twofa.createChallenge(user, t0 + twofa.CODE_TTL_MS + 1);
    assert.ok(d, "window passed");
    assert.equal(await twofa.latestChallengeId(user, t0 + twofa.CODE_TTL_MS + 2), d!.id);
  });

  test("remembered devices are per user, expire after 30 days and can be forgotten", async () => {
    const token = await twofa.issueDevice(user, "Safari on iPhone", t0);
    assert.equal(await twofa.deviceTrusted(user, token, t0 + 1000), true);
    assert.equal(await twofa.deviceTrusted(other, token, t0 + 1000), false);
    assert.equal(await twofa.deviceTrusted(user, "deadbeef", t0), false);
    assert.equal(await twofa.deviceTrusted(user, token, t0 + twofa.DEVICE_TTL_MS), false);
    const devices = await twofa.listDevices(user, t0 + 1000);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].NAME, "Safari on iPhone");
    await twofa.forgetDevice(user, devices[0].ID);
    assert.equal(await twofa.deviceTrusted(user, token, t0 + 1000), false);
  });

  test("device names and masked emails", () => {
    assert.equal(twofa.describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari on iPhone");
    assert.equal(twofa.describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"), "Chrome on Mac");
    assert.equal(twofa.maskEmail("siim@example.com"), "s***@example.com");
  });
});
