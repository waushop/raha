import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { initSchema } from "./schema";

let sqlite: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (sqlite) return sqlite;
  const dbPath = process.env.DB_PATH ?? "./raha.sqlite";
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const conn = new DatabaseSync(dbPath);
  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA foreign_keys = ON");
  conn.exec("PRAGMA synchronous = NORMAL");
  initSchema(conn);
  sqlite = conn;
  return conn;
}

type Row = Record<string, unknown>;
type RunResult = { affectedRows: number; insertId: number | bigint };
type ExecuteResult = [Row[] | RunResult, undefined];

const isSelect = (sql: string): boolean => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql);

// node:sqlite returns rows with a null prototype, which React Server
// Components refuse to serialize to Client Components ("Only plain
// objects … can be passed"). Re-wrap each row so it has Object.prototype.
const plain = (rows: Row[]): Row[] => rows.map((r) => ({ ...r }));

/** Synchronous statement API handed to `db.transaction` callbacks. */
export type Tx = {
  all<T = Row>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): RunResult;
};

function makeTx(conn: DatabaseSync): Tx {
  return {
    all<T = Row>(sql: string, params: unknown[] = []): T[] {
      return plain(conn.prepare(sql).all(...(params as never[])) as Row[]) as T[];
    },
    run(sql: string, params: unknown[] = []): RunResult {
      const info = conn.prepare(sql).run(...(params as never[]));
      return { affectedRows: Number(info.changes), insertId: info.lastInsertRowid };
    },
  };
}

const db = {
  execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
    const stmt = getDb().prepare(sql);
    const args = params as never[];
    if (isSelect(sql)) {
      return Promise.resolve([plain(stmt.all(...args) as Row[]), undefined]);
    }
    const info = stmt.run(...args);
    return Promise.resolve([
      { affectedRows: Number(info.changes), insertId: info.lastInsertRowid },
      undefined,
    ]);
  },

  /**
   * Runs `fn` inside BEGIN IMMEDIATE … COMMIT, rolling back on throw.
   *
   * The callback must be synchronous: `db.execute` only looks async (it
   * resolves an already-computed value), and awaiting inside a transaction
   * would let another request's statements interleave with ours on the
   * shared connection. Use the `tx` argument instead.
   */
  transaction<T>(fn: (tx: Tx) => T): T {
    const conn = getDb();
    conn.exec("BEGIN IMMEDIATE");
    let result: T;
    try {
      result = fn(makeTx(conn));
      if (result && typeof (result as { then?: unknown }).then === "function") {
        throw new Error("db.transaction callback must be synchronous (use tx.run / tx.all)");
      }
    } catch (err) {
      conn.exec("ROLLBACK");
      throw err;
    }
    conn.exec("COMMIT");
    return result;
  },
};

export default db;
