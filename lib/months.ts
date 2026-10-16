// Shared month (YYYY-MM) helpers. Pages, the sidebar and server actions all
// used to carry their own copies with subtly different defaults ("current"
// vs "previous" month). Everything now agrees: the default month is today's.

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(): string {
  return monthKey(new Date());
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function isValidMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && MONTH_RE.test(value);
}

export function monthLabel(month: string, style: "long" | "short" = "long"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: style, year: "numeric" });
}
