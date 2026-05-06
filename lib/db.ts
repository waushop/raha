import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { initSchema } from "./schema";

let sqlite: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (sqlite) return sqlite;
  const dbPath = process.env.DB_PATH ?? "./raha.sqlite";
  mkdirSync(dirname(dbPath), { recursive: true });
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

const db = {
  execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
    const stmt = getDb().prepare(sql);
    const args = params as never[];
    if (isSelect(sql)) {
      return Promise.resolve([stmt.all(...args) as Row[], undefined]);
    }
    const info = stmt.run(...args);
    return Promise.resolve([
      { affectedRows: Number(info.changes), insertId: info.lastInsertRowid },
      undefined,
    ]);
  },
};

export default db;
