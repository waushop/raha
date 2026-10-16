import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";
import { syncTags } from "@/lib/ledger";
import { CATEGORY_KEYS, GROUP_COLORS } from "@/types/expense";

// Backup format history:
//   v2  expenses only, no KIND
//   v3  + KIND per row
//   v4  + GROUP_ID per row, plus groups / budgets / import_patterns sections.
//       Rows keep their original IDs so restoring the same file twice is a
//       no-op, and restoring an older backup puts rows back to their backed-
//       up values (including un-deleting them). Rows that exist only in the
//       database are never touched.
//   v5  + DAY per row, plus budget_history section. LEDGER_TAG is derived
//       from TAGS on restore, so it is not backed up separately.
const BACKUP_VERSION = 5;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const isCategory = (v: unknown): v is string => typeof v === "string" && (CATEGORY_KEYS as string[]).includes(v);
const isColor = (v: unknown): v is string => typeof v === "string" && (GROUP_COLORS as readonly string[]).includes(v);

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [expenses] = await db.execute(
    `SELECT ID, KIND, CATEGORY, GROUP_ID, NAME, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, DAY, NOTES, IS_RECURRING, TAGS, CREATED_AT
     FROM LEDGER WHERE DELETED_AT IS NULL ORDER BY MONTH, CREATED_AT`
  );
  const [groups] = await db.execute(
    "SELECT ID, NAME, EMOJI, COLOR, SORT_ORDER FROM CATEGORY_GROUP WHERE DELETED_AT IS NULL ORDER BY SORT_ORDER, NAME"
  );
  const [budgets] = await db.execute("SELECT CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT FROM BUDGET ORDER BY CATEGORY");
  const [patterns] = await db.execute(
    "SELECT ID, PATTERN, CATEGORY, GROUP_ID, PRIORITY FROM IMPORT_PATTERN ORDER BY PRIORITY DESC, PATTERN"
  );
  const [budgetHistory] = await db.execute("SELECT MONTH, CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT FROM BUDGET_HISTORY ORDER BY MONTH, CATEGORY");

  const data = {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    groups,
    budgets,
    budget_history: budgetHistory,
    import_patterns: patterns,
    expenses, // legacy field name kept so older importers still find the rows
  };

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="empty-wallet-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

