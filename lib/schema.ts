import type { DatabaseSync } from "node:sqlite";
import { iconFromLegacy } from "./icon-names";
import { backfillSubscriptions } from "./subscriptions";
import { currentMonth } from "./months";
import { randomUUID } from "node:crypto";
import { parseTags } from "./tags";

// Every data row belongs to a WORKSPACE. Today each USER owns exactly one
// personal workspace; a shared household workspace later is just another
// WORKSPACE row with two WORKSPACE_MEMBER rows.
const TENANT_TABLES = ["LEDGER", "CATEGORY_GROUP", "IMPORT_PATTERN", "SAVINGS_GOAL"] as const;

const USER_TABLES = [
  `CREATE TABLE IF NOT EXISTS USER (
    ID              TEXT NOT NULL PRIMARY KEY,
    CREATED_AT      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    DELETED_AT      TEXT,
    NAME            TEXT NOT NULL,
    PIN_HASH        TEXT NOT NULL,
    IS_ADMIN        INTEGER NOT NULL DEFAULT 0,
    SESSION_VERSION INTEGER NOT NULL DEFAULT 1,
    SORT_ORDER      INTEGER NOT NULL DEFAULT 0,
    EMAIL           TEXT,
    EMAIL_VERIFIED_AT TEXT,
    REQUIRE_2FA     INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS WORKSPACE (
    ID         TEXT NOT NULL PRIMARY KEY,
    CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    NAME       TEXT NOT NULL,
    KIND       TEXT NOT NULL DEFAULT 'personal'
  )`,
  `CREATE TABLE IF NOT EXISTS WORKSPACE_MEMBER (
    WORKSPACE_ID TEXT NOT NULL,
    USER_ID      TEXT NOT NULL,
    ROLE         TEXT NOT NULL DEFAULT 'owner',
    PRIMARY KEY (WORKSPACE_ID, USER_ID)
  )`,
];

function tableNames(sqlite: DatabaseSync): Set<string> {
  return new Set(
    (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((r) => r.name),
  );
}

function hasColumn(sqlite: DatabaseSync, table: string, column: string): boolean {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);
}

/**
 * One-shot move from the single-user world: the first workspace is created,
 * the old APP_SETTING pin (or AUTH_PIN_HASH) becomes the "Owner" user, and
 * every existing row is assigned to that workspace.
 */
