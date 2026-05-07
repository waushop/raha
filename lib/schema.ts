import type { DatabaseSync } from "node:sqlite";

// One-shot migrations (idempotent). Run before the CREATE … IF NOT EXISTS
// block so renamed tables exist under their new names by the time the
// declarative schema runs.
function migrate(sqlite: DatabaseSync): void {
  const tables = new Set(
    (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
      name: string;
    }>).map((r) => r.name),
  );

  // EXPENSE → LEDGER. The table now holds both expenses and income, so the
  // expense-only name is misleading. Drop the trigger first because triggers
  // pre-3.25 don't follow renames; even on modern SQLite, dropping is safer
  // since we recreate it under the new name below.
  if (tables.has("EXPENSE") && !tables.has("LEDGER")) {
    sqlite.exec("DROP TRIGGER IF EXISTS TRG_EXPENSE_UPDATED_AT");
    sqlite.exec("ALTER TABLE EXPENSE RENAME TO LEDGER");
    tables.delete("EXPENSE");
    tables.add("LEDGER");
  }

  // EXPENSE_GROUP → CATEGORY_GROUP. These groups are conceptually groups of
  // categories, not expenses; the old name was misleading from day one.
  if (tables.has("EXPENSE_GROUP") && !tables.has("CATEGORY_GROUP")) {
    sqlite.exec("DROP TRIGGER IF EXISTS TRG_EXPENSE_GROUP_UPDATED_AT");
    sqlite.exec("ALTER TABLE EXPENSE_GROUP RENAME TO CATEGORY_GROUP");
    tables.delete("EXPENSE_GROUP");
    tables.add("CATEGORY_GROUP");
  }

  // Add LEDGER.KIND if it's a pre-existing table without the column. New
  // installs get the column from CREATE TABLE below.
  if (tables.has("LEDGER")) {
    const cols = (sqlite.prepare("PRAGMA table_info(LEDGER)").all() as Array<{
      name: string;
    }>).map((r) => r.name);
    if (!cols.includes("KIND")) {
      sqlite.exec("ALTER TABLE LEDGER ADD COLUMN KIND TEXT NOT NULL DEFAULT 'expense'");
    }
  }
}

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS CATEGORY_GROUP (
    ID          TEXT NOT NULL PRIMARY KEY,
    CREATED_AT  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    DELETED_AT  TEXT,
    NAME        TEXT NOT NULL,
    EMOJI       TEXT,
    COLOR       TEXT NOT NULL DEFAULT 'blue',
    SORT_ORDER  INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS LEDGER (
    ID           TEXT NOT NULL PRIMARY KEY,
    CREATED_AT   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    DELETED_AT   TEXT,
    KIND         TEXT NOT NULL DEFAULT 'expense',
    CATEGORY     TEXT NOT NULL DEFAULT 'other',
    GROUP_ID     TEXT,
    NAME         TEXT NOT NULL,
    AMOUNT       REAL NOT NULL,
    MONTH        TEXT NOT NULL,
    NOTES        TEXT,
    IS_RECURRING INTEGER NOT NULL DEFAULT 0,
    TAGS         TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_MONTH      ON LEDGER(MONTH)`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_DELETED_AT ON LEDGER(DELETED_AT)`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_GROUP      ON LEDGER(GROUP_ID)`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_KIND       ON LEDGER(KIND)`,
  `CREATE TABLE IF NOT EXISTS IMPORT_PATTERN (
    ID          TEXT NOT NULL PRIMARY KEY,
    CREATED_AT  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PATTERN     TEXT NOT NULL,
    CATEGORY    TEXT NOT NULL,
    GROUP_ID    TEXT,
    PRIORITY    INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_IMPORT_PATTERN_PRIORITY ON IMPORT_PATTERN(PRIORITY DESC)`,
  `CREATE TABLE IF NOT EXISTS APP_SETTING (
    NAME       TEXT NOT NULL PRIMARY KEY,
    VALUE      TEXT NOT NULL,
    UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // BUDGET.CATEGORY uses the category key from types/expense.ts, except for
  // the pseudo-key "_total" which holds the overall monthly cap.
  `CREATE TABLE IF NOT EXISTS BUDGET (
    CATEGORY   TEXT NOT NULL PRIMARY KEY,
    AMOUNT     REAL NOT NULL,
    UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // Triggers replicate MySQL's ON UPDATE CURRENT_TIMESTAMP. Using AFTER UPDATE OF
  // a non-timestamp column avoids the recursive trigger that would fire when the
  // trigger itself updates UPDATED_AT.
  `CREATE TRIGGER IF NOT EXISTS TRG_LEDGER_UPDATED_AT
   AFTER UPDATE OF KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, NOTES, IS_RECURRING, TAGS, DELETED_AT
   ON LEDGER
   BEGIN
     UPDATE LEDGER SET UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = NEW.ID;
   END`,
  `CREATE TRIGGER IF NOT EXISTS TRG_CATEGORY_GROUP_UPDATED_AT
   AFTER UPDATE OF NAME, EMOJI, COLOR, SORT_ORDER, DELETED_AT
   ON CATEGORY_GROUP
   BEGIN
     UPDATE CATEGORY_GROUP SET UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = NEW.ID;
   END`,
  `CREATE TRIGGER IF NOT EXISTS TRG_APP_SETTING_UPDATED_AT
   AFTER UPDATE OF VALUE
   ON APP_SETTING
   BEGIN
     UPDATE APP_SETTING SET UPDATED_AT = CURRENT_TIMESTAMP WHERE NAME = NEW.NAME;
   END`,
  `CREATE TRIGGER IF NOT EXISTS TRG_BUDGET_UPDATED_AT
   AFTER UPDATE OF AMOUNT
   ON BUDGET
   BEGIN
     UPDATE BUDGET SET UPDATED_AT = CURRENT_TIMESTAMP WHERE CATEGORY = NEW.CATEGORY;
   END`,
];

export function initSchema(sqlite: DatabaseSync): void {
  migrate(sqlite);
  for (const stmt of STATEMENTS) {
    sqlite.exec(stmt);
  }
}
