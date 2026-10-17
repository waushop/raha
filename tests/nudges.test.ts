import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateNudges, type NudgeInput } from "@/lib/nudges";
import type { SubscriptionView } from "@/lib/subscriptions-db";

const sub = (o: Partial<SubscriptionView> & { ID: string; NAME: string }): SubscriptionView => ({
  CATEGORY: "subscriptions", GROUP_ID: null, AMOUNT: 10, CADENCE: "monthly", DAY: 1, MONTH_OF_YEAR: null, STATUS: "active", STATUS_CHANGED_AT: null,
  NOTES: null, CANCEL_URL: null, TRIAL_ENDS: null, CREATED_AT: "", GROUP_NAME: null, GROUP_ICON: null, GROUP_COLOR: null, group: null, charges: 3,
  firstMonth: "2026-08", lastCharge: { month: "2026-10", day: 1 }, totalSpent: 30, prices: [], previousAmount: null, changedIn: null, nextDue: "2026-11-01",
  unused: false, monthly: 10, yearly: 120, anchorMonth: 1, ...o,
});

const base: NudgeInput = { today: "2026-10-17", subscriptions: [], upcoming: [], plan: null, projection: null, buffer: 100, week: null };

describe("nudges", () => {
  test("bill due tomorrow, trial ending, price up, unused", () => {
    const n = evaluateNudges({
      ...base,
      upcoming: [{ id: "a", name: "Netflix", date: "2026-10-18", amount: 12.99 }, { id: "b", name: "Gym", date: "2026-10-20", amount: 39 }],
      subscriptions: [
        sub({ ID: "t", NAME: "Trial thing", TRIAL_ENDS: "2026-10-19" }),
        sub({ ID: "p", NAME: "Spotify", AMOUNT: 11.99, previousAmount: 9.99, changedIn: "2026-10" }),
        sub({ ID: "u", NAME: "Old gym", unused: true, lastCharge: { month: "2026-06", day: 1 } }),
        sub({ ID: "c", NAME: "Cancelled", STATUS: "cancelled", unused: true }),
      ],
    });
    assert.deepEqual(n.map((x) => x.dedupKey), ["bill:a:2026-10-18", "trial:t:2026-10-19", "price:p:2026-10", "unused:u:2026-10"]);
    assert.match(n[0].title, /Netflix is due tomorrow/);
  });

  test("plan lines at 80% and 100%, safe to spend below zero", () => {
    const line = (ID: string, PLANNED: number, actual: number) => ({ ID, MONTH: "2026-10", KIND: "expense" as const, CATEGORY: "groceries", GROUP_ID: null, LABEL: ID, PLANNED, SORT_ORDER: 0, SUBSCRIPTION_ID: null, actual, remaining: PLANNED - actual, rows: 1, balance: null });
    const n = evaluateNudges({
      ...base,
      plan: { lines: [line("ok", 100, 50), line("warn", 100, 85), line("over", 100, 120), line("exact", 100, 100), { ...line("fixed", 12.99, 12.99), SUBSCRIPTION_ID: "s" }], unplanned: [], plannedIncome: 0, plannedSpending: 300, leftToPlan: -300, actualIncome: 0, actualSpending: 255, unplannedSpending: 0 },
      projection: { days: [], lowPoint: { date: "2026-10-30", balance: -42 }, nextPayday: { date: "2026-11-01", label: "Pay", amount: 1, kind: "payday" }, safeToSpend: -142, paychecks: [] },
    });
    assert.deepEqual(n.map((x) => x.dedupKey), ["plan:warn:80", "plan:over:100", "plan:exact:80", "safe:2026-10-17"]);
  });

  test("weekly digest on Sundays and the monthly review on the 1st are email-worthy", () => {
    const sunday = evaluateNudges({ ...base, today: "2026-10-18", week: { spent: 312.5, income: 0, count: 9, topCategory: "Groceries", topAmount: 120 } });
    assert.equal(sunday.length, 1);
    assert.equal(sunday[0].dedupKey, "digest:2026-W42");
    assert.equal(sunday[0].email, true);
    const first = evaluateNudges({ ...base, today: "2026-11-01" });
    assert.deepEqual(first.map((x) => x.kind), ["monthly_review"]);
    assert.equal(evaluateNudges({ ...base, today: "2026-10-19", week: { spent: 1, income: 0, count: 1, topCategory: null, topAmount: 0 } }).length, 0);
  });
});