// POST: restore from a JSON backup (v2, v3 or v4). Atomic: a malformed file
// leaves the database untouched.
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "Backup file is too large" }, { status: 413 });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Backup file is too large" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Body is not valid JSON" }, { status: 400 });
  }
  if (!isObj(body) || !Array.isArray(body.expenses)) {
    return NextResponse.json({ error: "Invalid backup format" }, { status: 400 });
  }

  const groups = Array.isArray(body.groups) ? body.groups : [];
  const budgets = Array.isArray(body.budgets) ? body.budgets : [];
  const patterns = Array.isArray(body.import_patterns) ? body.import_patterns : [];
  const budgetHistory = Array.isArray(body.budget_history) ? body.budget_history : [];
  const expenses = body.expenses;

  const result = db.transaction((tx) => {
    const stats = { imported: 0, updated: 0, skipped: 0, groups: 0, budgets: 0, patterns: 0, budget_history: 0 };

    for (const g of groups) {
      if (!isObj(g)) continue;
      const id = str(g.ID);
      const name = str(g.NAME);
      if (!id || !UUID_RE.test(id) || !name) continue;
      tx.run(
        `INSERT INTO CATEGORY_GROUP (ID, NAME, EMOJI, COLOR, SORT_ORDER) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET NAME = excluded.NAME, EMOJI = excluded.EMOJI, COLOR = excluded.COLOR,
           SORT_ORDER = excluded.SORT_ORDER, DELETED_AT = NULL`,
        [id, name, str(g.EMOJI), isColor(g.COLOR) ? g.COLOR : "blue", num(g.SORT_ORDER) ?? 0],
      );
      stats.groups++;
    }

    const liveGroupIds = new Set(
      tx.all<{ ID: string }>("SELECT ID FROM CATEGORY_GROUP WHERE DELETED_AT IS NULL").map((r) => r.ID),
    );

    for (const b of budgets) {
      if (!isObj(b)) continue;
      const category = str(b.CATEGORY);
      const amount = num(b.AMOUNT);
      if (!category || (category !== "_total" && !isCategory(category)) || amount === null || amount <= 0) continue;
      tx.run(
        "INSERT INTO BUDGET (CATEGORY, AMOUNT) VALUES (?, ?) ON CONFLICT(CATEGORY) DO UPDATE SET AMOUNT = excluded.AMOUNT",
        [category, amount],
      );
      stats.budgets++;
    }

    for (const h of budgetHistory) {
      if (!isObj(h)) continue;
      const month = str(h.MONTH);
      const category = str(h.CATEGORY);
      const amount = num(h.AMOUNT);
      if (!month || !MONTH_RE.test(month) || !category || (category !== "_total" && !isCategory(category)) || amount === null || amount <= 0) continue;
      tx.run(
        "INSERT INTO BUDGET_HISTORY (MONTH, CATEGORY, AMOUNT) VALUES (?, ?, ?) ON CONFLICT(MONTH, CATEGORY) DO UPDATE SET AMOUNT = excluded.AMOUNT",
        [month, category, amount],
      );
      stats.budget_history++;
    }

    for (const p of patterns) {
      if (!isObj(p)) continue;
      const id = str(p.ID);
      const pattern = str(p.PATTERN);
      const category = str(p.CATEGORY);
      if (!id || !UUID_RE.test(id) || !pattern || !isCategory(category)) continue;
      const groupId = str(p.GROUP_ID);
      tx.run(
        `INSERT INTO IMPORT_PATTERN (ID, PATTERN, CATEGORY, GROUP_ID, PRIORITY) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET PATTERN = excluded.PATTERN, CATEGORY = excluded.CATEGORY,
           GROUP_ID = excluded.GROUP_ID, PRIORITY = excluded.PRIORITY`,
        [id, pattern, category, groupId && liveGroupIds.has(groupId) ? groupId : null, num(p.PRIORITY) ?? 0],
      );
      stats.patterns++;
    }

    for (const e of expenses) {
      if (!isObj(e)) { stats.skipped++; continue; }
      const name = str(e.NAME);
      const amount = num(e.AMOUNT);
      const month = str(e.MONTH);
      if (!name || amount === null || amount <= 0 || !month || !MONTH_RE.test(month)) { stats.skipped++; continue; }

      const givenId = str(e.ID);
      const id = givenId && UUID_RE.test(givenId) ? givenId : randomUUID();
      const groupId = str(e.GROUP_ID);
      const exists = tx.all("SELECT 1 FROM LEDGER WHERE ID = ?", [id]).length > 0;
      const rawDay = num(e.DAY);
      const day = rawDay !== null && Number.isInteger(rawDay) && rawDay >= 1 && rawDay <= 31 ? rawDay : null;
      const tags = str(e.TAGS);

      tx.run(
        `INSERT INTO LEDGER (ID, KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, DAY, NOTES, IS_RECURRING, TAGS)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ID) DO UPDATE SET KIND = excluded.KIND, CATEGORY = excluded.CATEGORY, GROUP_ID = excluded.GROUP_ID,
           NAME = excluded.NAME, AMOUNT = excluded.AMOUNT, MONTH = excluded.MONTH, DAY = excluded.DAY, NOTES = excluded.NOTES,
           IS_RECURRING = excluded.IS_RECURRING, TAGS = excluded.TAGS, DELETED_AT = NULL`,
        [
          id,
          e.KIND === "income" ? "income" : "expense",
          isCategory(e.CATEGORY) ? e.CATEGORY : "other",
          groupId && liveGroupIds.has(groupId) ? groupId : null,
          name,
          amount,
          month,
          day,
          str(e.NOTES),
          num(e.IS_RECURRING) ? 1 : 0,
          tags,
        ],
      );
      syncTags(tx, id, tags);
      if (exists) stats.updated++;
      else stats.imported++;
    }
    return stats;
  });

  revalidatePath("/");
  return NextResponse.json(result);
}
