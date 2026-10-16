import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DB_PATH = ":memory:";

describe("pin → user lookup", () => {
  let db: typeof import("@/lib/db").default;
  let users: typeof import("@/lib/users");
  let pin: typeof import("@/lib/pin");
  const siim = randomUUID();
  const mari = randomUUID();
  before(async () => {
    db = (await import("@/lib/db")).default;
    users = await import("@/lib/users");
    pin = await import("@/lib/pin");
  });
  beforeEach(async () => {
    await db.execute("DELETE FROM USER");
    await db.execute("INSERT INTO USER (ID, NAME, PIN_HASH, IS_ADMIN) VALUES (?, 'Siim', ?, 1), (?, 'Mari', ?, 0)", [siim, pin.hashPin("111111"), mari, pin.legacyHashPin("222222")]);
  });

  test("the PIN alone identifies the user, including a legacy hash", async () => {
    assert.equal((await users.findUserByPin("111111"))?.NAME, "Siim");
    assert.equal((await users.findUserByPin("222222"))?.NAME, "Mari");
    assert.equal(await users.findUserByPin("333333"), null);
  });

  test("pinTaken sees other users' PINs but not your own", async () => {
    assert.equal(await users.pinTaken("111111"), true);
    assert.equal(await users.pinTaken("111111", siim), false, "changing to your current PIN isn't a clash");
    assert.equal(await users.pinTaken("222222", siim), true);
    assert.equal(await users.pinTaken("999999"), false);
  });

  test("removed users no longer match", async () => {
    await db.execute("UPDATE USER SET DELETED_AT = CURRENT_TIMESTAMP WHERE ID = ?", [mari]);
    assert.equal(await users.findUserByPin("222222"), null);
    assert.equal(await users.pinTaken("222222"), false);
  });
});
