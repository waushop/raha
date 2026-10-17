import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  sankeyData, sankeyLayout, merchantLeaderboard, sparkline, weekdaySplit, savingsRateSeries,
  SANKEY_SAVED, SANKEY_UNGROUPED, SANKEY_SOURCE, SANKEY_DEFICIT, GROUP_HEX, UNGROUPED_HEX,
  type ReportRow,
} from "@/lib/reports";

const row = (p: Partial<ReportRow>): ReportRow => ({
  KIND: "expense", CATEGORY: "groceries", GROUP_ID: null, NAME: "Shop", AMOUNT: 10,
  MONTH: "2026-09", DAY: null, GOAL_ID: null, ...p,
});

const groups = [
  { ID: "g1", NAME: "Home", COLOR: "blue" },
  { ID: "g2", NAME: "Car", COLOR: "orange" },
];

describe("sankeyData", () => {
  test("builds income → groups → categories with Ungrouped and Saved", () => {
    const d = sankeyData([
      row({ KIND: "income", CATEGORY: "other", AMOUNT: 1000 }),
      row({ GROUP_ID: "g1", CATEGORY: "housing", AMOUNT: 400 }),
      row({ GROUP_ID: "g1", CATEGORY: "utilities", AMOUNT: 100 }),
      row({ GROUP_ID: "g2", CATEGORY: "fuel", AMOUNT: 150 }),
      row({ GROUP_ID: null, CATEGORY: "dining", AMOUNT: 50 }),
      row({ GROUP_ID: "gone", CATEGORY: "dining", AMOUNT: 25 }),
    ], groups, (c) => c.toUpperCase());
    assert.equal(d.income, 1000);
    assert.equal(d.expenses, 725);
    assert.equal(d.saved, 275);
    const ids = d.nodes.map((n) => n.id);
    assert.deepEqual(ids, [SANKEY_SOURCE, "group:g1", "group:g2", SANKEY_UNGROUPED, SANKEY_SAVED, "cat:housing", "cat:fuel", "cat:utilities", "cat:dining"]);
    const home = d.nodes.find((n) => n.id === "group:g1")!;
    assert.equal(home.value, 500);
    assert.equal(home.color, GROUP_HEX.blue);
    const ungrouped = d.nodes.find((n) => n.id === SANKEY_UNGROUPED)!;
    assert.equal(ungrouped.value, 75);
    assert.equal(ungrouped.color, UNGROUPED_HEX);
    assert.equal(d.nodes.find((n) => n.id === "cat:housing")!.label, "HOUSING");
    // Left → middle covers every middle node (incl. Saved), middle → right balances every group.
    const midTotal = d.links.filter((l) => l.source === SANKEY_SOURCE).reduce((s, l) => s + l.value, 0);
    assert.equal(midTotal, 1000);
    const homeOut = d.links.filter((l) => l.source === "group:g1").reduce((s, l) => s + l.value, 0);
    assert.equal(homeOut, 500);
    assert.equal(d.links.filter((l) => l.source === SANKEY_SAVED).length, 0);
  });

  test("adds a Deficit source when spending beats income, and uses Spending without income", () => {
    const over = sankeyData([
      row({ KIND: "income", AMOUNT: 100 }),
      row({ CATEGORY: "dining", AMOUNT: 150 }),
    ], []);
    const left = over.nodes.filter((n) => n.column === 0);
    assert.deepEqual(left.map((n) => [n.id, n.value]), [[SANKEY_SOURCE, 100], [SANKEY_DEFICIT, 50]]);
    assert.ok(!over.nodes.some((n) => n.id === SANKEY_SAVED));
    const intoDining = over.links.filter((l) => l.target === SANKEY_UNGROUPED).reduce((s, l) => s + l.value, 0);
    assert.equal(intoDining, 150);

    const noIncome = sankeyData([row({ AMOUNT: 30 })], []);
    assert.equal(noIncome.nodes[0].label, "Spending");
    assert.equal(noIncome.nodes[0].value, 30);

    assert.equal(sankeyData([], []).nodes.length, 0);
  });
});

