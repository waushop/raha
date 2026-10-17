import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DB_PATH = ":memory:";

type Db = typeof import("@/lib/db").default;
type Ledger = typeof import("@/lib/ledger");
type Tools = typeof import("@/lib/assistant-tools");
type LedgerSource = import("@/lib/ledger").LedgerSource;

describe("assistant tools", () => {
  let db: Db;
  let ledger: Ledger;
  let tools: Tools;
  let months: typeof import("@/lib/months");
  const A = randomUUID();
  const B = randomUUID();
  const homeA = randomUUID();
  const homeB = randomUUID();
  let now: string;
  let prev: string;

  before(async () => {
    db = (await import("@/lib/db")).default;
    ledger = await import("@/lib/ledger");
    tools = await import("@/lib/assistant-tools");
    months = await import("@/lib/months");
    now = months.currentMonth();
    prev = months.addMonths(now, -1);
  });

  const row = (over: Partial<LedgerSource> = {}): LedgerSource => ({
    KIND: "expense", CATEGORY: "groceries", GROUP_ID: null, NAME: "Rimi", AMOUNT: 10,
    NOTES: null, IS_RECURRING: 0, TAGS: null, DAY: 1, ...over,
  });

  beforeEach(async () => {
    await db.execute("DELETE FROM LEDGER_TAG");
    await db.execute("DELETE FROM LEDGER");
    await db.execute("DELETE FROM CATEGORY_GROUP");
    // Both workspaces have a group called "Home": a name filter must stay in its own workspace.
    await db.execute("INSERT INTO CATEGORY_GROUP (ID, WORKSPACE_ID, NAME, SORT_ORDER) VALUES (?, ?, 'Home', 0), (?, ?, 'Home', 0)", [homeA, A, homeB, B]);
    db.transaction((tx) => {
      ledger.insertRow(tx, A, row({ NAME: "Rimi", AMOUNT: 40, GROUP_ID: homeA, TAGS: "#food" }), now);
      ledger.insertRow(tx, A, row({ NAME: "Prisma", AMOUNT: 25.5 }), now);
      ledger.insertRow(tx, A, row({ NAME: "Circle K", CATEGORY: "fuel", AMOUNT: 60 }), prev);
      ledger.insertRow(tx, A, row({ NAME: "Salary", KIND: "income", CATEGORY: "other", AMOUNT: 3000 }), now);
      ledger.insertRow(tx, A, row({ NAME: "Deleted", AMOUNT: 999 }), now);
      // Workspace B: must never show up in A's answers.
      ledger.insertRow(tx, B, row({ NAME: "Rimi", AMOUNT: 500, GROUP_ID: homeB, TAGS: "#food" }), now);
      ledger.insertRow(tx, B, row({ NAME: "Secret shop", AMOUNT: 77 }), now);
    });
    await db.execute("UPDATE LEDGER SET DELETED_AT = CURRENT_TIMESTAMP WHERE NAME = 'Deleted'");
  });

  test("spending_by category only sums the caller's workspace, live expense rows", async () => {
    const r = await tools.spendingBy(A, "category", {});
    assert.equal(r.total, 125.5);
    assert.equal(r.count, 3);
    assert.deepEqual(r.rows.map((x) => [x.key, x.total]), [["groceries", 65.5], ["fuel", 60]]);
    const b = await tools.spendingBy(B, "category", {});
    assert.equal(b.total, 577);
  });

  test("spending_by filters: group name, tag, merchant text, month range, kind", async () => {
    const byGroup = await tools.spendingBy(A, "group", { group_name: "home" });
    assert.deepEqual(byGroup.rows, [{ key: "Home", total: 40, count: 1 }]);
    assert.match(byGroup.link, new RegExp(`group=${homeA}`), "links to the caller's own group id");
    const byTag = await tools.spendingBy(A, "tag", { tag: "#Food" });
    assert.deepEqual(byTag.rows, [{ key: "food", total: 40, count: 1 }]);
    const merchant = await tools.spendingBy(A, "merchant", { name_contains: "circle" });
    assert.deepEqual(merchant.rows.map((x) => x.key), ["Circle K"]);
    const thisMonth = await tools.spendingBy(A, "month", { from_month: now, to_month: now });
    assert.equal(thisMonth.total, 65.5);
    const income = await tools.spendingBy(A, "category", { kind: "income" });
    assert.equal(income.total, 3000);
    const none = await tools.spendingBy(A, "merchant", { name_contains: "Secret" });
    assert.equal(none.count, 0, "another workspace's merchant is invisible");
  });

  test("list_rows: workspace-scoped, ordered, links to the row, limit capped at 50", async () => {
    const r = await tools.listRows(A, {}, 10, "amount_desc");
    assert.deepEqual(r.rows.map((x) => x.name), ["Circle K", "Rimi", "Prisma"]);
    assert.equal(r.rows[0].link, `/?month=${prev}#e-${r.rows[0].id}`);
    assert.ok(r.rows.every((x) => x.name !== "Secret shop" && x.name !== "Deleted"));

    db.transaction((tx) => {
      for (let i = 0; i < 70; i++) ledger.insertRow(tx, A, row({ NAME: `Bulk ${i}`, AMOUNT: 1 }), now);
    });
    const capped = await tools.listRows(A, {}, 500, "date_desc");
    assert.equal(capped.rows.length, tools.MAX_LIST_ROWS);
    const dflt = await tools.listRows(A, {}, undefined, undefined);
    assert.equal(dflt.rows.length, 20);
  });

  test("monthly_totals fills empty months and sums one kind", async () => {
    const r = await tools.monthlyTotals(A, months.addMonths(now, -2), now, "expense");
    assert.deepEqual(r.months, [
      { month: months.addMonths(now, -2), total: 0 },
      { month: prev, total: 60 },
      { month: now, total: 65.5 },
    ]);
    assert.equal(r.total, 125.5);
  });

  test("bad arguments are tool input errors, not SQL", async () => {
    await assert.rejects(tools.spendingBy(A, "NAME; DROP TABLE LEDGER", {}), tools.ToolInputError);
    await assert.rejects(tools.spendingBy(A, "category", { category: "beer" }), tools.ToolInputError);
    await assert.rejects(tools.spendingBy(A, "category", { from_month: "2026-13" }), tools.ToolInputError);
    await assert.rejects(tools.spendingBy(A, "category", { from_month: "2026-05", to_month: "2026-01" }), tools.ToolInputError);
    await assert.rejects(tools.listRows(A, {}, 5, "random()"), tools.ToolInputError);
    await assert.rejects(tools.listRows(A, {}, 0, undefined), tools.ToolInputError);
    await assert.rejects(tools.runTool({ workspaceId: A, userId: randomUUID() }, "run_sql", {}), tools.ToolInputError);
    // LIKE wildcards in name_contains are literal
    assert.equal((await tools.spendingBy(A, "merchant", { name_contains: "%" })).count, 0);
  });

  test("runTool passes the context's workspace, whatever the input says", async () => {
    const r = await tools.runTool({ workspaceId: A, userId: randomUUID() }, "spending_by", { by: "merchant", filters: {}, workspace_id: B }) as { total: number };
    assert.equal(r.total, 125.5);
  });

  test("goals, net worth and subscriptions tools run on an empty workspace", async () => {
    const ctx = { workspaceId: randomUUID(), userId: randomUUID() };
    assert.deepEqual(await tools.runTool(ctx, "goals", {}), { link: "/goals", goals: [] });
    const nw = await tools.runTool(ctx, "net_worth", {}) as { accounts: unknown[] };
    assert.deepEqual(nw.accounts, []);
    const subs = await tools.runTool(ctx, "subscriptions", {}) as { subscriptions: unknown[] };
    assert.deepEqual(subs.subscriptions, []);
  });

  test("mock answers quote real numbers and in-app links", async () => {
    const { mockAnswer } = await import("@/lib/assistant");
    const r = await mockAnswer({ workspaceId: A, userId: randomUUID() }, "How much did we spend on groceries this year?");
    assert.deepEqual(r.toolsUsed, ["spending_by"]);
    assert.ok(r.answer.includes("65.50 €"), r.answer);
    assert.match(r.answer, /\]\(\/search\?/);
    const big = await mockAnswer({ workspaceId: A, userId: randomUUID() }, "Biggest expenses last month");
    assert.match(big.answer, /\[Circle K\]\(\/\?month=\d{4}-\d{2}#e-[0-9a-f-]{36}\): 60\.00 €/);
  });
});
