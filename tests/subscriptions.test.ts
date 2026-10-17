import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  advance, backfillSubscriptions, detectCadence, expectedByMonthOfYear, isUnused, modeDay, monthlyEquivalent,
  nextDue, syncRowLink, upcoming, yearlyCost, type Q,
} from "@/lib/subscriptions";
import { initSchema } from "@/lib/schema";

describe("cadence detection", () => {
  test("monthly by default and for consecutive months", () => {
    assert.equal(detectCadence([]), "monthly");
    assert.equal(detectCadence([{ month: "2026-05", day: 12 }]), "monthly");
    assert.equal(detectCadence([{ month: "2026-05", day: 12 }, { month: "2026-06", day: 12 }, { month: "2026-07", day: 12 }]), "monthly");
  });
  test("yearly and quarterly from month gaps", () => {
    assert.equal(detectCadence([{ month: "2025-03", day: 1 }, { month: "2026-03", day: 1 }]), "yearly");
    assert.equal(detectCadence([{ month: "2026-01", day: 5 }, { month: "2026-04", day: 5 }, { month: "2026-07", day: 5 }]), "quarterly");
    // a skipped month breaks the pattern → monthly
    assert.equal(detectCadence([{ month: "2026-01", day: 5 }, { month: "2026-03", day: 5 }, { month: "2026-04", day: 5 }]), "monthly");
  });
  test("weekly from ~7-day gaps inside a month", () => {
    assert.equal(detectCadence([{ month: "2026-06", day: 2 }, { month: "2026-06", day: 9 }, { month: "2026-06", day: 16 }, { month: "2026-06", day: 23 }]), "weekly");
  });
  test("modeDay prefers the most frequent day, then the most recent", () => {
    assert.equal(modeDay([12, 12, 13, null]), 12);
    assert.equal(modeDay([13, 12]), 13);
    assert.equal(modeDay([null]), null);
  });
});

describe("costs", () => {
  test("monthly equivalent and yearly cost", () => {
    assert.equal(monthlyEquivalent(120, "yearly"), 10);
    assert.equal(monthlyEquivalent(30, "quarterly"), 10);
    assert.equal(yearlyCost(5, "weekly"), 260);
    assert.equal(yearlyCost(12.99, "monthly"), 155.88);
  });
});

describe("next due", () => {
  test("monthly: this month if the day is still ahead, else next month, clamped", () => {
    assert.equal(nextDue({ cadence: "monthly", day: 20, monthOfYear: null, lastCharge: null }, "2026-10-17"), "2026-10-20");
    assert.equal(nextDue({ cadence: "monthly", day: 5, monthOfYear: null, lastCharge: null }, "2026-10-17"), "2026-11-05");
    assert.equal(nextDue({ cadence: "monthly", day: 31, monthOfYear: null, lastCharge: null }, "2026-02-01"), "2026-02-28");
    assert.equal(nextDue({ cadence: "monthly", day: 17, monthOfYear: null, lastCharge: null }, "2026-10-17"), "2026-10-17");
  });
  test("a period that is already charged is skipped", () => {
    assert.equal(nextDue({ cadence: "monthly", day: 20, monthOfYear: null, lastCharge: { month: "2026-10", day: 20 } }, "2026-10-17"), "2026-11-20");
    assert.equal(nextDue({ cadence: "monthly", day: 1, monthOfYear: null, lastCharge: { month: "2026-11", day: 1 } }, "2026-10-17"), "2026-12-01");
    assert.equal(nextDue({ cadence: "yearly", day: 14, monthOfYear: 3, lastCharge: { month: "2027-03", day: 14 } }, "2026-10-17"), "2028-03-14");
    assert.equal(nextDue({ cadence: "weekly", day: null, monthOfYear: null, lastCharge: { month: "2026-10", day: 17 } }, "2026-10-17"), "2026-10-24");
  });
  test("yearly and quarterly use the anchor month", () => {
    assert.equal(nextDue({ cadence: "yearly", day: 3, monthOfYear: 3, lastCharge: null }, "2026-10-17"), "2027-03-03");
    assert.equal(nextDue({ cadence: "yearly", day: null, monthOfYear: null, lastCharge: { month: "2026-03", day: 3 } }, "2026-10-17"), "2027-03-03");
    assert.equal(nextDue({ cadence: "quarterly", day: 1, monthOfYear: 1, lastCharge: null }, "2026-10-17"), "2027-01-01");
    assert.equal(nextDue({ cadence: "quarterly", day: 20, monthOfYear: 1, lastCharge: null }, "2026-10-17"), "2026-10-20");
  });
  test("weekly steps 7 days from the last charge", () => {
    assert.equal(nextDue({ cadence: "weekly", day: null, monthOfYear: null, lastCharge: { month: "2026-10", day: 2 } }, "2026-10-17"), "2026-10-23");
    assert.equal(nextDue({ cadence: "weekly", day: null, monthOfYear: null, lastCharge: null }, "2026-10-17"), "2026-10-17");
  });
  test("advance keeps the intended day across short months", () => {
    assert.equal(advance("2026-01-31", "monthly", 31), "2026-02-28");
    assert.equal(advance("2026-10-20", "quarterly", 20), "2027-01-20");
    assert.equal(advance("2026-10-23", "weekly", null), "2026-10-30");
  });
  test("upcoming lists every charge in the window, soonest first", () => {
    const subs = [
      { id: "a", amount: 10, status: "active" as const, cadence: "monthly" as const, day: 25, monthOfYear: null, lastCharge: null },
      { id: "b", amount: 5, status: "active" as const, cadence: "weekly" as const, day: null, monthOfYear: null, lastCharge: { month: "2026-10", day: 16 } },
      { id: "c", amount: 99, status: "paused" as const, cadence: "monthly" as const, day: 18, monthOfYear: null, lastCharge: null },
    ];
    const list = upcoming(subs, "2026-10-17", 14).map((u) => `${u.date}:${u.sub.id}`);
    assert.deepEqual(list, ["2026-10-23:b", "2026-10-25:a", "2026-10-30:b"]);
  });
});