describe("sankeyLayout", () => {
  const data = sankeyData([
    row({ KIND: "income", AMOUNT: 1000 }),
    row({ GROUP_ID: "g1", CATEGORY: "housing", AMOUNT: 400 }),
    row({ GROUP_ID: "g1", CATEGORY: "utilities", AMOUNT: 100 }),
    row({ GROUP_ID: "g2", CATEGORY: "fuel", AMOUNT: 200 }),
    row({ CATEGORY: "dining", AMOUNT: 100 }),
  ], groups);
  const layout = sankeyLayout(data, { width: 600, height: 300, nodeWidth: 10, gap: 6 });

  test("node heights are proportional to value and columns sit at the edges", () => {
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const income = byId.get(SANKEY_SOURCE)!;
    const home = byId.get("group:g1")!;
    const saved = byId.get(SANKEY_SAVED)!;
    assert.equal(income.x, 0);
    assert.equal(home.x, 295);
    assert.equal(byId.get("cat:housing")!.x, 590);
    assert.ok(Math.abs(home.h / income.h - 0.5) < 0.01);
    assert.ok(Math.abs(saved.h / income.h - 0.2) < 0.01);
    assert.equal(Math.round(home.pct), 50);
    // The middle column (4 nodes, 3 gaps) sets the shared scale and spans the full height.
    const mid = layout.nodes.filter((n) => n.column === 1);
    assert.equal(mid[mid.length - 1].y + mid[mid.length - 1].h - mid[0].y, 300);
    assert.equal(income.h, 300 - 3 * 6);
  });

  test("nodes in a column are packed with the gap and never overlap", () => {
    for (const col of [0, 1, 2] as const) {
      const nodes = layout.nodes.filter((n) => n.column === col);
      for (let i = 1; i < nodes.length; i++) {
        assert.ok(nodes[i].y >= nodes[i - 1].y + nodes[i - 1].h + 6 - 0.2, `column ${col} node ${i} overlaps`);
      }
      const last = nodes[nodes.length - 1];
      assert.ok(last.y + last.h <= 300.2);
    }
  });

  test("ribbons stack to fill their nodes and are closed bezier paths", () => {
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    for (const n of layout.nodes.filter((x) => x.column === 1 && x.id !== SANKEY_SAVED)) {
      const incoming = layout.ribbons.filter((r) => r.target === n.id);
      const outgoing = layout.ribbons.filter((r) => r.source === n.id);
      const scale = byId.get(SANKEY_SOURCE)!.h / 1000;
      const sumIn = incoming.reduce((s, r) => s + r.value * scale, 0);
      const sumOut = outgoing.reduce((s, r) => s + r.value * scale, 0);
      assert.ok(Math.abs(sumIn - n.h) < 0.2, `incoming ${sumIn} vs ${n.h}`);
      assert.ok(Math.abs(sumOut - n.h) < 0.2, `outgoing ${sumOut} vs ${n.h}`);
    }
    for (const r of layout.ribbons) {
      assert.match(r.d, /^M[\d.]+,[\d.]+ C.* Z$/);
      assert.ok(r.pct > 0 && r.pct <= 100);
    }
    const housing = layout.ribbons.find((r) => r.target === "cat:housing")!;
    assert.equal(Math.round(housing.pct), 40);
    assert.equal(housing.color, GROUP_HEX.blue);
  });

  test("an empty graph lays out without NaN", () => {
    const empty = sankeyLayout(sankeyData([], []));
    assert.equal(empty.nodes.length, 0);
    assert.equal(empty.ribbons.length, 0);
    assert.equal(empty.total, 0);
  });
});

describe("merchantLeaderboard", () => {
  const rows = [
    { NAME: "Rimi", CATEGORY: "groceries", MONTH: "2026-09", TOTAL: 200, CNT: 8 },
    { NAME: "rimi ", CATEGORY: "groceries", MONTH: "2026-08", TOTAL: 100, CNT: 4 },
    { NAME: "Rimi", CATEGORY: "household", MONTH: "2026-07", TOTAL: 30, CNT: 1 },
    { NAME: "Rimi", CATEGORY: "groceries", MONTH: "2026-06", TOTAL: 100, CNT: 5 },
    { NAME: "Rimi", CATEGORY: "groceries", MONTH: "2026-05", TOTAL: 100, CNT: 5 },
    { NAME: "Circle K", CATEGORY: "fuel", MONTH: "2026-09", TOTAL: 500, CNT: 2 },
    { NAME: "Bolt", CATEGORY: "transport", MONTH: "2026-09", TOTAL: 50, CNT: 10 },
    { NAME: "Old shop", CATEGORY: "other", MONTH: "2026-04", TOTAL: 999, CNT: 1 },
    { NAME: "Outside", CATEGORY: "other", MONTH: "2026-03", TOTAL: 5, CNT: 1 },
  ];
  const recent = ["2026-07", "2026-08", "2026-09"];
  const before = ["2026-04", "2026-05", "2026-06"];

  test("ranks by spend and by count with deltas against the earlier window", () => {
    const lb = merchantLeaderboard(rows, recent, before);
    assert.deepEqual(lb.bySpend.map((e) => e.name), ["Circle K", "Rimi", "Bolt"]);
    assert.deepEqual(lb.byCount.map((e) => e.name), ["Rimi", "Bolt", "Circle K"]);
    const rimi = lb.bySpend[1];
    assert.equal(rimi.amount, 330);
    assert.equal(rimi.count, 13);
    assert.equal(rimi.category, "groceries");
    assert.equal(rimi.prevAmount, 200);
    assert.equal(rimi.deltaPct, 65);
    assert.equal(rimi.countDeltaPct, 30);
    const circle = lb.bySpend[0];
    assert.equal(circle.deltaPct, null);
    assert.equal(circle.prevAmount, 0);
  });

  test("merchants only seen in the earlier window are left out and limit applies", () => {
    const lb = merchantLeaderboard(rows, recent, before, 1);
    assert.equal(lb.bySpend.length, 1);
    assert.ok(!lb.bySpend.some((e) => e.name === "Old shop"));
  });
});

