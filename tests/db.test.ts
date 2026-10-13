import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";

describe("db shim", () => {
  let db: typeof import("@/lib/db").default;
  before(async () => {
    db = (await import("@/lib/db")).default;
  });

  test("execute returns plain-object rows for SELECT and change counts for writes", async () => {
    const [ins] = await db.execute("INSERT INTO CATEGORY_GROUP (ID, NAME) VALUES (?, ?)", ["g-exec", "Exec"]);
    assert.equal((ins as { affectedRows: number }).affectedRows, 1);
    const [rows] = await db.execute("SELECT ID, NAME FROM CATEGORY_GROUP WHERE ID = ?", ["g-exec"]);
    assert.deepEqual(rows, [{ ID: "g-exec", NAME: "Exec" }]);
    assert.equal(Object.getPrototypeOf((rows as object[])[0]), Object.prototype, "rows must be RSC-serialisable");
  });

  test("transaction commits on success", async () => {
    const count = db.transaction((tx) => {
      tx.run("INSERT INTO LEDGER (ID, NAME, AMOUNT, MONTH) VALUES (?, ?, ?, ?)", ["t1", "A", 1, "2026-01"]);
      tx.run("INSERT INTO LEDGER (ID, NAME, AMOUNT, MONTH) VALUES (?, ?, ?, ?)", ["t2", "B", 2, "2026-01"]);
      return tx.all<{ N: number }>("SELECT COUNT(*) AS N FROM LEDGER WHERE MONTH = '2026-01'")[0].N;
    });
    assert.equal(count, 2);
    const [rows] = await db.execute("SELECT COUNT(*) AS N FROM LEDGER WHERE MONTH = '2026-01'");
    assert.equal((rows as Array<{ N: number }>)[0].N, 2);
  });

  test("transaction rolls back everything when the callback throws", async () => {
    assert.throws(() =>
      db.transaction((tx) => {
        tx.run("INSERT INTO LEDGER (ID, NAME, AMOUNT, MONTH) VALUES (?, ?, ?, ?)", ["t3", "C", 3, "2026-02"]);
        throw new Error("boom");
      }),
    /boom/);
    const [rows] = await db.execute("SELECT COUNT(*) AS N FROM LEDGER WHERE MONTH = '2026-02'");
    assert.equal((rows as Array<{ N: number }>)[0].N, 0);
  });

  test("transaction refuses async callbacks", async () => {
    assert.throws(() => db.transaction(async () => {}), /synchronous/);
    // and the connection is usable afterwards (no dangling BEGIN)
    const [rows] = await db.execute("SELECT 1 AS ONE");
    assert.deepEqual(rows, [{ ONE: 1 }]);
  });
});
