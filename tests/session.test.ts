import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  createSessionToken,
  verifySessionToken,
  getSessionSecret,
  rotateSessionSecret,
  sessionSecretPath,
  sessionTokenExpiry,
  verifySessionTokenWithCurrentSecret,
  SESSION_TTL_SECONDS,
} from "@/lib/session";

describe("session tokens (pure)", () => {
  const secret = randomBytes(32);
  const now = Date.UTC(2026, 9, 13, 12, 0, 0);

  test("round-trips a freshly minted token", () => {
    const token = createSessionToken(secret, now);
    assert.equal(verifySessionToken(secret, token, now), true);
    assert.match(token, /^v1\.\d+\.[0-9a-f]{32}\.[0-9a-f]{64}$/);
  });

  test("sessionTokenExpiry reads the embedded expiry without verifying", () => {
    const token = createSessionToken(secret, now, 3600);
    assert.equal(sessionTokenExpiry(token), Math.floor(now / 1000) + 3600);
    assert.equal(sessionTokenExpiry("nope"), null);
    assert.equal(sessionTokenExpiry(undefined), null);
  });

  test("rejects a token signed with a different secret", () => {
    const token = createSessionToken(secret, now);
    assert.equal(verifySessionToken(randomBytes(32), token, now), false);
  });

  test("rejects tampering with expiry or signature", () => {
    const token = createSessionToken(secret, now, 60);
    const [v, exp, nonce, sig] = token.split(".");
    const laterExp = `${v}.${Number(exp) + 100000}.${nonce}.${sig}`;
    assert.equal(verifySessionToken(secret, laterExp, now), false);
    const flipped = sig[0] === "0" ? "1" : "0";
    assert.equal(verifySessionToken(secret, `${v}.${exp}.${nonce}.${flipped}${sig.slice(1)}`, now), false);
  });

  test("expires exactly at exp", () => {
    const token = createSessionToken(secret, now, 60);
    assert.equal(verifySessionToken(secret, token, now + 59_000), true);
    assert.equal(verifySessionToken(secret, token, now + 60_000), false);
  });

  test("never throws on garbage and rejects the old length-only cookies", () => {
    for (const bad of [undefined, null, "", "a", "a".repeat(64), "v1.1.2.3", "v2.9999999999.00.00", "v1.x.y.z", "....."]) {
      assert.equal(verifySessionToken(secret, bad, now), false, `should reject ${JSON.stringify(bad)}`);
    }
  });

  test("default TTL is one year", () => {
    const token = createSessionToken(secret, now);
    const exp = Number(token.split(".")[1]);
    assert.equal(exp, Math.floor(now / 1000) + SESSION_TTL_SECONDS);
  });
});

describe("session secret persistence", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "raha-session-"));
    process.env.DB_PATH = join(dir, "raha.sqlite");
  });

  test("secret lives next to the database and is created on first use", () => {
    const path = sessionSecretPath();
    assert.equal(path, join(dir, ".auth-secret"));
    assert.equal(existsSync(path), false);
    const secret = getSessionSecret({ fresh: true });
    assert.equal(secret.length, 32);
    assert.deepEqual(readFileSync(path), secret);
    assert.deepEqual(getSessionSecret({ fresh: true }), secret, "re-reading returns the same bytes");
  });

  test("rotation invalidates old tokens; verifier picks up the new secret", () => {
    const before = getSessionSecret({ fresh: true });
    const token = createSessionToken(before);
    assert.equal(verifySessionTokenWithCurrentSecret(token), true);

    const after = rotateSessionSecret();
    assert.notDeepEqual(after, before);
    assert.equal(verifySessionTokenWithCurrentSecret(token), false);
    assert.equal(verifySessionTokenWithCurrentSecret(createSessionToken(after)), true);
  });
});
