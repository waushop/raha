/**
 * Seed the local SQLite file with realistic sample data for development.
 *
 *   npm run seed            # refuses to run if LEDGER already has rows
 *   npm run seed -- --force # wipes ledger/groups/budgets/patterns first
 *
 * Honours DB_PATH like the app. Never run against production.
 * Deterministic: same output every run (seeded PRNG), so screenshots and
 * manual tests are reproducible.
 */
import { randomUUID } from "node:crypto";
import db from "../lib/db";
import type { CategoryKey } from "../types/expense";
import { parseTags } from "../lib/tags";
import { daysInMonth, addMonths as addMonthsKey } from "../lib/months";

const force = process.argv.includes("--force");
const MONTHS = 14; // ending with the current month
const NOW = new Date();

// ---------- deterministic PRNG (mulberry32) ----------
let seed = 20261016;
const rand = (): number => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo: number, hi: number): number => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
const chance = (p: number): boolean => rand() < p;
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const months: string[] = [];
for (let i = MONTHS - 1; i >= 0; i--) {
  months.push(monthKey(new Date(NOW.getFullYear(), NOW.getMonth() - i, 1)));
}

/** A plausible CREATED_AT inside the given month so /activity has a timeline. */
const timestampIn = (month: string, day: number): string => {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const d = Math.min(day, lastDay);
  const hh = String(8 + Math.floor(rand() * 13)).padStart(2, "0");
  const mm = String(Math.floor(rand() * 60)).padStart(2, "0");
  return `${month}-${String(d).padStart(2, "0")} ${hh}:${mm}:00`;
};

// ---------- groups ----------
type Group = { id: string; name: string; emoji: string; color: string };
const groups: Record<string, Group> = {
  home: { id: randomUUID(), name: "Home", emoji: "🏡", color: "blue" },
  car: { id: randomUUID(), name: "Car", emoji: "🚙", color: "orange" },
  kids: { id: randomUUID(), name: "Kids", emoji: "🧒", color: "pink" },
  fun: { id: randomUUID(), name: "Fun", emoji: "🎉", color: "purple" },
  personal: { id: randomUUID(), name: "Personal", emoji: "🙋", color: "green" },
};

// ---------- row model ----------
const GOAL_FUND = randomUUID();
const GOAL_TRIP = randomUUID();

type Row = {
  goal?: string;
  kind: "expense" | "income";
  category: CategoryKey;
  group: Group | null;
  name: string;
  amount: number;
  month: string;
  notes?: string;
  recurring?: boolean;
  tags?: string;
  day: number;
  deleted?: boolean;
};

const rows: Row[] = [];
const add = (r: Row): void => {
  rows.push(r);
};

