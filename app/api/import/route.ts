import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { isAuthenticated } from "@/lib/auth";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Simple CSV import: Month, [Group,] Category, Name, Amount (header required).
// This is the inverse of /api/export; the Group column is detected from the
// header and ignored on import. Runs in one transaction.
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const text = await request.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());

  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV must have a header and at least one row" }, { status: 400 });
  }

  const header = lines[0].toLowerCase();
  const hasGroup = header.includes("group") || header.includes("grupp");

  const result = db.transaction((tx) => {
    let imported = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCSVLine(lines[i]);
      if (fields.length < 4) { skipped++; continue; }

      const month = fields[0]?.trim();
      const category = fields[hasGroup ? 2 : 1]?.trim() || "other";
      const name = fields[hasGroup ? 3 : 2]?.trim();
      const amount = parseFloat(fields[hasGroup ? 4 : 3]?.trim().replace(",", "."));

      if (!month || !MONTH_RE.test(month) || !name || isNaN(amount)) { skipped++; continue; }

      tx.run(
        "INSERT INTO LEDGER (ID, CATEGORY, NAME, AMOUNT, MONTH) VALUES (?, ?, ?, ?, ?)",
        [randomUUID(), category, name, amount, month]
      );
      imported++;
    }
    return { imported, skipped };
  });

  if (result.imported > 0) revalidatePath("/");
  return NextResponse.json(result);
}

// RFC 4180-style field splitting: quoted fields may contain commas and
// doubled quotes ("") for a literal quote.
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
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
