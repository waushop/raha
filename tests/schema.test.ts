import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "@/lib/schema";

function tableNames(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
}
function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
}

describe("schema", () => {
  test("fresh database gets every table, index and trigger", () => {
    const db = new DatabaseSync(":memory:");
    initSchema(db);
    assert.deepEqual(tableNames(db), ["APP_SETTING", "BUDGET", "BUDGET_HISTORY", "CATEGORY_GROUP", "IMPORT_PATTERN", "LEDGER", "LEDGER_AUDIT", "LEDGER_TAG", "SAVINGS_GOAL"]);
    assert.ok(columns(db, "LEDGER").includes("KIND"));
    assert.ok(columns(db, "LEDGER").includes("DAY"));
    assert.ok(columns(db, "LEDGER").includes("GOAL_ID"));
    const triggers = (db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as Array<{ name: string }>).map((r) => r.name);
    assert.ok(triggers.includes("TRG_LEDGER_UPDATED_AT"));
    assert.ok(triggers.includes("TRG_CATEGORY_GROUP_UPDATED_AT"));
  });

  test("initSchema is idempotent", () => {
    const db = new DatabaseSync(":memory:");
    initSchema(db);
    initSchema(db);
    assert.equal(tableNames(db).length, 9);
  });

  test("migrates a pre-income database: renames tables and adds KIND", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE EXPENSE_GROUP (
      ID TEXT NOT NULL PRIMARY KEY, CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, DELETED_AT TEXT,
      NAME TEXT NOT NULL, EMOJI TEXT, COLOR TEXT NOT NULL DEFAULT 'blue', SORT_ORDER INTEGER NOT NULL DEFAULT 0)`);
    db.exec(`CREATE TABLE EXPENSE (
      ID TEXT NOT NULL PRIMARY KEY, CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, DELETED_AT TEXT,
      CATEGORY TEXT NOT NULL DEFAULT 'other', GROUP_ID TEXT, NAME TEXT NOT NULL, AMOUNT REAL NOT NULL,
      MONTH TEXT NOT NULL, NOTES TEXT, IS_RECURRING INTEGER NOT NULL DEFAULT 0, TAGS TEXT)`);
    db.exec(`CREATE TRIGGER TRG_EXPENSE_UPDATED_AT AFTER UPDATE OF NAME ON EXPENSE
      BEGIN UPDATE EXPENSE SET UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = NEW.ID; END`);
    db.exec(`INSERT INTO EXPENSE_GROUP (ID, NAME) VALUES ('g1', 'Home')`);
    db.exec(`INSERT INTO EXPENSE (ID, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH) VALUES ('e1', 'housing', 'g1', 'Rent', 900, '2026-01')`);

    initSchema(db);

    const names = tableNames(db);
    assert.ok(names.includes("LEDGER") && names.includes("CATEGORY_GROUP"));
    assert.ok(!names.includes("EXPENSE") && !names.includes("EXPENSE_GROUP"));
    const row = { ...(db.prepare("SELECT KIND, NAME, GROUP_ID FROM LEDGER WHERE ID = 'e1'").get() as { KIND: string; NAME: string; GROUP_ID: string }) };
    assert.deepEqual(row, { KIND: "expense", NAME: "Rent", GROUP_ID: "g1" });
    const group = db.prepare("SELECT NAME FROM CATEGORY_GROUP WHERE ID = 'g1'").get() as { NAME: string };
    assert.equal(group.NAME, "Home");
  });

  test("adds DAY to an older LEDGER and backfills LEDGER_TAG from TAGS text", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE LEDGER (
      ID TEXT NOT NULL PRIMARY KEY, CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, DELETED_AT TEXT, KIND TEXT NOT NULL DEFAULT 'expense',
      CATEGORY TEXT NOT NULL DEFAULT 'other', GROUP_ID TEXT, NAME TEXT NOT NULL, AMOUNT REAL NOT NULL,
      MONTH TEXT NOT NULL, NOTES TEXT, IS_RECURRING INTEGER NOT NULL DEFAULT 0, TAGS TEXT)`);
    db.exec(`INSERT INTO LEDGER (ID, NAME, AMOUNT, MONTH, TAGS) VALUES ('t1', 'Trip', 100, '2026-07', '#travel, #Family')`);
    initSchema(db);
    assert.ok(columns(db, "LEDGER").includes("DAY"));
    const tags = (db.prepare("SELECT TAG FROM LEDGER_TAG WHERE LEDGER_ID = 't1' ORDER BY TAG").all() as Array<{ TAG: string }>).map((r) => r.TAG);
    assert.deepEqual(tags, ["family", "travel"]);
    // the rebuilt trigger covers DAY
    db.exec("UPDATE LEDGER SET UPDATED_AT = '2020-01-01 00:00:00' WHERE ID = 't1'");
    db.exec("UPDATE LEDGER SET DAY = 5 WHERE ID = 't1'");
    const row = db.prepare("SELECT UPDATED_AT FROM LEDGER WHERE ID = 't1'").get() as { UPDATED_AT: string };
    assert.notEqual(row.UPDATED_AT, "2020-01-01 00:00:00");
  });

  test("UPDATED_AT trigger fires on data changes but not on insert", () => {
    const db = new DatabaseSync(":memory:");
    initSchema(db);
    db.exec(`INSERT INTO LEDGER (ID, NAME, AMOUNT, MONTH, CREATED_AT, UPDATED_AT)
             VALUES ('x', 'Coffee', 3.5, '2026-02', '2020-01-01 00:00:00', '2020-01-01 00:00:00')`);
    db.exec(`UPDATE LEDGER SET AMOUNT = 4 WHERE ID = 'x'`);
    const row = db.prepare("SELECT UPDATED_AT, CREATED_AT FROM LEDGER WHERE ID = 'x'").get() as { UPDATED_AT: string; CREATED_AT: string };
    assert.equal(row.CREATED_AT, "2020-01-01 00:00:00");
    assert.notEqual(row.UPDATED_AT, "2020-01-01 00:00:00");
  });
});