for (const [idx, month] of months.entries()) {
  const isCurrent = idx === months.length - 1;
  const drift = 1 + idx * 0.004; // gentle inflation across the period

  // ----- income -----
  add({ kind: "income", category: "other", group: null, name: "Salary", amount: 2850, month, recurring: true, day: 1 });
  if (chance(0.35)) {
    add({ kind: "income", category: "other", group: null, name: "Freelance invoice", amount: between(300, 1200), month, day: 15, tags: "#freelance" });
  }
  if (month.endsWith("-12")) {
    add({ kind: "income", category: "other", group: null, name: "Year-end bonus", amount: 1500, month, day: 20, notes: "Annual bonus" });
  }

  // ----- fixed / recurring expenses -----
  add({ kind: "expense", category: "housing", group: groups.home, name: "Mortgage", amount: 745.32, month, recurring: true, day: 2 });
  add({ kind: "expense", category: "utilities", group: groups.home, name: "Electricity", amount: between(55, 140) * (month.match(/-(12|01|02)$/) ? 1.6 : 1), month, recurring: true, day: 5, notes: "Eesti Energia" });
  add({ kind: "expense", category: "utilities", group: groups.home, name: "Water & heating", amount: between(40, 95), month, recurring: true, day: 5 });
  add({ kind: "expense", category: "internet", group: groups.home, name: "Telia internet", amount: 29.9, month, recurring: true, day: 10 });
  add({ kind: "expense", category: "phone", group: groups.personal, name: "Mobile plan", amount: 19.99, month, recurring: true, day: 10 });
  add({ kind: "expense", category: "insurance", group: groups.car, name: "Car insurance", amount: 38.5, month, recurring: true, day: 7 });
  add({ kind: "expense", category: "loan", group: groups.car, name: "Car lease", amount: 310, month, recurring: true, day: 3 });
  add({ kind: "expense", category: "subscriptions", group: groups.fun, name: "Netflix", amount: 12.99, month, recurring: true, day: 12 });
  add({ kind: "expense", category: "subscriptions", group: groups.fun, name: "Spotify Family", amount: 17.99, month, recurring: true, day: 12 });
  add({ kind: "expense", category: "subscriptions", group: groups.personal, name: "iCloud 200GB", amount: 2.99, month, recurring: true, day: 14 });
  add({ kind: "expense", category: "sports", group: groups.personal, name: "Gym membership", amount: 39, month, recurring: true, day: 1 });
  add({ kind: "expense", category: "kids", group: groups.kids, name: "Kindergarten", amount: 85, month, recurring: true, day: 8 });
  add({ kind: "expense", category: "savings", group: null, name: "Index fund transfer", amount: 250, month, recurring: true, day: 2, tags: "#invest", goal: GOAL_FUND });
  if (idx >= months.length - 4) add({ kind: "expense", category: "savings", group: null, name: "Trip fund", amount: 120, month, day: 20, goal: GOAL_TRIP });

  // ----- groceries: several trips -----
  const trips = isCurrent ? 3 : 6 + Math.floor(rand() * 4);
  for (let t = 0; t < trips; t++) {
    add({ kind: "expense", category: "groceries", group: groups.home, name: pick(["Rimi", "Selver", "Prisma", "Coop", "Maxima"]), amount: between(18, 110) * drift, month, day: 2 + Math.floor((t / trips) * 27) });
  }

  // ----- fuel -----
  for (let f = 0; f < 2 + Math.floor(rand() * 2); f++) {
    add({ kind: "expense", category: "fuel", group: groups.car, name: pick(["Circle K", "Neste", "Olerex"]), amount: between(45, 80) * drift, month, day: 4 + f * 10 });
  }

  // ----- dining / entertainment -----
  for (let d = 0; d < 2 + Math.floor(rand() * 4); d++) {
    add({ kind: "expense", category: "dining", group: groups.fun, name: pick(["Lunch at work", "Pizza night", "Coffee", "Sushi takeaway", "Brunch"]), amount: between(6, 48), month, day: 3 + Math.floor(rand() * 25) });
  }
  if (chance(0.6)) {
    add({ kind: "expense", category: "entertainment", group: groups.fun, name: pick(["Cinema", "Concert tickets", "Board game", "Museum"]), amount: between(12, 90), month, day: 10 + Math.floor(rand() * 15), tags: "#weekend" });
  }

  // ----- occasional -----
  if (chance(0.5)) add({ kind: "expense", category: "clothing", group: groups.personal, name: pick(["H&M", "Zara", "Sportland"]), amount: between(25, 140), month, day: 16 });
  if (chance(0.4)) add({ kind: "expense", category: "kids", group: groups.kids, name: pick(["Shoes for kids", "Toys", "Swimming lessons"]), amount: between(20, 90), month, day: 18 });
  if (chance(0.3)) add({ kind: "expense", category: "health", group: groups.personal, name: pick(["Pharmacy", "Dentist", "Optician"]), amount: between(10, 160), month, day: 9 });
  if (chance(0.3)) add({ kind: "expense", category: "maintenance", group: groups.car, name: pick(["Oil change", "Winter tyres swap", "Car wash"]), amount: between(15, 220), month, day: 21 });
  if (chance(0.25)) add({ kind: "expense", category: "gifts", group: groups.personal, name: "Birthday present", amount: between(20, 80), month, day: 11, tags: "#gifts" });
  if (chance(0.2)) add({ kind: "expense", category: "pets", group: groups.home, name: "Vet / pet food", amount: between(25, 120), month, day: 13 });
  if (chance(0.2)) add({ kind: "expense", category: "education", group: groups.personal, name: "Online course", amount: between(15, 60), month, day: 6 });
  if (month.endsWith("-03")) add({ kind: "expense", category: "tax", group: null, name: "Income tax top-up", amount: 212.4, month, day: 25, notes: "Tax return 2025" });
  if (month.endsWith("-07")) add({ kind: "expense", category: "travel", group: groups.fun, name: "Summer trip to Saaremaa", amount: 640, month, day: 14, tags: "#travel, #family", notes: "3 nights, ferry included" });
  if (month.endsWith("-12")) {
    add({ kind: "expense", category: "gifts", group: groups.personal, name: "Christmas presents", amount: 385, month, day: 18, tags: "#gifts, #christmas" });
    add({ kind: "expense", category: "travel", group: groups.fun, name: "Flights to Tenerife", amount: 920, month, day: 5, tags: "#travel", notes: "February holiday, booked early" });
  }

  // one accidental duplicate per quarter, soft-deleted — exercises DELETED_AT filtering
  if (idx % 3 === 1) add({ kind: "expense", category: "groceries", group: groups.home, name: "Rimi (duplicate)", amount: 42.17, month, day: 12, deleted: true });
}

