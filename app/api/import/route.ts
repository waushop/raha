import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { importRows, type ImportRow } from "@/lib/ledger";
import { CATEGORY_KEYS } from "@/types/expense";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20000;

// Simple CSV import — the inverse of /api/export. Columns are matched by
// header name (English, with the pre-2026 Estonian headers still accepted),
// so a file exported by this app round-trips including Kind, Notes and
// Recurring. Rows that already exist (name + amount + month) are skipped.
// Runs in one transaction.
const COLUMN_ALIASES: Record<string, string[]> = {
  month: ["month", "kuu"],
  group: ["group", "grupp"],
  category: ["category", "kategooria"],
  name: ["name", "nimetus"],
  amount: ["amount", "summa"],
  notes: ["notes", "märkmed"],
  recurring: ["recurring", "korduv"],
  kind: ["kind", "liik"],
  day: ["day", "päev"],
};

const YES = new Set(["yes", "jah", "1", "true"]);
const INCOME = new Set(["income", "tulu"]);

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "File is too large" }, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "File is too large" }, { status: 413 });

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV must have a header and at least one row" }, { status: 400 });
  }
  if (lines.length - 1 > MAX_ROWS) {
    return NextResponse.json({ error: `CSV has more than ${MAX_ROWS} rows` }, { status: 400 });
  }

  const header = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (key: string): number => header.findIndex((h) => COLUMN_ALIASES[key].includes(h));
  const idx = {
    month: col("month"), category: col("category"), name: col("name"), amount: col("amount"),
    notes: col("notes"), recurring: col("recurring"), kind: col("kind"), day: col("day"),
  };
  // Legacy positional fallback: Month, [Group,] Category, Name, Amount.
  if (idx.month < 0 || idx.name < 0 || idx.amount < 0) {
    const hasGroup = col("group") >= 0;
    idx.month = 0; idx.category = hasGroup ? 2 : 1; idx.name = hasGroup ? 3 : 2; idx.amount = hasGroup ? 4 : 3;
  }

  const rows: ImportRow[] = [];
  let skipped = 0;
  const cell = (fields: string[], i: number): string => (i >= 0 ? (fields[i] ?? "").trim() : "");

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const month = cell(fields, idx.month);
    const name = cell(fields, idx.name);
    const amount = parseFloat(cell(fields, idx.amount).replace(",", "."));
    const rawCategory = cell(fields, idx.category);
    if (!MONTH_RE.test(month) || !name || !Number.isFinite(amount) || amount <= 0) { skipped++; continue; }
    const dayRaw = Number(cell(fields, idx.day));
    rows.push({
      day: Number.isInteger(dayRaw) && dayRaw >= 1 && dayRaw <= 31 ? dayRaw : null,
      kind: INCOME.has(cell(fields, idx.kind).toLowerCase()) ? "income" : "expense",
      category: (CATEGORY_KEYS as string[]).includes(rawCategory) ? rawCategory : "other",
      groupId: null,
      name,
      amount: Math.round(amount * 100) / 100,
      month,
      notes: cell(fields, idx.notes) || null,
      isRecurring: YES.has(cell(fields, idx.recurring).toLowerCase()),
    });
  }

  const imported = importRows(rows);
  if (imported > 0) revalidatePath("/");
  return NextResponse.json({ imported, skipped: skipped + (rows.length - imported) });
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
