import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pinWeakness } from "@/lib/pin-policy";

describe("pin policy", () => {
  test("rejects repeats, sequences, patterns and the common list", () => {
    for (const bad of ["111111", "123456", "654321", "890123", "321098", "123123", "121212", "112233", "123321", "159753", "007007"]) {
      assert.notEqual(pinWeakness(bad), null, bad);
    }
  });

  test("rejects anything that reads as a date or a year", () => {
    for (const bad of ["150688", "880615", "061588", "198806", "200412", "311299"]) {
      assert.notEqual(pinWeakness(bad), null, bad);
    }
  });

  test("accepts unremarkable PINs", () => {
    for (const ok of ["493817", "740296", "862054", "519473", "386149"]) {
      assert.equal(pinWeakness(ok), null, ok);
    }
  });

  test("non-6-digit input is rejected with the format message", () => {
    assert.equal(pinWeakness("12345"), "PIN must be 6 digits");
    assert.equal(pinWeakness("abcdef"), "PIN must be 6 digits");
  });
});
