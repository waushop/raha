// Minimal RFC 4180 CSV writer. Every cell is quoted when it contains a comma,
// quote, or newline; embedded quotes are doubled.

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return lines.join("\n");
}

export type LedgerCsvRow = {
  MONTH: string;
  KIND: string;
  CATEGORY: string;
  NAME: string;
  AMOUNT: number;
  NOTES: string | null;
  IS_RECURRING: number;
  CREATED_AT: string;
  GROUP_NAME: string | null;
};

// Column order is load-bearing: /api/import reads Month, Group, Category,
// Name, Amount positionally, so new columns go at the end.
export const LEDGER_CSV_HEADER = ["Kuu", "Grupp", "Kategooria", "Nimetus", "Summa", "Märkmed", "Korduv", "Lisatud", "Liik"];

export function ledgerToCsv(rows: LedgerCsvRow[]): string {
  return toCsv(
    LEDGER_CSV_HEADER,
    rows.map((r) => [
      r.MONTH,
      r.GROUP_NAME ?? "",
      r.CATEGORY,
      r.NAME,
      r.AMOUNT,
      r.NOTES ?? "",
      r.IS_RECURRING ? "Jah" : "Ei",
      r.CREATED_AT,
      r.KIND === "income" ? "Tulu" : "Kulu",
    ]),
  );
}
