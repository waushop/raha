// Display helpers for bank sync, safe to import from client components.

/** "EE38 2200 2210 2014 5685" → "EE38 •••• 5685". */
export function maskIban(iban: string | null): string {
  if (!iban) return "";
  const s = iban.replace(/\s+/g, "");
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)} •••• ${s.slice(-4)}`;
}

/** Whole days from `today` (YYYY-MM-DD) until an ISO timestamp; negative once passed. */
export function daysLeft(validUntil: string | null, now = new Date()): number | null {
  if (!validUntil) return null;
  const t = Date.parse(validUntil);
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - now.getTime()) / 86_400_000);
}
