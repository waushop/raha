import type { DatabaseSync } from "node:sqlite";
import { parseTags } from "./tags";

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

  // Add LEDGER.KIND / LEDGER.DAY if it's a pre-existing table without the
  // columns. New installs get them from CREATE TABLE below.
  if (tables.has("LEDGER")) {
    const cols = (sqlite.prepare("PRAGMA table_info(LEDGER)").all() as Array<{
      name: string;
    }>).map((r) => r.name);
    if (!cols.includes("KIND")) {
      sqlite.exec("ALTER TABLE LEDGER ADD COLUMN KIND TEXT NOT NULL DEFAULT 'expense'");
    }
    if (!cols.includes("DAY")) {
      sqlite.exec("ALTER TABLE LEDGER ADD COLUMN DAY INTEGER");
      // The UPDATED_AT trigger lists its columns; drop it so the CREATE below
      // rebuilds it with DAY included.
      sqlite.exec("DROP TRIGGER IF EXISTS TRG_LEDGER_UPDATED_AT");
    }
    if (!cols.includes("GOAL_ID")) {
      sqlite.exec("ALTER TABLE LEDGER ADD COLUMN GOAL_ID TEXT");
      sqlite.exec("DROP TRIGGER IF EXISTS TRG_LEDGER_UPDATED_AT");
    }
  }
}

// One row per tag so search/analytics can filter without LIKE. Populated
// from the free-text TAGS column the first time the table is empty.
function backfillTags(sqlite: DatabaseSync): void {
  const { n } = sqlite.prepare("SELECT COUNT(*) AS n FROM LEDGER_TAG").get() as { n: number };
  if (n > 0) return;
  const rows = sqlite.prepare("SELECT ID, TAGS FROM LEDGER WHERE TAGS IS NOT NULL AND TAGS != ''").all() as Array<{ ID: string; TAGS: string }>;
  if (rows.length === 0) return;
  const insert = sqlite.prepare("INSERT OR IGNORE INTO LEDGER_TAG (LEDGER_ID, TAG) VALUES (?, ?)");
  sqlite.exec("BEGIN");
  try {
    for (const r of rows) for (const tag of parseTags(r.TAGS)) insert.run(r.ID, tag);
    sqlite.exec("COMMIT");
  } catch (e) {
    sqlite.exec("ROLLBACK");
    throw e;
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
    TAGS         TEXT,
    DAY          INTEGER,
    GOAL_ID      TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_GOAL ON LEDGER(GOAL_ID)`,
  // Savings goals; contributions are LEDGER rows with GOAL_ID set.
  `CREATE TABLE IF NOT EXISTS SAVINGS_GOAL (
    ID              TEXT NOT NULL PRIMARY KEY,
    CREATED_AT      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    DELETED_AT      TEXT,
    NAME            TEXT NOT NULL,
    EMOJI           TEXT,
    TARGET_AMOUNT   REAL NOT NULL,
    TARGET_MONTH    TEXT,
    STARTING_AMOUNT REAL NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_MONTH      ON LEDGER(MONTH)`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_DELETED_AT ON LEDGER(DELETED_AT)`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_GROUP      ON LEDGER(GROUP_ID)`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_KIND       ON LEDGER(KIND)`,
  // Composite indexes for the two query shapes every page uses: spending
  // aggregates (KIND + live + month range) and "recent" lists.
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_KIND_LIVE_MONTH ON LEDGER(KIND, DELETED_AT, MONTH)`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_LIVE_CREATED    ON LEDGER(DELETED_AT, CREATED_AT)`,
  `CREATE TABLE IF NOT EXISTS LEDGER_TAG (
    LEDGER_ID TEXT NOT NULL,
    TAG       TEXT NOT NULL,
    PRIMARY KEY (LEDGER_ID, TAG)
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_TAG_TAG ON LEDGER_TAG(TAG)`,
  // Every ledger write, with the row as it looked before and after, so
  // /activity can show real history (and restores can be exact).
  `CREATE TABLE IF NOT EXISTS LEDGER_AUDIT (
    ID          TEXT NOT NULL PRIMARY KEY,
    LEDGER_ID   TEXT NOT NULL,
    ACTION      TEXT NOT NULL,
    BEFORE_JSON TEXT,
    AFTER_JSON  TEXT,
    AT          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_AUDIT_AT     ON LEDGER_AUDIT(AT)`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_AUDIT_LEDGER ON LEDGER_AUDIT(LEDGER_ID)`,
  // Budgets as they stood for a given month. Written whenever a budget is
  // edited and lazily when a month is first viewed, so "budget vs actual"
  // can be charted after the budget itself has moved on.
  `CREATE TABLE IF NOT EXISTS BUDGET_HISTORY (
    MONTH      TEXT NOT NULL,
    CATEGORY   TEXT NOT NULL,
    AMOUNT     REAL NOT NULL,
    CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (MONTH, CATEGORY)
  )`,
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
   AFTER UPDATE OF KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, DAY, NOTES, IS_RECURRING, TAGS, GOAL_ID, DELETED_AT
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
  `CREATE TRIGGER IF NOT EXISTS TRG_SAVINGS_GOAL_UPDATED_AT
   AFTER UPDATE OF NAME, EMOJI, TARGET_AMOUNT, TARGET_MONTH, STARTING_AMOUNT, DELETED_AT
   ON SAVINGS_GOAL
   BEGIN
     UPDATE SAVINGS_GOAL SET UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = NEW.ID;
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
  backfillTags(sqlite);
}
