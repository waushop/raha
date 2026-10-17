import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dropLoggedPaydays, paydayOccurrences, project, type Event } from "@/lib/cashflow";

describe("payday occurrences", () => {
  test("monthly clamps to short months and stays inside the window", () => {
    const occ = paydayOccurrences([{ ID: "p", LABEL: "Salary", AMOUNT: 2000, CADENCE: "monthly", DAY: 31, START_DATE: null }], "2026-01-20", "2026-03-31");
    assert.deepEqual(occ.map((o) => o.date), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
  test("biweekly steps from the anchor, fast-forwarding past the window start", () => {
    const occ = paydayOccurrences([{ ID: "p", LABEL: "Pay", AMOUNT: 900, CADENCE: "biweekly", DAY: null, START_DATE: "2026-01-02" }], "2026-10-17", "2026-11-15");
    assert.deepEqual(occ.map((o) => o.date), ["2026-10-23", "2026-11-06"]);
  });
  test("once only inside the window", () => {
    const p = { ID: "p", LABEL: "Bonus", AMOUNT: 500, CADENCE: "once" as const, DAY: null, START_DATE: "2026-12-20" };
    assert.equal(paydayOccurrences([p], "2026-10-17", "2026-12-16").length, 0);
    assert.equal(paydayOccurrences([p], "2026-10-17", "2026-12-31").length, 1);
  });
});

describe("projection", () => {
  const paydays: Event[] = [{ date: "2026-11-01", label: "Salary", amount: 2000, kind: "payday" }];
  const bills: Event[] = [
    { date: "2026-10-20", label: "Rent", amount: 700, kind: "bill" },
    { date: "2026-10-25", label: "Netflix", amount: 13, kind: "bill" },
    { date: "2026-11-03", label: "Car", amount: 300, kind: "bill" },
  ];
  test("balance walks through bills, paydays and the daily drain; safe to spend is the low point before payday minus buffer", () => {
    const p = project({ today: "2026-10-17", startBalance: 1000, horizonDays: 20, paydays, bills, dailyVariable: 10, buffer: 100 });
    assert.equal(p.days[0].balance, 1000);
    assert.equal(p.days[3].balance, 1000 - 30 - 700); // Oct 20
    assert.equal(p.days[8].balance, 1000 - 80 - 700 - 13); // Oct 25
    assert.equal(p.nextPayday?.date, "2026-11-01");
    // Oct 31 = 14 days of drain
    assert.equal(p.days[14].balance, 1000 - 140 - 713);
    assert.equal(p.safeToSpend, 1000 - 140 - 713 - 100);
    assert.equal(p.days[15].balance, 1000 - 150 - 713 + 2000); // payday Nov 1
    assert.equal(p.lowPoint.date, "2026-10-31");
    assert.equal(p.paychecks.length, 1);
    assert.equal(p.paychecks[0].bills, 300);
    assert.equal(p.paychecks[0].shortfall, 0);
  });
  test("a paycheck that cannot cover its bills shows a shortfall", () => {
    const p = project({ today: "2026-10-17", startBalance: 0, horizonDays: 40, paydays: [{ date: "2026-11-01", label: "Pay", amount: 500, kind: "payday" }, { date: "2026-11-15", label: "Pay", amount: 500, kind: "payday" }], bills: [{ date: "2026-11-02", label: "Rent", amount: 700, kind: "bill" }], dailyVariable: 0, buffer: 0 });
    assert.equal(p.paychecks[0].shortfall, 200);
    assert.equal(p.paychecks[1].shortfall, 0);
  });
  test("bills due today are already subtracted; no payday ahead means the low point over the horizon", () => {
    const p = project({ today: "2026-10-17", startBalance: 100, horizonDays: 5, paydays: [], bills: [{ date: "2026-10-17", label: "Gym", amount: 30, kind: "bill" }], dailyVariable: 5, buffer: 0 });
    assert.equal(p.days[0].balance, 70);
    assert.equal(p.safeToSpend, 70 - 25);
  });
});

describe("logged paydays", () => {
  test("a payday already logged as income in that month is dropped once", () => {
    const pays: Event[] = [{ date: "2026-10-17", label: "Salary", amount: 3000, kind: "payday" }, { date: "2026-11-01", label: "Salary", amount: 3000, kind: "payday" }];
    assert.deepEqual(dropLoggedPaydays(pays, [{ month: "2026-10", amount: 2990 }]).map((p) => p.date), ["2026-11-01"]);
    assert.equal(dropLoggedPaydays(pays, [{ month: "2026-10", amount: 500 }]).length, 2);
  });
});
