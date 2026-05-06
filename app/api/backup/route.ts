import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { randomUUID } from "crypto";

// GET: Export all data as JSON
export async function GET() {
  const [rows] = await db.execute(
    `SELECT ID, CATEGORY, NAME, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, NOTES, IS_RECURRING, TAGS, CREATED_AT
     FROM EXPENSE WHERE DELETED_AT IS NULL ORDER BY MONTH, CREATED_AT`
  );

  const data = {
    version: 2,
    exported_at: new Date().toISOString(),
    expenses: rows,
  };

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="tuhi-rahakott-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

// POST: Import data from JSON backup
export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.expenses || !Array.isArray(body.expenses)) {
    return NextResponse.json({ error: "Invalid backup format" }, { status: 400 });
  }

  let imported = 0;
  for (const expense of body.expenses) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO EXPENSE (ID, CATEGORY, NAME, AMOUNT, MONTH, NOTES, IS_RECURRING, TAGS)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ID) DO NOTHING`,
      [
        id,
        expense.CATEGORY ?? "muu",
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
