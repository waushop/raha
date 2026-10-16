import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DB_PATH = ":memory:";

describe("savings goals", () => {
  let db: typeof import("@/lib/db").default;
  let goals: typeof import("@/lib/goals");
  let months: typeof import("@/lib/months");
  before(async () => {
    db = (await import("@/lib/db")).default;
    goals = await import("@/lib/goals");
    months = await import("@/lib/months");
  });
  beforeEach(async () => {
    await db.execute("DELETE FROM LEDGER");
    await db.execute("DELETE FROM SAVINGS_GOAL");
  });

  async function contribute(goalId: string, month: string, amount: number) {
    await db.execute("INSERT INTO LEDGER (ID, KIND, CATEGORY, NAME, AMOUNT, MONTH, GOAL_ID) VALUES (?, 'expense', 'savings', 'Transfer', ?, ?, ?)", [randomUUID(), amount, month, goalId]);
  }

  test("progress adds starting amount and linked rows; pace comes from the last three months", async () => {
    const id = randomUUID();
    const now = months.currentMonth();
    await db.execute("INSERT INTO SAVINGS_GOAL (ID, NAME, TARGET_AMOUNT, TARGET_MONTH, STARTING_AMOUNT) VALUES (?, 'Fund', 1000, ?, 100)", [id, months.addMonths(now, 6)]);
    await contribute(id, months.addMonths(now, -5), 500); // old, counts for total but not pace
    await contribute(id, months.addMonths(now, -1), 90);
    await contribute(id, now, 90);
    const [g] = await goals.listGoals();
    assert.equal(g.saved, 780);
    assert.equal(g.remaining, 220);
    assert.equal(Math.round(g.pct), 78);
    assert.equal(g.recentPerMonth, 60);
    assert.equal(g.monthsLeft, 6);
    assert.ok(Math.abs(g.neededPerMonth! - 220 / 6) < 0.01);
    assert.equal(g.projectedMonth, months.addMonths(now, 4), "220 left at 60/month → 4 months");
    assert.equal(g.status, "on-track");
  });

  test("behind when the pace misses the deadline, done when target reached, ignores deleted rows", async () => {
    const id = randomUUID();
    const now = months.currentMonth();
    await db.execute("INSERT INTO SAVINGS_GOAL (ID, NAME, TARGET_AMOUNT, TARGET_MONTH) VALUES (?, 'Trip', 1000, ?)", [id, months.addMonths(now, 2)]);
    await contribute(id, now, 100);
    assert.equal((await goals.listGoals())[0].status, "behind");

    await contribute(id, now, 900);
    const [done] = await goals.listGoals();
    assert.equal(done.status, "done");
    assert.equal(done.pct, 100);

    await db.execute("UPDATE LEDGER SET DELETED_AT = CURRENT_TIMESTAMP WHERE AMOUNT = 900");
    assert.equal((await goals.listGoals())[0].saved, 100);
  });

  test("no deadline and no contributions → no-deadline with no projection", async () => {
    await db.execute("INSERT INTO SAVINGS_GOAL (ID, NAME, TARGET_AMOUNT) VALUES (?, 'Someday', 500)", [randomUUID()]);
    const [g] = await goals.listGoals();
    assert.equal(g.status, "no-deadline");
    assert.equal(g.projectedMonth, null);
    assert.equal(g.neededPerMonth, null);
  });
});
