// Input validation for Server Actions and API routes. Every parser returns
// the cleaned value or throws ValidationError with a message fit for a toast.
// Deliberately dependency-free: the app has no runtime deps and this is small.
import { CATEGORY_KEYS, GROUP_COLORS, type CategoryKey } from "@/types/expense";
import { iconFromLegacy, type IconName } from "./icon-names";
import { MONTH_RE, daysInMonth } from "./months";
import { CADENCES, STATUSES, type Cadence, type SubscriptionStatus } from "./subscriptions";
import { MAX_TAGS, MAX_TAG_LENGTH, formatTags, parseTags } from "./tags";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR_RE = /^\d{4}$/;

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

export function parseAmount(v: unknown, label = "Amount"): number {
  const n = typeof v === "number" ? v : Number(text(v).replace(",", "."));
  if (!Number.isFinite(n)) throw new ValidationError(`${label} must be a number`);
  if (n <= 0) throw new ValidationError(`${label} must be greater than zero`);
  if (n > 1_000_000_000) throw new ValidationError(`${label} is too large`);
  return Math.round(n * 100) / 100;
}

export function parseMonth(v: unknown): string {
  const s = text(v);
  if (!MONTH_RE.test(s)) throw new ValidationError("Month must look like 2026-03");
  return s;
}

/** Optional YYYY-MM-DD. Returns the month and day it denotes, or null when blank. */
export function parseOptionalDate(v: unknown): { month: string; day: number } | null {
  const s = text(v);
  if (!s) return null;
  const m = /^(\d{4}-(?:0[1-9]|1[0-2]))-(\d{2})$/.exec(s);
  if (!m) throw new ValidationError("Date must look like 2026-03-14");
  const month = m[1];
  const day = Number(m[2]);
  if (day < 1 || day > daysInMonth(month)) throw new ValidationError("That day does not exist in this month");
  return { month, day };
}

/** Optional day-of-month number, validated against `month`. */
export function parseOptionalDay(v: unknown, month: string): number | null {
  const s = text(v);
  if (!s) return null;
  const day = Number(s);
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(month)) throw new ValidationError("That day does not exist in this month");
  return day;
}

/** Normalises free-text tags to "#a, #b" (or null) and bounds count/length. */
export function parseTagsText(v: unknown): string | null {
  const tags = parseTags(text(v));
  if (tags.length > MAX_TAGS) throw new ValidationError(`At most ${MAX_TAGS} tags`);
  const long = tags.find((t) => t.length > MAX_TAG_LENGTH);
  if (long) throw new ValidationError(`Tag "#${long}" is too long (max ${MAX_TAG_LENGTH} characters)`);
  return formatTags(tags);
}

export function parseYear(v: unknown): string {
  const s = text(v);
  if (!YEAR_RE.test(s)) throw new ValidationError("Year must be four digits");
  return s;
}

export function parseCategory(v: unknown): CategoryKey {
  const s = text(v);
  if (!(CATEGORY_KEYS as string[]).includes(s)) throw new ValidationError("Unknown category");
  return s as CategoryKey;
}

export function parseCadence(v: unknown): Cadence {
  const s = text(v) || "monthly";
  if (!(CADENCES as readonly string[]).includes(s)) throw new ValidationError("Unknown cadence");
  return s as Cadence;
}

export function parseSubscriptionStatus(v: unknown): SubscriptionStatus {
  const s = text(v);
  if (!(STATUSES as readonly string[]).includes(s)) throw new ValidationError("Unknown status");
  return s as SubscriptionStatus;
}

/** Optional 1–31 charge day (not tied to a month; clamped when a month is shorter). */
export function parseOptionalDayOfMonth(v: unknown): number | null {
  const s = text(v);
  if (!s) return null;
  const day = Number(s);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new ValidationError("Day must be between 1 and 31");
  return day;
}

/** Optional 1–12 month number. */
export function parseOptionalMonthOfYear(v: unknown): number | null {
  const s = text(v);
  if (!s) return null;
  const m = Number(s);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new ValidationError("Month must be between 1 and 12");
  return m;
}

/** Optional YYYY-MM-DD kept as a string. */
export function parseOptionalIsoDate(v: unknown): string | null {
  const d = parseOptionalDate(v);
  return d ? `${d.month}-${String(d.day).padStart(2, "0")}` : null;
}

/** Optional http(s) link. */
export function parseOptionalUrl(v: unknown, label = "Link"): string | null {
  const s = text(v);
  if (!s) return null;
  if (s.length > 500 || !/^https?:\/\/\S+$/i.test(s)) throw new ValidationError(`${label} must start with http:// or https://`);
  return s;
}

export function parseIcon(v: unknown): IconName | null {
  const s = text(v);
  if (!s) return null;
  const name = iconFromLegacy(s);
  if (!name) throw new ValidationError("Unknown icon");
  return name;
}

export function parseColor(v: unknown): string {
  const s = text(v) || "blue";
  if (!(GROUP_COLORS as readonly string[]).includes(s)) throw new ValidationError("Unknown colour");
  return s;
}

export function parseName(v: unknown, label = "Name", max = 120): string {
  const s = text(v);
  if (!s) throw new ValidationError(`${label} is required`);
  if (s.length > max) throw new ValidationError(`${label} is too long (max ${max} characters)`);
  return s;
}

export function parseOptionalText(v: unknown, label: string, max = 1000): string | null {
  const s = text(v);
  if (!s) return null;
  if (s.length > max) throw new ValidationError(`${label} is too long (max ${max} characters)`);
  return s;
}

export function parseId(v: unknown, label = "Id"): string {
  const s = text(v);
  if (!UUID_RE.test(s)) throw new ValidationError(`${label} is not valid`);
  return s;
}

export function parseOptionalId(v: unknown, label = "Id"): string | null {
  const s = text(v);
  return s ? parseId(s, label) : null;
}

export function parsePattern(v: unknown): string {
  const s = parseName(v, "Pattern", 100);
  try {
    new RegExp(s, "i");
  } catch {
    throw new ValidationError("Pattern is not a valid expression");
  }
  return s;
}
