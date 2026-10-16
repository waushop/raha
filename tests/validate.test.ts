import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError, parseAmount, parseCategory, parseColor, parseId, parseMonth, parseName,
  parseOptionalId, parseOptionalText, parsePattern, parseYear,
} from "@/lib/validate";

describe("validate", () => {
  test("parseAmount accepts positive numbers and comma decimals, rounds to cents", () => {
    assert.equal(parseAmount("12.345"), 12.35);
    assert.equal(parseAmount("12,5"), 12.5);
    assert.equal(parseAmount(7), 7);
    for (const bad of ["", "abc", "0", "-1", NaN, Infinity, "1e10"]) {
      assert.throws(() => parseAmount(bad), ValidationError, String(bad));
    }
  });

  test("parseMonth / parseYear enforce the formats pages key on", () => {
    assert.equal(parseMonth(" 2026-03 "), "2026-03");
    assert.throws(() => parseMonth("2026-13"), ValidationError);
    assert.throws(() => parseMonth("garbage"), ValidationError);
    assert.equal(parseYear("2025"), "2025");
    assert.throws(() => parseYear("25"), ValidationError);
  });

  test("parseCategory / parseColor only accept known keys", () => {
    assert.equal(parseCategory("groceries"), "groceries");
    assert.throws(() => parseCategory("Groceries"), ValidationError);
    assert.equal(parseColor(""), "blue");
    assert.equal(parseColor("teal"), "teal");
    assert.throws(() => parseColor("magenta"), ValidationError);
  });

  test("parseName trims and bounds length; optional text returns null when empty", () => {
    assert.equal(parseName("  Rimi "), "Rimi");
    assert.throws(() => parseName("   "), /required/);
    assert.throws(() => parseName("x".repeat(121)), /too long/);
    assert.equal(parseOptionalText("", "Notes"), null);
    assert.equal(parseOptionalText(" hi ", "Notes"), "hi");
  });

  test("ids must be UUIDs; optional id passes through empty", () => {
    const id = "b87460f0-1234-4abc-8def-0123456789ab";
    assert.equal(parseId(id), id);
    assert.throws(() => parseId("1; DROP TABLE LEDGER"), ValidationError);
    assert.equal(parseOptionalId(""), null);
    assert.equal(parseOptionalId(null), null);
  });

  test("parsePattern rejects invalid regular expressions", () => {
    assert.equal(parsePattern("RIMI"), "RIMI");
    assert.throws(() => parsePattern("("), /valid expression/);
  });
});
