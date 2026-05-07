import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { randomUUID } from "crypto";

// GET: Export all live ledger rows (both expenses and income) as JSON.
export async function GET() {
  const [rows] = await db.execute(
    `SELECT ID, KIND, CATEGORY, NAME, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, NOTES, IS_RECURRING, TAGS, CREATED_AT
     FROM LEDGER WHERE DELETED_AT IS NULL ORDER BY MONTH, CREATED_AT`
  );

  const data = {
    version: 3, // bumped from 2: adds KIND ('expense' | 'income') per row
    exported_at: new Date().toISOString(),
    expenses: rows, // legacy field name kept for backwards-compat with v2 importers
  };

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="tuhi-rahakott-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

// POST: Import data from JSON backup. Accepts both v2 (no KIND) and v3 (with KIND).
export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.expenses || !Array.isArray(body.expenses)) {
    return NextResponse.json({ error: "Invalid backup format" }, { status: 400 });
  }

  let imported = 0;
  for (const expense of body.expenses) {
    const id = randomUUID();
    const kind = expense.KIND === "income" ? "income" : "expense";
    await db.execute(
      `INSERT INTO LEDGER (ID, KIND, CATEGORY, NAME, AMOUNT, MONTH, NOTES, IS_RECURRING, TAGS)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ID) DO NOTHING`,
      [
        id,
        kind,
        expense.CATEGORY ?? "other",
        expense.NAME,
        expense.AMOUNT,
        expense.MONTH,
        expense.NOTES ?? null,
        expense.IS_RECURRING ?? 0,
        expense.TAGS ?? null,
      ]
    );
    imported++;
  }

  return NextResponse.json({ imported });
}