describe("unused and calendar", () => {
  test("isUnused respects the cadence", () => {
    assert.equal(isUnused("monthly", "2026-07", "2026-10"), true);
    assert.equal(isUnused("monthly", "2026-08", "2026-10"), false);
    assert.equal(isUnused("yearly", "2025-01", "2026-10"), false);
    assert.equal(isUnused("monthly", null, "2026-10"), false);
  });
  test("expectedByMonthOfYear spreads cadences over the year", () => {
    const out = expectedByMonthOfYear([
      { amount: 10, cadence: "monthly", anchorMonth: 1, status: "active" },
      { amount: 120, cadence: "yearly", anchorMonth: 3, status: "active" },
      { amount: 30, cadence: "quarterly", anchorMonth: 2, status: "active" },
      { amount: 999, cadence: "monthly", anchorMonth: 1, status: "cancelled" },
    ]);
    assert.deepEqual(out, [10, 40, 130, 10, 40, 10, 10, 40, 10, 10, 40, 10]);
  });
});

function q(db: DatabaseSync): Q {
  return {
    all: <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    run: (sql: string, params: unknown[] = []) => db.prepare(sql).run(...(params as never[])),
  };
}

function seedWorkspace(db: DatabaseSync): string {
  const ws = randomUUID();
  db.prepare("INSERT INTO USER (ID, NAME, PIN_HASH, IS_ADMIN) VALUES (?, 'T', 'x', 1)").run("u1");
  db.prepare("INSERT INTO WORKSPACE (ID, NAME, KIND) VALUES (?, 'T', 'personal')").run(ws);
  return ws;
}

function insertRow(db: DatabaseSync, ws: string, name: string, amount: number, month: string, day: number | null, recurring = 1): string {
  const id = randomUUID();
  db.prepare("INSERT INTO LEDGER (ID, WORKSPACE_ID, KIND, CATEGORY, NAME, AMOUNT, MONTH, DAY, IS_RECURRING, CREATED_AT) VALUES (?, ?, 'expense', 'subscriptions', ?, ?, ?, ?, ?, ?)")
    .run(id, ws, name, amount, month, day, recurring, `${month}-01 10:00:00`);
  return id;
}