describe("sparkline", () => {
  test("spreads points across the width and scales to the max", () => {
    assert.equal(sparkline([0, 50, 100], 80, 20), "0,19 40,10 80,1");
  });
  test("flat series stay on the baseline, single values centre", () => {
    assert.equal(sparkline([0, 0], 80, 20), "0,19 80,19");
    assert.equal(sparkline([5], 80, 20), "40,1");
    assert.equal(sparkline([]), "");
  });
});

describe("weekdaySplit", () => {
  test("splits dated rows by weekday, skips undated, finds the top day", () => {
    // 2026-09-05 is a Saturday, 2026-09-07 a Monday.
    const s = weekdaySplit([
      row({ MONTH: "2026-09", DAY: 5, AMOUNT: 80 }),
      row({ MONTH: "2026-09", DAY: 5, AMOUNT: 20 }),
      row({ MONTH: "2026-09", DAY: 7, AMOUNT: 30 }),
      row({ MONTH: "2026-09", DAY: null, AMOUNT: 999 }),
      row({ MONTH: "2026-09", DAY: 31, AMOUNT: 999 }),
      row({ KIND: "income", MONTH: "2026-09", DAY: 7, AMOUNT: 5000 }),
    ], ["2026-09"]);
    assert.equal(s.dated, 3);
    assert.equal(s.skipped, 2);
    assert.equal(s.weekend.total, 100);
    assert.equal(s.weekend.count, 2);
    assert.equal(s.weekday.total, 30);
    assert.equal(s.weekday.days, 22);
    assert.equal(s.weekend.days, 8);
    assert.equal(s.weekend.perDay, 12.5);
    assert.deepEqual(s.topDay, { month: "2026-09", day: 5, weekday: "Saturday", total: 100, count: 2 });
    assert.equal(s.byDow[6], 100);
    assert.equal(s.byDow[1], 30);
  });

  test("no dated rows gives empty buckets and no top day", () => {
    const s = weekdaySplit([row({ DAY: null })], []);
    assert.equal(s.topDay, null);
    assert.equal(s.skipped, 1);
    assert.equal(s.weekday.perDay, 0);
  });
});

describe("savingsRateSeries", () => {
  test("rates per month with goal contributions counted as saved", () => {
    const s = savingsRateSeries(
      { "2026-07": 1000, "2026-08": 1000, "2026-09": 0 },
      { "2026-07": 800, "2026-08": 1100, "2026-09": 50 },
      { "2026-07": 100, "2026-08": 300 },
      ["2026-07", "2026-08", "2026-09"],
    );
    assert.equal(s.points.length, 3);
    const jul = s.points[0];
    assert.equal(jul.rate, 30);
    assert.equal(jul.goalShare, 10);
    assert.equal(jul.freeShare, 20);
    const aug = s.points[1];
    assert.equal(aug.rate, 20);
    assert.equal(aug.goalShare, 20); // overspent on everything else: the whole bar is goal money
    assert.equal(aug.freeShare, 0);
    assert.equal(s.points[2].rate, null);
    assert.equal(s.avg, 25);
  });

  test("negative months show as negative rate without a goal segment", () => {
    const s = savingsRateSeries({ m: 100 }, { m: 150 }, { m: 10 });
    assert.equal(s.points[0].rate, -40);
    assert.equal(s.points[0].goalShare, 0);
    assert.equal(s.points[0].freeShare, -40);
    assert.equal(savingsRateSeries({}, {}, {}).avg, null);
  });
});
