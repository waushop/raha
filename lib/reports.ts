// "Where did the money go" reports for /analytics. Everything here is pure:
// functions take plain rows (the SQL lives in lib/queries.ts) and return
// numbers or SVG geometry, so the layouts are unit-testable without a DB.
import type { Kind } from "@/types/expense";
import { daysInMonth } from "./months";

// ---------------------------------------------------------------------------
// Shared row shapes
// ---------------------------------------------------------------------------

/** One ledger row, as `ledgerRowsBetween` in lib/queries.ts returns it. */
export type ReportRow = {
  KIND: Kind;
  CATEGORY: string;
  GROUP_ID: string | null;
  NAME: string;
  AMOUNT: number;
  MONTH: string;
  DAY: number | null;
  GOAL_ID: string | null;
};

export type GroupRef = { ID: string; NAME: string; COLOR: string };

/** Hex equivalents of the Tailwind 500 shades used by GROUP_COLOR_CLASSES. */
export const GROUP_HEX: Record<string, string> = {
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  cyan: "#06b6d4",
};
export const UNGROUPED_HEX = "#5a6380";
export const SAVED_HEX = "#14b8a6";
export const DEFICIT_HEX = "#ef4444";

export function groupHex(color: string | null | undefined): string {
  return (color && GROUP_HEX[color]) || GROUP_HEX.blue;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// 1. Sankey: income → groups → categories
// ---------------------------------------------------------------------------

export type SankeyNode = {
  id: string;
  label: string;
  /** 0 = source (income), 1 = groups, 2 = categories */
  column: 0 | 1 | 2;
  value: number;
  color: string;
};

export type SankeyLink = { source: string; target: string; value: number; color: string };

export type SankeyData = {
  nodes: SankeyNode[];
  links: SankeyLink[];
  income: number;
  expenses: number;
  saved: number;
};

export const SANKEY_UNGROUPED = "group:ungrouped";
export const SANKEY_SAVED = "group:saved";
export const SANKEY_SOURCE = "source";
export const SANKEY_DEFICIT = "deficit";

/**
 * Builds the flow graph. Left: total income (plus a "Deficit" node when
 * spending exceeded it, so the ribbons still balance; "Spending" when no
 * income is tracked). Middle: category groups, "Ungrouped" and "Saved"
 * (income − expenses when positive). Right: categories, one node each.
 */
export function sankeyData(
  rows: ReportRow[],
  groups: GroupRef[],
  categoryLabel: (category: string) => string = (c) => c,
): SankeyData {
  const groupById = new Map(groups.map((g) => [g.ID, g]));
  let income = 0;
  let expenses = 0;
  const groupTotals = new Map<string, number>();
  const pairTotals = new Map<string, number>(); // `${groupKey}|${category}`
  for (const r of rows) {
    if (r.KIND === "income") { income += r.AMOUNT; continue; }
    if (r.KIND !== "expense" || r.AMOUNT <= 0) continue;
    expenses += r.AMOUNT;
    const key = r.GROUP_ID && groupById.has(r.GROUP_ID) ? `group:${r.GROUP_ID}` : SANKEY_UNGROUPED;
    groupTotals.set(key, (groupTotals.get(key) ?? 0) + r.AMOUNT);
    const pk = `${key}|${r.CATEGORY}`;
    pairTotals.set(pk, (pairTotals.get(pk) ?? 0) + r.AMOUNT);
  }
  const saved = income - expenses;

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  // Left column
  const leftNodes: SankeyNode[] = [];
  if (income > 0) {
    leftNodes.push({ id: SANKEY_SOURCE, label: "Income", column: 0, value: income, color: SAVED_HEX });
    if (saved < 0) leftNodes.push({ id: SANKEY_DEFICIT, label: "Deficit", column: 0, value: -saved, color: DEFICIT_HEX });
  } else if (expenses > 0) {
    leftNodes.push({ id: SANKEY_SOURCE, label: "Spending", column: 0, value: expenses, color: UNGROUPED_HEX });
  }
  const leftTotal = leftNodes.reduce((s, n) => s + n.value, 0);
  nodes.push(...leftNodes);

  // Middle column: groups sorted by value, then Ungrouped, then Saved
  const midNodes: SankeyNode[] = [];
  const groupInfo = (key: string): { label: string; color: string } => {
    if (key === SANKEY_UNGROUPED) return { label: "Ungrouped", color: UNGROUPED_HEX };
    const g = groupById.get(key.slice("group:".length));
    return { label: g?.NAME ?? "Ungrouped", color: g ? groupHex(g.COLOR) : UNGROUPED_HEX };
  };
  const sortedGroups = [...groupTotals.entries()]
    .filter(([k]) => k !== SANKEY_UNGROUPED)
    .sort((a, b) => b[1] - a[1]);
  if (groupTotals.has(SANKEY_UNGROUPED)) sortedGroups.push([SANKEY_UNGROUPED, groupTotals.get(SANKEY_UNGROUPED)!]);
  for (const [key, value] of sortedGroups) {
    const { label, color } = groupInfo(key);
    midNodes.push({ id: key, label, column: 1, value, color });
  }
  if (saved > 0 && income > 0) midNodes.push({ id: SANKEY_SAVED, label: "Saved", column: 1, value: saved, color: SAVED_HEX });
  nodes.push(...midNodes);

  // Left → middle: every left node feeds every middle node proportionally.
  for (const mid of midNodes) {
    for (const left of leftNodes) {
      const value = leftTotal > 0 ? (mid.value * left.value) / leftTotal : 0;
      if (value > 0) links.push({ source: left.id, target: mid.id, value, color: mid.color });
    }
  }

  // Right column: categories, coloured by their biggest group
  const catTotals = new Map<string, number>();
  const catColor = new Map<string, { value: number; color: string }>();
  for (const [pk, value] of pairTotals) {
    const [groupKey, category] = pk.split("|");
    catTotals.set(category, (catTotals.get(category) ?? 0) + value);
    const { color } = groupInfo(groupKey);
    const best = catColor.get(category);
    if (!best || value > best.value) catColor.set(category, { value, color });
    links.push({ source: groupKey, target: `cat:${category}`, value, color });
  }
  const rightNodes = [...catTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map<SankeyNode>(([category, value]) => ({
      id: `cat:${category}`,
      label: categoryLabel(category),
      column: 2,
      value,
      color: catColor.get(category)?.color ?? UNGROUPED_HEX,
    }));
  nodes.push(...rightNodes);

  return { nodes, links, income, expenses, saved };
}

export type SankeyLayoutOptions = { width?: number; height?: number; nodeWidth?: number; gap?: number };

export type SankeyPlacedNode = SankeyNode & { x: number; y: number; h: number; pct: number };
export type SankeyRibbon = SankeyLink & { d: string; pct: number };
export type SankeyLayout = {
  width: number;
  height: number;
  nodeWidth: number;
  nodes: SankeyPlacedNode[];
  ribbons: SankeyRibbon[];
  /** Total of the left column — the 100% every percentage refers to. */
  total: number;
};

/**
 * Positions nodes in three columns (heights proportional to value, packed
 * top-down with `gap` between them, each column vertically centred) and
 * builds one cubic-bezier ribbon path per link, stacked in node order so
 * ribbons never cross inside a node.
 */
export function sankeyLayout(data: SankeyData, opts: SankeyLayoutOptions = {}): SankeyLayout {
  const width = opts.width ?? 640;
  const height = opts.height ?? 360;
  const nodeWidth = opts.nodeWidth ?? 12;
  const gap = opts.gap ?? 6;

  const columns: SankeyNode[][] = [[], [], []];
  for (const n of data.nodes) columns[n.column].push(n);

  // One scale for every column so equal amounts have equal heights.
  let scale = Infinity;
  for (const col of columns) {
    const total = col.reduce((s, n) => s + n.value, 0);
    if (total <= 0) continue;
    const avail = height - gap * (col.length - 1);
    scale = Math.min(scale, Math.max(avail, 1) / total);
  }
  if (!Number.isFinite(scale)) scale = 0;

  const total = columns[0].reduce((s, n) => s + n.value, 0);
  const xFor = [0, (width - nodeWidth) / 2, width - nodeWidth];
  const placed = new Map<string, SankeyPlacedNode>();
  const nodes: SankeyPlacedNode[] = [];
  columns.forEach((col, ci) => {
    const used = col.reduce((s, n) => s + n.value * scale, 0) + gap * Math.max(0, col.length - 1);
    let y = Math.max(0, (height - used) / 2);
    for (const n of col) {
      const h = n.value * scale;
      const p: SankeyPlacedNode = { ...n, x: xFor[ci], y: round1(y), h: round1(h), pct: total > 0 ? (n.value / total) * 100 : 0 };
      placed.set(n.id, p);
      nodes.push(p);
      y += h + gap;
    }
  });

  // Stack ribbons: outgoing links in target order, incoming in source order.
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const links = data.links.filter((l) => placed.has(l.source) && placed.has(l.target) && l.value > 0);
  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  const sortedOut = [...links].sort((a, b) => (order.get(a.source)! - order.get(b.source)!) || (order.get(a.target)! - order.get(b.target)!));
  const sourceY = new Map<SankeyLink, number>();
  for (const l of sortedOut) {
    const s = placed.get(l.source)!;
    const off = outOffset.get(l.source) ?? 0;
    sourceY.set(l, s.y + off);
    outOffset.set(l.source, off + l.value * scale);
  }
  const sortedIn = [...links].sort((a, b) => (order.get(a.target)! - order.get(b.target)!) || (order.get(a.source)! - order.get(b.source)!));
  const targetY = new Map<SankeyLink, number>();
  for (const l of sortedIn) {
    const t = placed.get(l.target)!;
    const off = inOffset.get(l.target) ?? 0;
    targetY.set(l, t.y + off);
    inOffset.set(l.target, off + l.value * scale);
  }

  const ribbons: SankeyRibbon[] = links.map((l) => {
    const s = placed.get(l.source)!;
    const t = placed.get(l.target)!;
    const h = l.value * scale;
    const x0 = s.x + nodeWidth;
    const x1 = t.x;
    const c = (x0 + x1) / 2;
    const y0 = sourceY.get(l)!;
    const y1 = targetY.get(l)!;
    const f = (n: number) => round1(n);
    const d =
      `M${f(x0)},${f(y0)} C${f(c)},${f(y0)} ${f(c)},${f(y1)} ${f(x1)},${f(y1)} ` +
      `L${f(x1)},${f(y1 + h)} C${f(c)},${f(y1 + h)} ${f(c)},${f(y0 + h)} ${f(x0)},${f(y0 + h)} Z`;
    return { ...l, d, pct: total > 0 ? (l.value / total) * 100 : 0 };
  });

  return { width, height, nodeWidth, nodes, ribbons, total };
}

// ---------------------------------------------------------------------------
// 2. Merchant leaderboard
// ---------------------------------------------------------------------------

/** One row per (name, category, month), as `merchantMonthly` returns it. */
export type MerchantMonthRow = { NAME: string; CATEGORY: string; MONTH: string; TOTAL: number; CNT: number };

export type MerchantEntry = {
  name: string;
  category: string;
  count: number;
  amount: number;
  prevCount: number;
  prevAmount: number;
  /** Spend change vs the earlier window, in %; null when there was nothing to compare with. */
  deltaPct: number | null;
  countDeltaPct: number | null;
};

export type MerchantLeaderboard = { bySpend: MerchantEntry[]; byCount: MerchantEntry[] };

/**
 * Top merchants over `recent` months (by spend and by visit count), each
 * with the change against the `before` months. Both windows should be the
 * same length so the comparison is "last 3 months vs the 3 before".
 */
export function merchantLeaderboard(
  rows: MerchantMonthRow[],
  recent: string[],
  before: string[],
  limit = 15,
): MerchantLeaderboard {
  const recentSet = new Set(recent);
  const beforeSet = new Set(before);
  type Acc = { name: string; count: number; amount: number; prevCount: number; prevAmount: number; cats: Map<string, number> };
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const inRecent = recentSet.has(r.MONTH);
    const inBefore = beforeSet.has(r.MONTH);
    if (!inRecent && !inBefore) continue;
    const key = r.NAME.trim().toLowerCase();
    let a = acc.get(key);
    if (!a) {
      a = { name: r.NAME.trim(), count: 0, amount: 0, prevCount: 0, prevAmount: 0, cats: new Map() };
      acc.set(key, a);
    }
    if (inRecent) {
      a.count += r.CNT;
      a.amount += r.TOTAL;
      a.cats.set(r.CATEGORY, (a.cats.get(r.CATEGORY) ?? 0) + r.TOTAL);
    } else {
      a.prevCount += r.CNT;
      a.prevAmount += r.TOTAL;
      if (!a.cats.has(r.CATEGORY)) a.cats.set(r.CATEGORY, 0);
    }
  }
  const pct = (now: number, then: number): number | null => (then > 0 ? ((now - then) / then) * 100 : null);
  const entries: MerchantEntry[] = [];
  for (const a of acc.values()) {
    if (a.count === 0) continue;
    const category = [...a.cats.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "other";
    entries.push({
      name: a.name,
      category,
      count: a.count,
      amount: a.amount,
      prevCount: a.prevCount,
      prevAmount: a.prevAmount,
      deltaPct: pct(a.amount, a.prevAmount),
      countDeltaPct: pct(a.count, a.prevCount),
    });
  }
  const bySpend = [...entries].sort((a, b) => b.amount - a.amount || b.count - a.count).slice(0, limit);
  const byCount = [...entries].sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, limit);
  return { bySpend, byCount };
}

// ---------------------------------------------------------------------------
// 3. Sparklines and weekday split
// ---------------------------------------------------------------------------

/**
 * Points for an SVG <polyline> of `values` in a w×h box (1px inset so the
 * stroke isn't clipped). All-zero series draw a flat line on the baseline.
 */
export function sparkline(values: number[], w = 80, h = 20): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 0);
  const pad = 1;
  const innerH = h - pad * 2;
  const n = values.length;
  return values
    .map((v, i) => {
      const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
      const y = pad + (max > 0 ? 1 - Math.max(0, v) / max : 1) * innerH;
      return `${round1(x)},${round1(y)}`;
    })
    .join(" ");
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type DayBucket = { total: number; count: number; days: number; perDay: number };