// ---------- write ----------
const budgets: Array<[string, number]> = [
  ["_total", 2600],
  ["groceries", 450],
  ["dining", 120],
  ["fuel", 180],
  ["entertainment", 80],
  ["clothing", 100],
  ["kids", 150],
];

const patterns: Array<[string, CategoryKey, Group | null, number]> = [
  ["RIMI", "groceries", groups.home, 10],
  ["SELVER", "groceries", groups.home, 10],
  ["PRISMA", "groceries", groups.home, 10],
  ["CIRCLE K", "fuel", groups.car, 10],
  ["NESTE", "fuel", groups.car, 10],
  ["NETFLIX", "subscriptions", groups.fun, 5],
  ["SPOTIFY", "subscriptions", groups.fun, 5],
  ["TELIA", "internet", groups.home, 5],
  ["APTEEK", "health", groups.personal, 1],
];

const result = db.transaction((tx) => {
  const existing = tx.all<{ n: number }>("SELECT COUNT(*) AS n FROM LEDGER")[0].n;
  if (existing > 0 && !force) {
    throw new Error(`LEDGER already has ${existing} rows. Re-run with --force to wipe and reseed.`);
  }
  if (force) {
    for (const t of ["LEDGER", "LEDGER_TAG", "LEDGER_AUDIT", "CATEGORY_GROUP", "BUDGET", "BUDGET_HISTORY", "IMPORT_PATTERN", "SAVINGS_GOAL"]) tx.run(`DELETE FROM ${t}`);
  }

  tx.run("INSERT INTO SAVINGS_GOAL (ID, NAME, EMOJI, TARGET_AMOUNT, TARGET_MONTH, STARTING_AMOUNT, CREATED_AT) VALUES (?, 'Emergency fund', '🛡️', 6000, ?, 1500, ?)", [GOAL_FUND, addMonthsKey(months[months.length - 1], 8), `${months[0]}-01 09:00:00`]);
  tx.run("INSERT INTO SAVINGS_GOAL (ID, NAME, EMOJI, TARGET_AMOUNT, TARGET_MONTH, STARTING_AMOUNT, CREATED_AT) VALUES (?, 'Summer trip', '🏖️', 1500, ?, 0, ?)", [GOAL_TRIP, addMonthsKey(months[months.length - 1], 7), `${months[months.length - 4]}-01 09:00:00`]);

  Object.values(groups).forEach((g, i) => {
    tx.run("INSERT INTO CATEGORY_GROUP (ID, NAME, EMOJI, COLOR, SORT_ORDER, CREATED_AT, UPDATED_AT) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      g.id, g.name, g.emoji, g.color, i, `${months[0]}-01 09:00:00`, `${months[0]}-01 09:00:00`,
    ]);
  });

  for (const r of rows) {
    const ts = timestampIn(r.month, r.day);
    const id = randomUUID();
    tx.run(
      `INSERT INTO LEDGER (ID, CREATED_AT, UPDATED_AT, DELETED_AT, KIND, CATEGORY, GROUP_ID, NAME, AMOUNT, MONTH, DAY, NOTES, IS_RECURRING, TAGS, GOAL_ID)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, ts, ts, r.deleted ? timestampIn(r.month, r.day + 1) : null,
        r.kind, r.category, r.group?.id ?? null, r.name, Math.round(r.amount * 100) / 100, r.month,
        Math.min(r.day, daysInMonth(r.month)), r.notes ?? null, r.recurring ? 1 : 0, r.tags ?? null, r.goal ?? null,
      ],
    );
    for (const tag of parseTags(r.tags)) tx.run("INSERT OR IGNORE INTO LEDGER_TAG (LEDGER_ID, TAG) VALUES (?, ?)", [id, tag]);
    const snap = JSON.stringify({ ID: id, KIND: r.kind, CATEGORY: r.category, GROUP_ID: r.group?.id ?? null, NAME: r.name, AMOUNT: Math.round(r.amount * 100) / 100, MONTH: r.month, DAY: Math.min(r.day, daysInMonth(r.month)), NOTES: r.notes ?? null, IS_RECURRING: r.recurring ? 1 : 0, TAGS: r.tags ?? null });
    tx.run("INSERT INTO LEDGER_AUDIT (ID, LEDGER_ID, ACTION, BEFORE_JSON, AFTER_JSON, AT) VALUES (?, ?, 'create', NULL, ?, ?)", [randomUUID(), id, snap, ts]);
    if (r.deleted) tx.run("INSERT INTO LEDGER_AUDIT (ID, LEDGER_ID, ACTION, BEFORE_JSON, AFTER_JSON, AT) VALUES (?, ?, 'delete', ?, ?, ?)", [randomUUID(), id, snap, snap, timestampIn(r.month, r.day + 1)]);
  }

  for (const [cat, amt] of budgets) tx.run("INSERT INTO BUDGET (CATEGORY, AMOUNT) VALUES (?, ?)", [cat, amt]);
  // Budget history: groceries cap was raised in April 2026, everything else flat.
  for (const month of months) {
    for (const [cat, amt] of budgets) {
      const historic = cat === "groceries" && month < "2026-04" ? 400 : amt;
      tx.run("INSERT INTO BUDGET_HISTORY (MONTH, CATEGORY, AMOUNT) VALUES (?, ?, ?)", [month, cat, historic]);
    }
  }
  for (const [p, cat, g, prio] of patterns) {
    tx.run("INSERT INTO IMPORT_PATTERN (ID, PATTERN, CATEGORY, GROUP_ID, PRIORITY) VALUES (?, ?, ?, ?, ?)", [randomUUID(), p, cat, g?.id ?? null, prio]);
  }

  return {
    months: `${months[0]} … ${months[months.length - 1]}`,
    ledger: rows.length,
    deleted: rows.filter((r) => r.deleted).length,
    income: rows.filter((r) => r.kind === "income").length,
    groups: Object.keys(groups).length,
    budgets: budgets.length,
    patterns: patterns.length,
  };
});

console.log("Seeded", process.env.DB_PATH ?? "./raha.sqlite", result);
