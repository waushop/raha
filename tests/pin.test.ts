import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hashPin, isLegacyPinHash, legacyHashPin, verifyPin } from "@/lib/pin";

describe("pin hashing", () => {
  test("new hashes are salted scrypt and verify only the right PIN", () => {
    const stored = hashPin("123456");
    assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    assert.notEqual(stored, hashPin("123456"), "salt makes each hash unique");
    assert.equal(isLegacyPinHash(stored), false);
    assert.equal(verifyPin("123456", stored), true);
    assert.equal(verifyPin("123457", stored), false);
  });

  test("legacy unsalted SHA-256 hashes still verify and are flagged for upgrade", () => {
    const legacy = legacyHashPin("654321");
    assert.match(legacy, /^[0-9a-f]{64}$/);
    assert.equal(isLegacyPinHash(legacy), true);
    assert.equal(verifyPin("654321", legacy), true);
    assert.equal(verifyPin("000000", legacy), false);
  });

  test("malformed stored values never verify", () => {
    assert.equal(verifyPin("123456", "scrypt$zz"), false);
    assert.equal(verifyPin("123456", ""), false);
  });
});
