import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import db from "@/lib/db";

export async function POST(request: NextRequest) {
  const text = await request.text();
  const lines = text.split("\n").filter(l => l.trim());

  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV must have a header and at least one row" }, { status: 400 });
  }

  // Parse header
  const header = lines[0].toLowerCase();
  const hasGroup = header.includes("group") || header.includes("grupp");

  let imported = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    try {
      // Simple CSV parsing (handles quoted fields)
      const fields = parseCSVLine(lines[i]);
      if (fields.length < 4) { skipped++; continue; }

      const month = fields[0]?.trim();
      const category = fields[hasGroup ? 2 : 1]?.trim() || "other";
      const name = fields[hasGroup ? 3 : 2]?.trim().replace(/^"|"$/g, "");
      const amount = parseFloat(fields[hasGroup ? 4 : 3]?.trim().replace(",", "."));

      if (!month || !name || isNaN(amount)) { skipped++; continue; }

      await db.execute(
        "INSERT INTO LEDGER (ID, CATEGORY, NAME, AMOUNT, MONTH) VALUES (?, ?, ?, ?, ?)",
        [randomUUID(), category, name, amount, month]
      );
      imported++;
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({ imported, skipped });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
