// Per-user preferences, stored in APP_SETTING as one row per preference under
// `pref:<userId>:<name>` (no extra table; reads/writes in preferences-db.ts,
// this file stays client-safe). Parsing is pure and strict for
// form input (`parsePreferences` throws ValidationError) and forgiving for
// stored values (`readPreferences` falls back to the default per key), so a
// bad row can never break a page.
import { ValidationError } from "./validate";

export const LANDING_PAGES = ["dashboard", "month", "plan", "subscriptions"] as const;
export type LandingPage = (typeof LANDING_PAGES)[number];
export const WEEK_STARTS = ["mon", "sun"] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];

export type Preferences = {
  landing: LandingPage;
  sidebarMonths: number;
  safeBuffer: number;
  weekStart: WeekStart;
};

export const DEFAULT_PREFERENCES: Preferences = { landing: "dashboard", sidebarMonths: 14, safeBuffer: 100, weekStart: "mon" };
export const SIDEBAR_MONTHS_MIN = 6;
export const SIDEBAR_MONTHS_MAX = 36;
export const SAFE_BUFFER_MAX = 5000;

export const PREF_NAMES = Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[];

const LANDING_PATHS: Record<LandingPage, string> = { dashboard: "/dashboard", month: "/", plan: "/plan", subscriptions: "/subscriptions" };

/** Where a successful sign-in sends this user. */
export function landingPath(p: Pick<Preferences, "landing">): string {
  return LANDING_PATHS[p.landing];
}

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

function parseLanding(v: unknown): LandingPage {
  const s = text(v);
  if (!(LANDING_PAGES as readonly string[]).includes(s)) throw new ValidationError("Unknown start page");
  return s as LandingPage;
}

function parseSidebarMonths(v: unknown): number {
  const n = Number(text(v));
  if (!Number.isInteger(n) || n < SIDEBAR_MONTHS_MIN || n > SIDEBAR_MONTHS_MAX) {
    throw new ValidationError(`Sidebar months must be a whole number from ${SIDEBAR_MONTHS_MIN} to ${SIDEBAR_MONTHS_MAX}`);
  }
  return n;
}

function parseSafeBuffer(v: unknown): number {
  const s = text(v).replace(",", ".");
  const n = s === "" ? NaN : Number(s);
  if (!Number.isFinite(n) || n < 0 || n > SAFE_BUFFER_MAX) throw new ValidationError(`Safety buffer must be between 0 and ${SAFE_BUFFER_MAX} €`);
  return Math.round(n * 100) / 100;
}

function parseWeekStart(v: unknown): WeekStart {
  const s = text(v);
  if (!(WEEK_STARTS as readonly string[]).includes(s)) throw new ValidationError("Week must start on Monday or Sunday");
  return s as WeekStart;
}

const PARSERS: { [K in keyof Preferences]: (v: unknown) => Preferences[K] } = {
  landing: parseLanding,
  sidebarMonths: parseSidebarMonths,
  safeBuffer: parseSafeBuffer,
  weekStart: parseWeekStart,
};

/** Validates a full set of preferences from form input; throws ValidationError. */
export function parsePreferences(input: { get(name: string): unknown }): Preferences {
  return {
    landing: PARSERS.landing(input.get("landing")),
    sidebarMonths: PARSERS.sidebarMonths(input.get("sidebarMonths")),
    safeBuffer: PARSERS.safeBuffer(input.get("safeBuffer")),
    weekStart: PARSERS.weekStart(input.get("weekStart")),
  };
}

/** Builds preferences from stored strings, using the default for anything missing or invalid. */
export function readPreferences(stored: Partial<Record<string, string>>): Preferences {
  const out = { ...DEFAULT_PREFERENCES };
  for (const name of PREF_NAMES) {
    const raw = stored[name];
    if (raw === undefined) continue;
    try {
      (out as Record<keyof Preferences, unknown>)[name] = PARSERS[name](raw);
    } catch {
      // keep the default
    }
  }
  return out;
}

export const prefKey = (userId: string, name: keyof Preferences): string => `pref:${userId}:${name}`;

/** Day-of-week indexes (0 = Sunday, as Date#getDay) in display order. */
export function weekdayOrder(weekStart: WeekStart): number[] {
  return weekStart === "sun" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
}

/** Empty cells before day 1 in a calendar grid that starts on `weekStart`. */
export function leadingBlanks(firstDayDow: number, weekStart: WeekStart): number {
  return weekStart === "sun" ? firstDayDow : (firstDayDow + 6) % 7;
}
