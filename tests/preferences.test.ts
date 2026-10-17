import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREFERENCES,
  landingPath,
  leadingBlanks,
  parsePreferences,
  prefKey,
  readPreferences,
  weekdayOrder,
} from "@/lib/preferences";
import { ValidationError } from "@/lib/validate";

process.env.DB_PATH = ":memory:";

const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
const valid = { landing: "plan", sidebarMonths: "24", safeBuffer: "250,5", weekStart: "sun" };

describe("preferences parsing", () => {
  test("parses a valid form", () => {
    assert.deepEqual(parsePreferences(form(valid)), { landing: "plan", sidebarMonths: 24, safeBuffer: 250.5, weekStart: "sun" });
  });

  test("rejects out-of-range and unknown values", () => {
    for (const bad of [
      { landing: "settings" },
      { sidebarMonths: "5" },
      { sidebarMonths: "37" },
      { sidebarMonths: "12.5" },
      { safeBuffer: "-1" },
      { safeBuffer: "5000.01" },
      { safeBuffer: "" },
      { safeBuffer: "lots" },
      { weekStart: "sat" },
    ]) {
      assert.throws(() => parsePreferences(form({ ...valid, ...bad })), ValidationError, JSON.stringify(bad));
    }
  });

  test("accepts the bounds", () => {
    const p = parsePreferences(form({ ...valid, sidebarMonths: "6", safeBuffer: "0" }));
    assert.equal(p.sidebarMonths, 6);
    assert.equal(p.safeBuffer, 0);
    assert.equal(parsePreferences(form({ ...valid, sidebarMonths: "36", safeBuffer: "5000" })).sidebarMonths, 36);
  });

  test("stored values fall back to defaults per key", () => {
    assert.deepEqual(readPreferences({}), DEFAULT_PREFERENCES);
    assert.deepEqual(readPreferences({ landing: "subscriptions", sidebarMonths: "999", safeBuffer: "40", weekStart: "nope" }), {
      ...DEFAULT_PREFERENCES, landing: "subscriptions", safeBuffer: 40,
    });
  });

  test("landing paths and week helpers", () => {
    assert.equal(landingPath({ landing: "month" }), "/");
    assert.equal(landingPath({ landing: "dashboard" }), "/dashboard");
    assert.deepEqual(weekdayOrder("mon"), [1, 2, 3, 4, 5, 6, 0]);
    assert.deepEqual(weekdayOrder("sun"), [0, 1, 2, 3, 4, 5, 6]);
    // 2026-11-01 is a Sunday (getDay 0)
    assert.equal(leadingBlanks(0, "mon"), 6);
    assert.equal(leadingBlanks(0, "sun"), 0);
    assert.equal(leadingBlanks(1, "mon"), 0);
    assert.equal(leadingBlanks(1, "sun"), 1);
  });
});

describe("preferences storage", () => {
  let store: typeof import("@/lib/preferences-db");
  before(async () => { store = await import("@/lib/preferences-db"); });

  test("defaults until saved, then round-trips per user", async () => {
    assert.deepEqual(await store.getPreferences("u1"), DEFAULT_PREFERENCES);
    const prefs = parsePreferences(form(valid));
    store.savePreferencesFor("u1", prefs);
    assert.deepEqual(await store.getPreferences("u1"), prefs);
    assert.deepEqual(await store.getPreferences("u2"), DEFAULT_PREFERENCES, "other users are unaffected");
    store.savePreferencesFor("u1", { ...prefs, sidebarMonths: 12 });
    assert.equal((await store.getPreferences("u1")).sidebarMonths, 12);
    assert.equal(prefKey("u1", "landing"), "pref:u1:landing");
  });
});