function migrateWorkspaces(sqlite: DatabaseSync, tables: Set<string>): void {
  for (const stmt of USER_TABLES) sqlite.exec(stmt);

  // Email second factor columns on an older USER table.
  if (!hasColumn(sqlite, "USER", "EMAIL")) {
    sqlite.exec("ALTER TABLE USER ADD COLUMN EMAIL TEXT");
    sqlite.exec("ALTER TABLE USER ADD COLUMN EMAIL_VERIFIED_AT TEXT");
    sqlite.exec("ALTER TABLE USER ADD COLUMN REQUIRE_2FA INTEGER NOT NULL DEFAULT 0");
    sqlite.exec("DROP TRIGGER IF EXISTS TRG_USER_UPDATED_AT");
  }

  const needsAssign = (t: string) => tables.has(t) && !hasColumn(sqlite, t, "WORKSPACE_ID");
  const legacy = [...TENANT_TABLES, "BUDGET", "BUDGET_HISTORY"].some(needsAssign);
  if (!legacy) return;

  let workspaceId = (sqlite.prepare("SELECT ID FROM WORKSPACE ORDER BY CREATED_AT LIMIT 1").get() as { ID: string } | undefined)?.ID;
  if (!workspaceId) {
    workspaceId = randomUUID();
    sqlite.prepare("INSERT INTO WORKSPACE (ID, NAME, KIND) VALUES (?, 'Personal', 'personal')").run(workspaceId);
    const pin = tables.has("APP_SETTING")
      ? (sqlite.prepare("SELECT VALUE FROM APP_SETTING WHERE NAME = 'pin_hash'").get() as { VALUE: string } | undefined)?.VALUE
      : undefined;
    const hash = pin ?? process.env.AUTH_PIN_HASH;
    if (hash) {
      const userId = randomUUID();
      sqlite.prepare("INSERT INTO USER (ID, NAME, PIN_HASH, IS_ADMIN) VALUES (?, 'Owner', ?, 1)").run(userId, hash);
      sqlite.prepare("INSERT INTO WORKSPACE_MEMBER (WORKSPACE_ID, USER_ID, ROLE) VALUES (?, ?, 'owner')").run(workspaceId, userId);
    }
  }

  for (const t of TENANT_TABLES) {
    if (!needsAssign(t)) continue;
    sqlite.exec(`ALTER TABLE ${t} ADD COLUMN WORKSPACE_ID TEXT`);
    sqlite.prepare(`UPDATE ${t} SET WORKSPACE_ID = ? WHERE WORKSPACE_ID IS NULL`).run(workspaceId);
    if (t === "LEDGER") sqlite.exec("DROP TRIGGER IF EXISTS TRG_LEDGER_UPDATED_AT");
    if (t === "CATEGORY_GROUP") sqlite.exec("DROP TRIGGER IF EXISTS TRG_CATEGORY_GROUP_UPDATED_AT");
    if (t === "SAVINGS_GOAL") sqlite.exec("DROP TRIGGER IF EXISTS TRG_SAVINGS_GOAL_UPDATED_AT");
  }
  // BUDGET / BUDGET_HISTORY keys gain the workspace, which means rebuilding.
  if (needsAssign("BUDGET")) {
    sqlite.exec("DROP TRIGGER IF EXISTS TRG_BUDGET_UPDATED_AT");
    sqlite.exec(`CREATE TABLE BUDGET_NEW (
      WORKSPACE_ID TEXT NOT NULL, CATEGORY TEXT NOT NULL, AMOUNT REAL NOT NULL,
      UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (WORKSPACE_ID, CATEGORY))`);
    sqlite.prepare("INSERT INTO BUDGET_NEW (WORKSPACE_ID, CATEGORY, AMOUNT, UPDATED_AT) SELECT ?, CATEGORY, AMOUNT, UPDATED_AT FROM BUDGET").run(workspaceId);
    sqlite.exec("DROP TABLE BUDGET");
    sqlite.exec("ALTER TABLE BUDGET_NEW RENAME TO BUDGET");
  }
  if (needsAssign("BUDGET_HISTORY")) {
    sqlite.exec(`CREATE TABLE BUDGET_HISTORY_NEW (
      WORKSPACE_ID TEXT NOT NULL, MONTH TEXT NOT NULL, CATEGORY TEXT NOT NULL, AMOUNT REAL NOT NULL,
      CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (WORKSPACE_ID, MONTH, CATEGORY))`);
    sqlite.prepare("INSERT INTO BUDGET_HISTORY_NEW (WORKSPACE_ID, MONTH, CATEGORY, AMOUNT, CREATED_AT) SELECT ?, MONTH, CATEGORY, AMOUNT, CREATED_AT FROM BUDGET_HISTORY").run(workspaceId);
    sqlite.exec("DROP TABLE BUDGET_HISTORY");
    sqlite.exec("ALTER TABLE BUDGET_HISTORY_NEW RENAME TO BUDGET_HISTORY");
  }
}

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

  migrateWorkspaces(sqlite, tables);

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
    if (!cols.includes("SUBSCRIPTION_ID")) {
      sqlite.exec("ALTER TABLE LEDGER ADD COLUMN SUBSCRIPTION_ID TEXT");
      sqlite.exec("DROP TRIGGER IF EXISTS TRG_LEDGER_UPDATED_AT");
    }
  }
}

