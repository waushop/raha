import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fundBalancesBefore, linesFromAverages, linesFromSubscriptions, matchRows, roundTo, summarise, type PlanLine, type PlanRow } from "@/lib/plan";

const line = (o: Partial<PlanLine> & { ID: string; LABEL: string; PLANNED: number }): PlanLine => ({
  MONTH: "2026-10", KIND: "expense", CATEGORY: "groceries", GROUP_ID: null, SORT_ORDER: 0, SUBSCRIPTION_ID: null, ...o,
});
const row = (o: Partial<PlanRow> & { ID: string; AMOUNT: number }): PlanRow => ({
  KIND: "expense", CATEGORY: "groceries", GROUP_ID: null, NAME: "x", SUBSCRIPTION_ID: null, ...o,
});

describe("plan matching", () => {
  test("subscription link beats category, category+group beats category-only, else unplanned", () => {
    const lines = [
      line({ ID: "sub", LABEL: "Netflix", PLANNED: 13, CATEGORY: "subscriptions", GROUP_ID: "fun", SUBSCRIPTION_ID: "s1", SORT_ORDER: 2 }),
      line({ ID: "subs-fun", LABEL: "Streaming", PLANNED: 30, CATEGORY: "subscriptions", GROUP_ID: "fun", SORT_ORDER: 1 }),
      line({ ID: "groc", LABEL: "Groceries", PLANNED: 450, SORT_ORDER: 0 }),
    ];
    const rows = [
      row({ ID: "r1", AMOUNT: 13, CATEGORY: "subscriptions", GROUP_ID: "fun", SUBSCRIPTION_ID: "s1" }),
      row({ ID: "r2", AMOUNT: 18, CATEGORY: "subscriptions", GROUP_ID: "fun" }),
      row({ ID: "r3", AMOUNT: 60, GROUP_ID: "home" }),
      row({ ID: "r4", AMOUNT: 9, CATEGORY: "dining", GROUP_ID: "fun" }),
      row({ ID: "r5", AMOUNT: 2850, KIND: "income", CATEGORY: "other" }),
    ];
    const m = matchRows(lines, rows);
    assert.deepEqual([...m.entries()], [["r1", "sub"], ["r2", "subs-fun"], ["r3", "groc"]]);
  });

  test("a row of another subscription does not land on a subscription line", () => {
    const lines = [line({ ID: "nf", LABEL: "Netflix", PLANNED: 13, CATEGORY: "subscriptions", SUBSCRIPTION_ID: "s1" })];
    const rows = [row({ ID: "sp", AMOUNT: 11, CATEGORY: "subscriptions", SUBSCRIPTION_ID: "s2" }), row({ ID: "x", AMOUNT: 3, CATEGORY: "subscriptions" })];
    assert.deepEqual([...matchRows(lines, rows).entries()], []);
  });

  test("a generic line wins the category match over a subscription line that sorts first", () => {
    const lines = [
      line({ ID: "idx", LABEL: "Index fund", PLANNED: 250, CATEGORY: "savings", SUBSCRIPTION_ID: "s1", SORT_ORDER: 0 }),
      line({ ID: "sav", LABEL: "Savings", PLANNED: 120, CATEGORY: "savings", SORT_ORDER: 1 }),
    ];
    const rows = [row({ ID: "a", AMOUNT: 250, CATEGORY: "savings", SUBSCRIPTION_ID: "s1" }), row({ ID: "b", AMOUNT: 120, CATEGORY: "savings" })];
    assert.deepEqual([...matchRows(lines, rows).entries()], [["a", "idx"], ["b", "sav"]]);
  });

  test("summarise computes left to plan, remaining per line and unplanned groups", () => {
    const lines = [
      line({ ID: "inc", LABEL: "Salary", PLANNED: 2000, KIND: "income", CATEGORY: "other" }),
      line({ ID: "groc", LABEL: "Groceries", PLANNED: 450 }),
      line({ ID: "car", LABEL: "Car repairs", PLANNED: 50, KIND: "fund", CATEGORY: "maintenance", GROUP_ID: "car" }),
    ];
    const rows = [
      row({ ID: "i1", AMOUNT: 2100, KIND: "income", CATEGORY: "other" }),
      row({ ID: "g1", AMOUNT: 300 }), row({ ID: "g2", AMOUNT: 200 }),
      row({ ID: "c1", AMOUNT: 20, CATEGORY: "maintenance", GROUP_ID: "car" }),
      row({ ID: "u1", AMOUNT: 40, CATEGORY: "dining", GROUP_ID: "fun" }),
      row({ ID: "u2", AMOUNT: 5, CATEGORY: "dining", GROUP_ID: "fun" }),
    ];
    const s = summarise(lines, rows, new Map([["maintenance\u0000car\u0000car repairs", 100]]));
    assert.equal(s.plannedIncome, 2000);
    assert.equal(s.plannedSpending, 500);
    assert.equal(s.leftToPlan, 1500);
    assert.equal(s.actualIncome, 2100);
    assert.equal(s.actualSpending, 565);
    assert.equal(s.unplannedSpending, 45);
    const groc = s.lines.find((l) => l.ID === "groc")!;
    assert.deepEqual({ actual: groc.actual, remaining: groc.remaining, rows: groc.rows, balance: groc.balance }, { actual: 500, remaining: -50, rows: 2, balance: null });
    const inc = s.lines.find((l) => l.ID === "inc")!;
    assert.equal(inc.remaining, 100);
    const car = s.lines.find((l) => l.ID === "car")!;
    assert.equal(car.balance, 130);
    assert.deepEqual(s.unplanned, [{ KIND: "expense", CATEGORY: "dining", GROUP_ID: "fun", amount: 45, rows: 2 }]);
  });

  test("fund carry-forward ignores rows that belong to the month's expense lines", () => {
    const sep = [
      line({ ID: "nf", MONTH: "2026-09", LABEL: "Netflix", PLANNED: 15, CATEGORY: "subscriptions", SUBSCRIPTION_ID: "s1" }),
      line({ ID: "dom", MONTH: "2026-09", LABEL: "Domain", PLANNED: 10, KIND: "fund", CATEGORY: "subscriptions", SUBSCRIPTION_ID: "s2" }),
    ];
    const before = fundBalancesBefore([{ month: "2026-09", lines: sep, rows: [row({ ID: "c", AMOUNT: 15, CATEGORY: "subscriptions", SUBSCRIPTION_ID: "s1" })] }], "2026-10");
    assert.equal(before.get("subscriptions\u0000\u0000domain"), 10);
  });

  test("fund balances roll over month to month", () => {
    const fund = (month: string, planned: number, id: string) => line({ ID: id, MONTH: month, LABEL: "Car repairs", PLANNED: planned, KIND: "fund", CATEGORY: "maintenance", GROUP_ID: "car" });
    const history = [
      { month: "2026-08", lines: [fund("2026-08", 50, "a")], rows: [] },
      { month: "2026-09", lines: [fund("2026-09", 50, "b")], rows: [row({ ID: "x", AMOUNT: 30, CATEGORY: "maintenance", GROUP_ID: "car" })] },
      { month: "2026-10", lines: [fund("2026-10", 50, "c")], rows: [] },
    ];
    const before = fundBalancesBefore(history, "2026-10");
    assert.equal(before.get("maintenance\u0000car\u0000car repairs"), 70);
    const oct = summarise(history[2].lines, history[2].rows, before);
    assert.equal(oct.lines[0].balance, 120);
  });

  test("averages round to 5 and subscriptions become expense or fund lines", () => {
    assert.equal(roundTo(447.3), 445);
    assert.equal(roundTo(2), 5);
    const fromAvg = linesFromAverages([{ KIND: "expense", CATEGORY: "groceries", GROUP_ID: null, AVG: 447.3, LABEL: "Groceries" }, { KIND: "expense", CATEGORY: "pets", GROUP_ID: null, AVG: 0, LABEL: "Pets" }]);
    assert.deepEqual(fromAvg, [{ KIND: "expense", CATEGORY: "groceries", GROUP_ID: null, LABEL: "Groceries", PLANNED: 445, SUBSCRIPTION_ID: null }]);
    const fromSubs = linesFromSubscriptions([
      { ID: "s1", NAME: "Netflix", CATEGORY: "subscriptions", GROUP_ID: "fun", AMOUNT: 12.99, CADENCE: "monthly" },
      { ID: "s2", NAME: "Domain", CATEGORY: "internet", GROUP_ID: null, AMOUNT: 24, CADENCE: "yearly" },
    ]);
    assert.deepEqual(fromSubs.map((l) => [l.KIND, l.LABEL, l.PLANNED, l.SUBSCRIPTION_ID]), [["expense", "Netflix", 12.99, "s1"], ["fund", "Domain", 2, "s2"]]);
  });
});
