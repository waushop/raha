import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
const WS = "11111111-1111-4111-8111-111111111111";

describe("budget history", () => {
  let db: typeof import("@/lib/db").default;
  let budgets: typeof import("@/lib/budgets");
  before(async () => {
    db = (await import("@/lib/db")).default;
    budgets = await import("@/lib/budgets");
  });
  beforeEach(async () => {
    await db.execute("DELETE FROM BUDGET");
    await db.execute("DELETE FROM BUDGET_HISTORY");
  });

  test("snapshot records resolved budgets (defaults included) for a month and replaces on re-run", async () => {
    await db.execute("INSERT INTO BUDGET (WORKSPACE_ID, CATEGORY, AMOUNT) VALUES (?, 'groceries', 400), (?, '_total', 2600)", [WS, WS]);
    await budgets.snapshotBudgets(WS, "2026-03");
    let history = await budgets.getBudgetHistory(WS);
    assert.equal(history.get("2026-03")?.total, 2600);
    assert.equal(history.get("2026-03")?.categories.groceries, 400);
    assert.equal(history.get("2026-03")?.categories.housing, budgets.DEFAULT_CATEGORY_BUDGETS.housing, "defaults are part of the snapshot");

    await db.execute("UPDATE BUDGET SET AMOUNT = 450 WHERE CATEGORY = 'groceries'");
    await budgets.snapshotBudgets(WS, "2026-03");
    history = await budgets.getBudgetHistory(WS);
    assert.equal(history.get("2026-03")?.categories.groceries, 450);
  });

  test("setBudgetAmount snapshots the current month; ensureBudgetSnapshot only fills gaps", async () => {
    await budgets.setBudgetAmount(WS, "fuel", 180);
    const history = await budgets.getBudgetHistory(WS);
    assert.equal(history.size, 1);
    const [[month, snap]] = [...history.entries()];
    assert.match(month, /^\d{4}-\d{2}$/);
    assert.equal(snap.categories.fuel, 180);

    await db.execute("UPDATE BUDGET SET AMOUNT = 999 WHERE CATEGORY = 'fuel'");
    await budgets.ensureBudgetSnapshot(WS, month);
    assert.equal((await budgets.getBudgetHistory(WS)).get(month)?.categories.fuel, 180, "existing snapshot untouched");
    await budgets.ensureBudgetSnapshot(WS, "1999-01");
    assert.equal((await budgets.getBudgetHistory(WS)).get("1999-01")?.categories.fuel, 999);
  });

  test("resolveBudgetsFor picks the latest snapshot at or before the month, else current", () => {
    const current = { total: 1000, categories: { fuel: 10 } };
    const history = new Map([
      ["2026-02", { total: 2000, categories: { fuel: 20 } }],
      ["2026-05", { total: 3000, categories: { fuel: 30 } }],
    ]);
    assert.equal(budgets.resolveBudgetsFor("2026-01", history, current).total, 1000);
    assert.equal(budgets.resolveBudgetsFor("2026-02", history, current).total, 2000);
    assert.equal(budgets.resolveBudgetsFor("2026-04", history, current).total, 2000);
    assert.equal(budgets.resolveBudgetsFor("2026-09", history, current).total, 3000);
  });
});