describe("linking ledger rows to subscriptions", () => {
  test("backfill groups recurring rows, detects cadence, keeps the latest price and marks stale ones cancelled", () => {
    const db = new DatabaseSync(":memory:");
    initSchema(db);
    const ws = seedWorkspace(db);
    insertRow(db, ws, "Netflix", 9.99, "2026-07", 12);
    insertRow(db, ws, "Netflix", 9.99, "2026-08", 12);
    insertRow(db, ws, "Netflix", 12.99, "2026-09", 12);
    insertRow(db, ws, "Netflix", 12.99, "2026-10", 12);
    insertRow(db, ws, "Domain", 15, "2025-03", 3);
    insertRow(db, ws, "Domain", 15, "2026-03", 3);
    insertRow(db, ws, "Old gym", 30, "2026-01", 1);
    insertRow(db, ws, "Coffee", 3, "2026-10", 5, 0);
    const n = backfillSubscriptions(q(db), "2026-10", randomUUID);
    assert.equal(n, 3);
    const subs = db.prepare("SELECT NAME, CAST(AMOUNT AS REAL) AS AMOUNT, CADENCE, DAY, MONTH_OF_YEAR, STATUS FROM SUBSCRIPTION ORDER BY NAME").all() as Array<Record<string, unknown>>;
    assert.deepEqual(subs.map((s) => ({ ...s })), [
      { NAME: "Domain", AMOUNT: 15, CADENCE: "yearly", DAY: 3, MONTH_OF_YEAR: 3, STATUS: "active" },
      { NAME: "Netflix", AMOUNT: 12.99, CADENCE: "monthly", DAY: 12, MONTH_OF_YEAR: null, STATUS: "active" },
      { NAME: "Old gym", AMOUNT: 30, CADENCE: "monthly", DAY: 1, MONTH_OF_YEAR: null, STATUS: "cancelled" },
    ]);
    const linked = db.prepare("SELECT COUNT(*) AS n FROM LEDGER WHERE SUBSCRIPTION_ID IS NOT NULL").get() as { n: number };
    assert.equal(linked.n, 7);
    // idempotent
    assert.equal(backfillSubscriptions(q(db), "2026-10", randomUUID), 0);
  });

  test("syncRowLink links a new recurring row, revives a cancelled subscription and unlinks when the flag is cleared", () => {
    const db = new DatabaseSync(":memory:");
    initSchema(db);
    const ws = seedWorkspace(db);
    insertRow(db, ws, "Gym", 30, "2026-01", 1);
    backfillSubscriptions(q(db), "2026-10", randomUUID);
    assert.equal((db.prepare("SELECT STATUS FROM SUBSCRIPTION").get() as { STATUS: string }).STATUS, "cancelled");
    const id = insertRow(db, ws, "Gym", 35, "2026-10", 2);
    syncRowLink(q(db), ws, id, "2026-10", randomUUID);
    const sub = db.prepare("SELECT STATUS, CAST(AMOUNT AS REAL) AS AMOUNT, DAY FROM SUBSCRIPTION").get() as { STATUS: string; AMOUNT: number; DAY: number };
    assert.deepEqual({ ...sub }, { STATUS: "active", AMOUNT: 35, DAY: 2 });
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM SUBSCRIPTION").get() as { n: number }).n, 1);
    db.prepare("UPDATE LEDGER SET IS_RECURRING = 0 WHERE ID = ?").run(id);
    syncRowLink(q(db), ws, id, "2026-10", randomUUID);
    assert.equal((db.prepare("SELECT SUBSCRIPTION_ID FROM LEDGER WHERE ID = ?").get(id) as { SUBSCRIPTION_ID: string | null }).SUBSCRIPTION_ID, null);
  });
});

describe("stopped subscriptions stay stopped", () => {
  test("a charge in or before the cancel month does not revive; a later one does", () => {
    const db = new DatabaseSync(":memory:");
    initSchema(db);
    const ws = seedWorkspace(db);
    insertRow(db, ws, "Netflix", 13, "2026-09", 12);
    backfillSubscriptions(q(db), "2026-10", randomUUID);
    db.prepare("UPDATE SUBSCRIPTION SET STATUS = 'cancelled', STATUS_CHANGED_AT = '2026-10-05 10:00:00'").run();
    const same = insertRow(db, ws, "Netflix", 13, "2026-10", 12);
    syncRowLink(q(db), ws, same, "2026-10", randomUUID);
    assert.equal((db.prepare("SELECT STATUS FROM SUBSCRIPTION").get() as { STATUS: string }).STATUS, "cancelled");
    const later = insertRow(db, ws, "Netflix", 14, "2026-11", 12);
    syncRowLink(q(db), ws, later, "2026-11", randomUUID);
    assert.equal((db.prepare("SELECT STATUS FROM SUBSCRIPTION").get() as { STATUS: string }).STATUS, "active");
  });
});