export type WeekdaySplit = {
  weekday: DayBucket;
  weekend: DayBucket;
  /** Expense rows that had a DAY and were counted. */
  dated: number;
  /** Expense rows without a DAY, left out. */
  skipped: number;
  topDay: { month: string; day: number; weekday: string; total: number; count: number } | null;
  /** Totals per weekday, Sunday first. */
  byDow: number[];
};

/**
 * Weekday vs weekend spending from rows with a DAY. `months` lists the
 * calendar months of the window so per-day averages divide by the real
 * number of weekdays/weekend days, not by days that had purchases.
 */
export function weekdaySplit(rows: ReportRow[], months: string[]): WeekdaySplit {
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  const bucket = (): DayBucket => ({ total: 0, count: 0, days: 0, perDay: 0 });
  const weekday = bucket();
  const weekend = bucket();
  const perDate = new Map<string, { month: string; day: number; total: number; count: number }>();
  let dated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (r.KIND !== "expense") continue;
    const [y, m] = r.MONTH.split("-").map(Number);
    if (r.DAY == null || r.DAY < 1 || r.DAY > daysInMonth(r.MONTH)) { skipped++; continue; }
    dated++;
    const dow = new Date(y, m - 1, r.DAY).getDay();
    byDow[dow] += r.AMOUNT;
    const b = dow === 0 || dow === 6 ? weekend : weekday;
    b.total += r.AMOUNT;
    b.count += 1;
    const key = `${r.MONTH}-${r.DAY}`;
    const d = perDate.get(key) ?? { month: r.MONTH, day: r.DAY, total: 0, count: 0 };
    d.total += r.AMOUNT;
    d.count += 1;
    perDate.set(key, d);
  }
  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    const n = daysInMonth(month);
    for (let day = 1; day <= n; day++) {
      const dow = new Date(y, m - 1, day).getDay();
      (dow === 0 || dow === 6 ? weekend : weekday).days += 1;
    }
  }
  weekday.perDay = weekday.days > 0 ? weekday.total / weekday.days : 0;
  weekend.perDay = weekend.days > 0 ? weekend.total / weekend.days : 0;
  let top: WeekdaySplit["topDay"] = null;
  for (const d of perDate.values()) {
    if (!top || d.total > top.total) {
      const [y, m] = d.month.split("-").map(Number);
      top = { ...d, weekday: WEEKDAY_NAMES[new Date(y, m - 1, d.day).getDay()] };
    }
  }
  return { weekday, weekend, dated, skipped, topDay: top, byDow };
}