// One row per tag so search/analytics can filter without LIKE. Populated
// from the free-text TAGS column the first time the table is empty.
// EMOJI → ICON. Groups and goals used to store a free-text emoji; they now
// store a Lucide icon name from lib/icon-names.ts. Known emoji are mapped,
// anything else becomes NULL (the default icon). Triggers are dropped first
// so the STATEMENTS below recreate them against the new column name.
function migrateIcons(sqlite: DatabaseSync, tables: Set<string>): void {
  for (const [table, trigger] of [
    ["CATEGORY_GROUP", "TRG_CATEGORY_GROUP_UPDATED_AT"],
    ["SAVINGS_GOAL", "TRG_SAVINGS_GOAL_UPDATED_AT"],
  ] as const) {
    if (!tables.has(table) || !hasColumn(sqlite, table, "EMOJI")) continue;
    sqlite.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    sqlite.exec(`ALTER TABLE ${table} RENAME COLUMN EMOJI TO ICON`);
    const rows = sqlite.prepare(`SELECT DISTINCT ICON FROM ${table} WHERE ICON IS NOT NULL`).all() as Array<{ ICON: string }>;
    const update = sqlite.prepare(`UPDATE ${table} SET ICON = ? WHERE ICON = ?`);
    for (const { ICON } of rows) {
      const mapped = iconFromLegacy(ICON);
      if (mapped !== ICON) update.run(mapped, ICON);
    }
  }
}

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
  ...USER_TABLES,
  `CREATE TABLE IF NOT EXISTS CATEGORY_GROUP (
    ID          TEXT NOT NULL PRIMARY KEY,
    CREATED_AT  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    DELETED_AT  TEXT,
    WORKSPACE_ID TEXT,
    NAME        TEXT NOT NULL,
    ICON        TEXT,
    COLOR       TEXT NOT NULL DEFAULT 'blue',
    SORT_ORDER  INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS LEDGER (
    ID           TEXT NOT NULL PRIMARY KEY,
    CREATED_AT   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    DELETED_AT   TEXT,
    WORKSPACE_ID TEXT,
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
    GOAL_ID      TEXT,
    SUBSCRIPTION_ID TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_GOAL ON LEDGER(GOAL_ID)`,
  // Savings goals; contributions are LEDGER rows with GOAL_ID set.
  `CREATE TABLE IF NOT EXISTS SAVINGS_GOAL (
    ID              TEXT NOT NULL PRIMARY KEY,
    CREATED_AT      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    DELETED_AT      TEXT,
    WORKSPACE_ID    TEXT,
    NAME            TEXT NOT NULL,
    ICON            TEXT,
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
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_WS ON LEDGER(WORKSPACE_ID, KIND, DELETED_AT, MONTH)`,
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
  // Email sign-in codes (hashed) and remembered devices (hashed tokens).
  `CREATE TABLE IF NOT EXISTS LOGIN_CHALLENGE (
    ID          TEXT NOT NULL PRIMARY KEY,
    USER_ID     TEXT NOT NULL,
    CODE_HASH   TEXT NOT NULL,
    ATTEMPTS    INTEGER NOT NULL DEFAULT 0,
    CREATED_AT  TEXT NOT NULL,
    EXPIRES_AT  TEXT NOT NULL,
    CONSUMED_AT TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_LOGIN_CHALLENGE_USER ON LOGIN_CHALLENGE(USER_ID, CREATED_AT)`,
  `CREATE TABLE IF NOT EXISTS TRUSTED_DEVICE (
    ID           TEXT NOT NULL PRIMARY KEY,
    USER_ID      TEXT NOT NULL,
    TOKEN_HASH   TEXT NOT NULL,
    NAME         TEXT NOT NULL,
    CREATED_AT   TEXT NOT NULL,
    LAST_SEEN_AT TEXT NOT NULL,
    EXPIRES_AT   TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_TRUSTED_DEVICE_USER ON TRUSTED_DEVICE(USER_ID, TOKEN_HASH)`,
  // Budgets as they stood for a given month. Written whenever a budget is
  // edited and lazily when a month is first viewed, so "budget vs actual"
  // can be charted after the budget itself has moved on.
  `CREATE TABLE IF NOT EXISTS BUDGET_HISTORY (
    WORKSPACE_ID TEXT NOT NULL,
    MONTH      TEXT NOT NULL,
    CATEGORY   TEXT NOT NULL,
    AMOUNT     REAL NOT NULL,
    CREATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (WORKSPACE_ID, MONTH, CATEGORY)
  )`,
  `CREATE TABLE IF NOT EXISTS IMPORT_PATTERN (
    ID          TEXT NOT NULL PRIMARY KEY,
    CREATED_AT  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    WORKSPACE_ID TEXT,
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
    WORKSPACE_ID TEXT NOT NULL,
    CATEGORY   TEXT NOT NULL,
    AMOUNT     REAL NOT NULL,
    UPDATED_AT TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (WORKSPACE_ID, CATEGORY)
  )`,
  // Triggers replicate MySQL's ON UPDATE CURRENT_TIMESTAMP. Using AFTER UPDATE OF
  // a non-timestamp column avoids the recursive trigger that would fire when the
  // trigger itself updates UPDATED_AT.
  `CREATE TRIGGER IF NOT EXISTS TRG_LEDGER_UPDATED_AT
   AFTER UPDATE OF KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, DAY, NOTES, IS_RECURRING, TAGS, GOAL_ID, DELETED_AT, SUBSCRIPTION_ID
   ON LEDGER
   BEGIN
     UPDATE LEDGER SET UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = NEW.ID;
   END`,
  `CREATE TRIGGER IF NOT EXISTS TRG_CATEGORY_GROUP_UPDATED_AT
   AFTER UPDATE OF NAME, ICON, COLOR, SORT_ORDER, DELETED_AT
   ON CATEGORY_GROUP
   BEGIN
     UPDATE CATEGORY_GROUP SET UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = NEW.ID;
   END`,
  `CREATE TRIGGER IF NOT EXISTS TRG_SAVINGS_GOAL_UPDATED_AT
   AFTER UPDATE OF NAME, ICON, TARGET_AMOUNT, TARGET_MONTH, STARTING_AMOUNT, DELETED_AT
   ON SAVINGS_GOAL
   BEGIN
     UPDATE SAVINGS_GOAL SET UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = NEW.ID;
   END`,
  `CREATE TRIGGER IF NOT EXISTS TRG_USER_UPDATED_AT
   AFTER UPDATE OF NAME, PIN_HASH, IS_ADMIN, SESSION_VERSION, SORT_ORDER, EMAIL, EMAIL_VERIFIED_AT, REQUIRE_2FA, DELETED_AT
   ON USER
   BEGIN
     UPDATE USER SET UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = NEW.ID;
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
     UPDATE BUDGET SET UPDATED_AT = CURRENT_TIMESTAMP WHERE WORKSPACE_ID = NEW.WORKSPACE_ID AND CATEGORY = NEW.CATEGORY;
   END`,
  // Workspace indexes last: every table they reference exists by now.
  `CREATE INDEX IF NOT EXISTS IDX_CATEGORY_GROUP_WS ON CATEGORY_GROUP(WORKSPACE_ID)`,
  `CREATE INDEX IF NOT EXISTS IDX_IMPORT_PATTERN_WS ON IMPORT_PATTERN(WORKSPACE_ID)`,
  `CREATE TABLE IF NOT EXISTS SUBSCRIPTION (
    ID                TEXT NOT NULL PRIMARY KEY,
    CREATED_AT        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    DELETED_AT        TEXT,
    WORKSPACE_ID      TEXT NOT NULL,
    NAME              TEXT NOT NULL,
    CATEGORY          TEXT NOT NULL DEFAULT 'subscriptions',
    GROUP_ID          TEXT,
    AMOUNT            REAL NOT NULL,
    CADENCE           TEXT NOT NULL DEFAULT 'monthly',
    DAY               INTEGER,
    MONTH_OF_YEAR     INTEGER,
    STATUS            TEXT NOT NULL DEFAULT 'active',
    STATUS_CHANGED_AT TEXT,
    NOTES             TEXT,
    CANCEL_URL        TEXT,
    TRIAL_ENDS        TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS IDX_SUBSCRIPTION_WS ON SUBSCRIPTION(WORKSPACE_ID, STATUS)`,
  `CREATE INDEX IF NOT EXISTS IDX_LEDGER_SUBSCRIPTION ON LEDGER(SUBSCRIPTION_ID)`,
  `CREATE TRIGGER IF NOT EXISTS TRG_SUBSCRIPTION_UPDATED_AT
   AFTER UPDATE OF NAME, CATEGORY, GROUP_ID, AMOUNT, CADENCE, DAY, MONTH_OF_YEAR, STATUS, NOTES, CANCEL_URL, TRIAL_ENDS, DELETED_AT
   ON SUBSCRIPTION
   BEGIN
     UPDATE SUBSCRIPTION SET UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = NEW.ID;
   END`,
  `CREATE INDEX IF NOT EXISTS IDX_SAVINGS_GOAL_WS ON SAVINGS_GOAL(WORKSPACE_ID)`,
];

export function initSchema(sqlite: DatabaseSync): void {
  migrate(sqlite);
  migrateIcons(sqlite, tableNames(sqlite));
  for (const stmt of STATEMENTS) {
    sqlite.exec(stmt);
  }
  backfillTags(sqlite);
  // Recurring rows that predate SUBSCRIPTION (or were flagged by a path
  // that doesn't link) get their subscription here.
  backfillSubscriptions(
    {
      all: <T,>(sql: string, params: unknown[] = []) => sqlite.prepare(sql).all(...(params as never[])) as T[],
      run: (sql: string, params: unknown[] = []) => sqlite.prepare(sql).run(...(params as never[])),
    },
    currentMonth(),
    randomUUID,
  );
}
