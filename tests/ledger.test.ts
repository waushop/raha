import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DB_PATH = ":memory:";

type Db = typeof import("@/lib/db").default;
type Ledger = typeof import("@/lib/ledger");
type LedgerSource = import("@/lib/ledger").LedgerSource;

describe("ledger writes", () => {
  let db: Db;
  let ledger: Ledger;
  const WS = randomUUID();
  const OTHER = randomUUID();
  const home = randomUUID();
  const car = randomUUID();

  before(async () => {
    db = (await import("@/lib/db")).default;
    ledger = await import("@/lib/ledger");
  });

  beforeEach(async () => {
    await db.execute("DELETE FROM LEDGER");
    await db.execute("DELETE FROM CATEGORY_GROUP");
    await db.execute("DELETE FROM IMPORT_PATTERN");
    await db.execute("INSERT INTO CATEGORY_GROUP (ID, WORKSPACE_ID, NAME, SORT_ORDER) VALUES (?, ?, 'Home', 0), (?, ?, 'Car', 1)", [home, WS, car, WS]);
  });

  const row = (over: Partial<LedgerSource> = {}): LedgerSource => ({
    KIND: "expense" as const, CATEGORY: "groceries", GROUP_ID: home, NAME: "Rimi", AMOUNT: 42.1,
    NOTES: null, IS_RECURRING: 0, TAGS: null, DAY: null, ...over,
  });
  const count = async (where = "1=1", params: unknown[] = []) => {
    const [r] = await db.execute(`SELECT COUNT(*) AS N FROM LEDGER WHERE DELETED_AT IS NULL AND ${where}`, params);
    return (r as Array<{ N: number }>)[0].N;
  };

  test("copyMonth copies live rows once, skipping name+amount duplicates", async () => {
    db.transaction((tx) => {
      ledger.insertRow(tx, WS, row(), "2026-01");
      ledger.insertRow(tx, WS, row({ NAME: "Salary", KIND: "income", AMOUNT: 2850 }), "2026-01");
      ledger.insertRow(tx, WS, row({ NAME: "Rimi", AMOUNT: 42.1 }), "2026-02"); // already there
    });
    assert.equal(ledger.copyMonth(WS, "2026-01", "2026-02"), 1);
    assert.equal(ledger.copyMonth(WS, "2026-01", "2026-02"), 0, "re-run is a no-op");
    assert.equal(await count("MONTH = '2026-02'"), 2);
    assert.equal(await count("MONTH = '2026-02' AND KIND = 'income'"), 1, "income kind preserved");
  });

  test("copyMonth ignores soft-deleted rows and is a no-op onto itself", async () => {
    db.transaction((tx) => {
      ledger.insertRow(tx, WS, row(), "2026-03");
      ledger.insertRow(tx, WS, row({ NAME: "Deleted" }), "2026-03");
    });
    await db.execute("UPDATE LEDGER SET DELETED_AT = CURRENT_TIMESTAMP WHERE NAME = 'Deleted'");
    assert.equal(ledger.copyMonth(WS, "2026-03", "2026-03"), 0);
    assert.equal(ledger.copyMonth(WS, "2026-03", "2026-04"), 1);
  });

  test("backfill fills several months atomically", async () => {
    db.transaction((tx) => ledger.insertRow(tx, WS, row(), "2026-01"));
    assert.equal(ledger.backfill(WS, "2026-01", ["2026-02", "2026-03", "2026-01", "2026-03"]), 2);
    assert.equal(await count("MONTH IN ('2026-02','2026-03')"), 2);
  });

  test("copyRecurring takes the latest earlier month's recurring rows by name", async () => {
    db.transaction((tx) => {
      ledger.insertRow(tx, WS, row({ NAME: "Netflix", AMOUNT: 9.99, IS_RECURRING: 1 }), "2025-12");
      ledger.insertRow(tx, WS, row({ NAME: "Netflix", AMOUNT: 12.99, IS_RECURRING: 1 }), "2026-01");
      ledger.insertRow(tx, WS, row({ NAME: "Gym", AMOUNT: 39, IS_RECURRING: 1 }), "2026-01");
      ledger.insertRow(tx, WS, row({ NAME: "One-off", AMOUNT: 5 }), "2026-01");
      ledger.insertRow(tx, WS, row({ NAME: "Gym", AMOUNT: 39 }), "2026-02"); // present already
    });
    assert.equal(ledger.copyRecurring(WS, "2026-02"), 1);
    const [rows] = await db.execute("SELECT NAME, AMOUNT, IS_RECURRING FROM LEDGER WHERE MONTH = '2026-02' AND NAME = 'Netflix'");
    assert.deepEqual(rows, [{ NAME: "Netflix", AMOUNT: 12.99, IS_RECURRING: 1 }], "uses the most recent price");
  });

  test("importRows dedups within the batch and against the database, keeps kind", async () => {
    db.transaction((tx) => ledger.insertRow(tx, WS, row({ NAME: "Rimi", AMOUNT: 10 }), "2026-05"));
    const n = ledger.importRows(WS, [
      { category: "groceries", groupId: null, name: "Rimi", amount: 10, month: "2026-05", notes: null },
      { category: "groceries", groupId: null, name: "Selver", amount: 20, month: "2026-05", notes: "x" },
      { category: "groceries", groupId: null, name: "Selver", amount: 20, month: "2026-05", notes: "dup" },
      { category: "other", groupId: null, name: "Salary", amount: 2850, month: "2026-05", notes: null, kind: "income", isRecurring: true },
    ]);
    assert.equal(n, 2);
    assert.equal(await count("MONTH = '2026-05'"), 3);
    assert.equal(await count("MONTH = '2026-05' AND KIND = 'income' AND IS_RECURRING = 1"), 1);
  });

  test("removeGroup unlinks live rows only and clears import patterns", async () => {
    db.transaction((tx) => {
      ledger.insertRow(tx, WS, row({ NAME: "Live" }), "2026-06");
      ledger.insertRow(tx, WS, row({ NAME: "Gone" }), "2026-06");
    });
    await db.execute("UPDATE LEDGER SET DELETED_AT = CURRENT_TIMESTAMP WHERE NAME = 'Gone'");
    await db.execute("INSERT INTO IMPORT_PATTERN (ID, PATTERN, CATEGORY, GROUP_ID) VALUES (?, 'RIMI', 'groceries', ?)", [randomUUID(), home]);
    ledger.removeGroup(WS, home);
    const [rows] = await db.execute("SELECT NAME, GROUP_ID FROM LEDGER ORDER BY NAME");
    assert.deepEqual(rows, [{ NAME: "Gone", GROUP_ID: home }, { NAME: "Live", GROUP_ID: null }]);
    const [p] = await db.execute("SELECT GROUP_ID FROM IMPORT_PATTERN");
    assert.deepEqual(p, [{ GROUP_ID: null }]);
    const [g] = await db.execute("SELECT DELETED_AT IS NOT NULL AS D FROM CATEGORY_GROUP WHERE ID = ?", [home]);
    assert.deepEqual(g, [{ D: 1 }]);
  });

  test("reorderGroup swaps neighbours and renumbers; edges are no-ops", async () => {
    const order = async () => ((await db.execute("SELECT ID FROM CATEGORY_GROUP WHERE DELETED_AT IS NULL ORDER BY SORT_ORDER, NAME"))[0] as Array<{ ID: string }>).map((r) => r.ID);
    assert.deepEqual(await order(), [home, car]);
    ledger.reorderGroup(WS, car, -1);
    assert.deepEqual(await order(), [car, home]);
    ledger.reorderGroup(WS, car, -1);
    assert.deepEqual(await order(), [car, home], "already first");
    ledger.reorderGroup(WS, randomUUID(), 1);
    assert.deepEqual(await order(), [car, home], "unknown id ignored");
  });

  test("insertRow writes tag rows and clamps the day to the target month", async () => {
    const id = db.transaction((tx) => ledger.insertRow(tx, WS, row({ TAGS: "#Travel, kids #travel", DAY: 31 }), "2026-02"));
    const [tags] = await db.execute("SELECT TAG FROM LEDGER_TAG WHERE LEDGER_ID = ? ORDER BY TAG", [id]);
    assert.deepEqual(tags, [{ TAG: "kids" }, { TAG: "travel" }]);
    const [r] = await db.execute("SELECT DAY FROM LEDGER WHERE ID = ?", [id]);
    assert.deepEqual(r, [{ DAY: 28 }]);
    db.transaction((tx) => ledger.syncTags(tx, id, "#one"));
    const [after] = await db.execute("SELECT TAG FROM LEDGER_TAG WHERE LEDGER_ID = ?", [id]);
    assert.deepEqual(after, [{ TAG: "one" }]);
  });

  test("writes an audit trail: create, then an audited update with before/after", async () => {
    const id = db.transaction((tx) => ledger.insertRow(tx, WS, row({ NAME: "Netflix", AMOUNT: 9.99 }), "2026-08"));
    db.transaction((tx) => ledger.auditedUpdate(tx, id, "update", () => tx.run("UPDATE LEDGER SET AMOUNT = 12.99 WHERE ID = ?", [id])));
    const [rows] = await db.execute("SELECT ACTION, BEFORE_JSON, AFTER_JSON FROM LEDGER_AUDIT WHERE LEDGER_ID = ? ORDER BY ROWID", [id]);
    const events = rows as Array<{ ACTION: string; BEFORE_JSON: string | null; AFTER_JSON: string | null }>;
    assert.deepEqual(events.map((e) => e.ACTION), ["create", "update"]);
    assert.equal(events[0].BEFORE_JSON, null);
    assert.equal(JSON.parse(events[0].AFTER_JSON!).NAME, "Netflix");
    assert.equal(JSON.parse(events[1].BEFORE_JSON!).AMOUNT, 9.99);
    assert.equal(JSON.parse(events[1].AFTER_JSON!).AMOUNT, 12.99);
    assert.equal(db.transaction((tx) => ledger.auditedUpdate(tx, randomUUID(), "update", () => {})), false, "unknown row → false, no audit");
  });

  test("workspaces are isolated: another workspace's rows are invisible to copies and dedup", async () => {
    db.transaction((tx) => {
      ledger.insertRow(tx, WS, row({ NAME: "Mine" }), "2026-09");
      ledger.insertRow(tx, OTHER, row({ NAME: "Theirs", GROUP_ID: null }), "2026-09");
    });
    assert.equal(ledger.copyMonth(WS, "2026-09", "2026-10"), 1, "only my row is copied");
    assert.equal(await count("WORKSPACE_ID = ? AND MONTH = '2026-10'", [WS]), 1);
    assert.equal(await count("WORKSPACE_ID = ? AND MONTH = '2026-10'", [OTHER]), 0);
    assert.throws(() => db.transaction((tx) => ledger.assertGroupExists(tx, OTHER, home)), /no longer exists/, "my group isn't valid in their workspace");
    ledger.removeGroup(OTHER, home);
    const [g] = await db.execute("SELECT DELETED_AT FROM CATEGORY_GROUP WHERE ID = ?", [home]);
    assert.deepEqual(g, [{ DELETED_AT: null }], "can't delete another workspace's group");
  });

  test("assertGroupExists rejects deleted or unknown groups", () => {
    assert.throws(() => db.transaction((tx) => ledger.assertGroupExists(tx, WS, randomUUID())), /no longer exists/);
    assert.doesNotThrow(() => db.transaction((tx) => ledger.assertGroupExists(tx, WS, null)));
    assert.doesNotThrow(() => db.transaction((tx) => ledger.assertGroupExists(tx, WS, home)));
  });
});