// ---------------------------------------------------------------------------
// 4. Savings rate series
// ---------------------------------------------------------------------------

export type SavingsPoint = {
  month: string;
  income: number;
  expense: number;
  goal: number;
  /** (income − expense + goal) / income in %, null without income. */
  rate: number | null;
  /** Part of `rate` that went into savings goals (darker segment). */
  goalShare: number;
  /** The rest of `rate` (may be negative when the month overspent). */
  freeShare: number;
};

export type SavingsSeries = { points: SavingsPoint[]; avg: number | null };

/**
 * Monthly savings rate. Goal contributions are ledger expense rows, so they
 * are added back: money moved into a goal counts as saved, not spent. The
 * average is the mean of the months that had income.
 */
export function savingsRateSeries(
  incomeByMonth: Record<string, number>,
  expenseByMonth: Record<string, number>,
  goalByMonth: Record<string, number>,
  months?: string[],
): SavingsSeries {
  const list = months ?? [...new Set([...Object.keys(incomeByMonth), ...Object.keys(expenseByMonth), ...Object.keys(goalByMonth)])].sort();
  const points = list.map<SavingsPoint>((month) => {
    const income = incomeByMonth[month] ?? 0;
    const expense = expenseByMonth[month] ?? 0;
    const goal = Math.min(goalByMonth[month] ?? 0, expense);
    if (income <= 0) return { month, income, expense, goal, rate: null, goalShare: 0, freeShare: 0 };
    const kept = income - expense + goal;
    const rate = (kept / income) * 100;
    const goalShare = rate > 0 ? (Math.min(goal, kept) / income) * 100 : 0;
    return { month, income, expense, goal, rate, goalShare, freeShare: rate - goalShare };
  });
  const withIncome = points.filter((p) => p.rate !== null);
  const avg = withIncome.length > 0 ? withIncome.reduce((s, p) => s + (p.rate ?? 0), 0) / withIncome.length : null;
  return { points, avg };
}
