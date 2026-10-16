import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { forecastMonth, variableDailyRate } from "@/lib/forecast";

describe("forecast", () => {
  test("adds bills still due and variable spend for the remaining days", () => {
    const f = forecastMonth({ spent: 1200, dayOfMonth: 10, totalDays: 30, missingRecurring: 300, variableDaily: 40 });
    assert.equal(f.method, "model");
    assert.equal(f.dueRecurring, 300);
    assert.equal(f.variableRemaining, 800);
    assert.equal(f.predicted, 2300);
  });

  test("is calm on day 2 even when fixed costs already landed", () => {
    const early = forecastMonth({ spent: 1055, dayOfMonth: 2, totalDays: 31, missingRecurring: 50, variableDaily: 30 });
    assert.equal(Math.round(early.predicted), 1055 + 50 + 870);
    const linear = forecastMonth({ spent: 1055, dayOfMonth: 2, totalDays: 31, missingRecurring: 0, variableDaily: null });
    assert.ok(linear.predicted > 16000, "the old straight line explodes here");
    assert.equal(linear.method, "linear");
  });

  test("last day of the month forecasts exactly what's spent plus anything still due", () => {
    const f = forecastMonth({ spent: 2500, dayOfMonth: 30, totalDays: 30, missingRecurring: 20, variableDaily: 99 });
    assert.equal(f.predicted, 2520);
  });

  test("variableDailyRate averages per-day rates and is null without history", () => {
    assert.equal(variableDailyRate([]), null);
    assert.equal(variableDailyRate([{ total: 310, days: 31 }, { total: 300, days: 30 }]), 10);
  });
});
