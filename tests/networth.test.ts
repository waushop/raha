import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { latestBalances, monthlyChange, netWorthSeries, type Account, type Snapshot } from "@/lib/networth";

const accounts: Account[] = [
  { ID: "main", NAME: "Main", TYPE: "cash", SORT_ORDER: 0 },
  { ID: "save", NAME: "Savings", TYPE: "savings", SORT_ORDER: 1 },
  { ID: "loan", NAME: "Car loan", TYPE: "debt", SORT_ORDER: 2 },
];
const snapshots: Snapshot[] = [
  { ACCOUNT_ID: "main", MONTH: "2026-01", BALANCE: 1000 },
  { ACCOUNT_ID: "main", MONTH: "2026-03", BALANCE: 1500 },
  { ACCOUNT_ID: "save", MONTH: "2026-02", BALANCE: 4000 },
  { ACCOUNT_ID: "loan", MONTH: "2026-01", BALANCE: 9000 },
  { ACCOUNT_ID: "loan", MONTH: "2026-03", BALANCE: 8500 },
];
const months = ["2026-01", "2026-02", "2026-03", "2026-04"];

describe("net worth series", () => {
  test("carries the last known balance forward and subtracts debts", () => {
    const s = netWorthSeries(accounts, snapshots, months);
    assert.deepEqual(s, [
      { month: "2026-01", assets: 1000, debts: 9000, net: -8000 },
      { month: "2026-02", assets: 5000, debts: 9000, net: -4000 }, // savings appears, main carried
      { month: "2026-03", assets: 5500, debts: 8500, net: -3000 },
      { month: "2026-04", assets: 5500, debts: 8500, net: -3000 }, // nothing new: all carried
    ]);
  });
  test("an account without an earlier snapshot contributes nothing; no accounts gives zeros", () => {
    const s = netWorthSeries(accounts, [{ ACCOUNT_ID: "save", MONTH: "2026-03", BALANCE: 10 }], months);
    assert.deepEqual(s.map((p) => p.net), [0, 0, 10, 10]);
    assert.deepEqual(netWorthSeries([], snapshots, ["2026-05"]), [{ month: "2026-05", assets: 0, debts: 0, net: 0 }]);
  });
  test("snapshots of deleted or unknown accounts are ignored", () => {
    const s = netWorthSeries(accounts.slice(0, 1), snapshots, ["2026-03"]);
    assert.deepEqual(s, [{ month: "2026-03", assets: 1500, debts: 0, net: 1500 }]);
  });
});

describe("latest balances and monthly change", () => {
  test("latestBalances picks the newest month per account regardless of input order", () => {
    const latest = latestBalances([...snapshots].reverse());
    assert.deepEqual(latest.get("main"), { month: "2026-03", balance: 1500 });
    assert.deepEqual(latest.get("save"), { month: "2026-02", balance: 4000 });
    assert.equal(latest.has("other"), false);
  });
  test("monthlyChange compares the last two points", () => {
    const s = netWorthSeries(accounts, snapshots, ["2026-02", "2026-03"]);
    assert.deepEqual(monthlyChange(s), { amount: 1000, pct: 25 });
    assert.equal(monthlyChange(s.slice(1)), null);
    assert.deepEqual(monthlyChange([{ month: "a", assets: 0, debts: 0, net: 0 }, { month: "b", assets: 5, debts: 0, net: 5 }]), { amount: 5, pct: null });
  });
});

describe("net worth database view", () => {
  process.env.DB_PATH = ":memory:";
  const WS = "33333333-3333-4333-8333-333333333333";
  test("getNetWorth carries the newest pre-window snapshot into the series and skips deleted accounts", async () => {
    const db = (await import("@/lib/db")).default;
    const { getNetWorth } = await import("@/lib/networth-db");
    const { randomUUID } = await import("node:crypto");
    const cash = randomUUID(), loan = randomUUID(), gone = randomUUID();
    await db.execute("INSERT INTO ACCOUNT (ID, WORKSPACE_ID, NAME, TYPE, SORT_ORDER) VALUES (?, ?, 'Cash', 'cash', 0)", [cash, WS]);
    await db.execute("INSERT INTO ACCOUNT (ID, WORKSPACE_ID, NAME, TYPE, SORT_ORDER) VALUES (?, ?, 'Loan', 'debt', 1)", [loan, WS]);
    await db.execute("INSERT INTO ACCOUNT (ID, WORKSPACE_ID, NAME, TYPE, SORT_ORDER, DELETED_AT) VALUES (?, ?, 'Old', 'cash', 2, CURRENT_TIMESTAMP)", [gone, WS]);
    const ins = (acc: string, month: string, bal: number) =>
      db.execute("INSERT INTO ACCOUNT_SNAPSHOT (ID, WORKSPACE_ID, ACCOUNT_ID, MONTH, BALANCE) VALUES (?, ?, ?, ?, ?)", [randomUUID(), WS, acc, month, bal]);
    await ins(cash, "2020-01", 500); // far before the 24-month window: must still seed the carry-forward
    await ins(cash, "2026-09", 900);
    await ins(loan, "2026-08", 3000);
    await ins(gone, "2026-10", 99999);
    const view = await getNetWorth(WS, "2026-10");
    assert.equal(view.series.length, 24);
    assert.equal(view.series[0].month, "2024-11");
    assert.deepEqual(view.series[0], { month: "2024-11", assets: 500, debts: 0, net: 500 });
    assert.deepEqual(view.current, { month: "2026-10", assets: 900, debts: 3000, net: -2100 });
    assert.equal(view.accounts.length, 2);
    assert.deepEqual(view.accounts.map((a) => [a.NAME, a.balance, a.asOf]), [["Cash", 900, "2026-09"], ["Loan", 3000, "2026-08"]]);
    assert.deepEqual(view.change, { amount: 0, pct: 0 });
    // upsert on (ACCOUNT_ID, MONTH) overwrites instead of duplicating
    await db.execute("INSERT INTO ACCOUNT_SNAPSHOT (ID, WORKSPACE_ID, ACCOUNT_ID, MONTH, BALANCE) VALUES (?, ?, ?, '2026-09', 950) ON CONFLICT(ACCOUNT_ID, MONTH) DO UPDATE SET BALANCE = excluded.BALANCE", [randomUUID(), WS, cash]);
    const [rows] = await db.execute("SELECT COUNT(*) AS N FROM ACCOUNT_SNAPSHOT WHERE ACCOUNT_ID = ?", [cash]);
    assert.equal((rows as { N: number }[])[0].N, 2);
  });
});
