// Read-only tools for the "Ask your money" assistant. The model picks a tool
// and fills in typed, validated arguments; every query here is a fixed,
// parameterised SELECT — the model never writes SQL. The workspace (and user,
// for preferences) always comes from requireAuth() in the caller, never from
// the model's input.
import type Anthropic from "@anthropic-ai/sdk";
import db from "./db";
import { CATEGORY_KEYS, type CategoryKey, type Kind } from "@/types/expense";
import { MONTH_RE, addMonths, currentMonth } from "./months";
import { monthlyTotals as monthlyTotalsQuery } from "./queries";
import { getPlan } from "./plan-db";
import { getBudgets } from "./budgets";
import { listSubscriptions } from "./subscriptions-db";
import { getCashflow } from "./cashflow-db";
import { listGoals } from "./goals";
import { getNetWorth } from "./networth-db";
import { isoDate } from "./subscriptions";

export type ToolContext = { workspaceId: string; userId: string };

/** Bad tool input: returned to the model as an error result so it can retry. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export const MAX_LIST_ROWS = 50;
export const MAX_GROUP_ROWS = 25;
const MAX_RANGE_MONTHS = 60;

const round2 = (n: number) => Math.round(n * 100) / 100;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------- filters ----------

export type Filters = {
  from: string;
  to: string;
  kind: Kind;
  category: CategoryKey | null;
  groupName: string | null;
  tag: string | null;
  nameContains: string | null;
};

function optText(v: unknown, label: string, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new ToolInputError(`${label} must be a string`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) throw new ToolInputError(`${label} is too long`);
  return s;
}

function optMonth(v: unknown, label: string): string | null {
  const s = optText(v, label, 7);
  if (s === null) return null;
  if (!MONTH_RE.test(s)) throw new ToolInputError(`${label} must look like 2026-03`);
  return s;
}

/**
 * Validates the shared filter object. Defaults: the last 12 months up to the
 * current month, expenses only.
 */
export function parseFilters(raw: unknown, now = currentMonth()): Filters {
  const f = isObj(raw) ? raw : {};
  const to = optMonth(f.to_month, "to_month") ?? now;
  const from = optMonth(f.from_month, "from_month") ?? addMonths(to, -11);
  if (from > to) throw new ToolInputError("from_month is after to_month");
  if (from < addMonths(to, -(MAX_RANGE_MONTHS - 1))) throw new ToolInputError(`At most ${MAX_RANGE_MONTHS} months at a time`);
  const kind = f.kind === undefined || f.kind === null || f.kind === "" ? "expense" : f.kind;
  if (kind !== "expense" && kind !== "income") throw new ToolInputError("kind must be expense or income");
  const category = optText(f.category, "category", 30);
  if (category !== null && !(CATEGORY_KEYS as string[]).includes(category)) throw new ToolInputError(`Unknown category. Use one of: ${CATEGORY_KEYS.join(", ")}`);
  const tag = optText(f.tag, "tag", 40)?.replace(/^#+/, "").toLowerCase() || null;
  return {
    from, to, kind,
    category: category as CategoryKey | null,
    groupName: optText(f.group_name, "group_name", 60),
    tag,
    nameContains: optText(f.name_contains, "name_contains", 60),
  };
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** WHERE clause + args for LEDGER e (joined to CATEGORY_GROUP g), always workspace-scoped. */
function whereFor(ws: string, f: Filters): { sql: string; args: unknown[] } {
  const where = ["e.WORKSPACE_ID = ?", "e.DELETED_AT IS NULL", "e.KIND = ?", "e.MONTH >= ?", "e.MONTH <= ?"];
  const args: unknown[] = [ws, f.kind, f.from, f.to];
  if (f.category) { where.push("e.CATEGORY = ?"); args.push(f.category); }
  if (f.groupName) { where.push("g.NAME = ? COLLATE NOCASE"); args.push(f.groupName); }
  if (f.tag) { where.push("EXISTS (SELECT 1 FROM LEDGER_TAG t WHERE t.LEDGER_ID = e.ID AND t.TAG = ?)"); args.push(f.tag); }
  if (f.nameContains) { where.push("(e.NAME LIKE ? ESCAPE '\\' OR e.NOTES LIKE ? ESCAPE '\\')"); args.push(like(f.nameContains), like(f.nameContains)); }
  return { sql: where.join(" AND "), args };
}

const FROM = "FROM LEDGER e LEFT JOIN CATEGORY_GROUP g ON g.ID = e.GROUP_ID AND g.WORKSPACE_ID = e.WORKSPACE_ID AND g.DELETED_AT IS NULL";

/** /search link for the same filters (group by id, since that's what /search takes). */
async function searchLink(ws: string, f: Filters): Promise<string> {
  const q = new URLSearchParams({ kind: f.kind, from: f.from, to: f.to });
  if (f.category) q.set("category", f.category);
  if (f.tag) q.set("tag", f.tag);
  if (f.nameContains) q.set("q", f.nameContains);
  if (f.groupName) {
    const [rows] = await db.execute("SELECT ID FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL AND NAME = ? COLLATE NOCASE LIMIT 1", [ws, f.groupName]);
    const id = (rows as Array<{ ID: string }>)[0]?.ID;
    if (id) q.set("group", id);
  }
  return `/search?${q.toString()}`;
}

// ---------- tools ----------

export const SPENDING_DIMENSIONS = ["category", "group", "merchant", "tag", "month"] as const;
export type SpendingDimension = (typeof SPENDING_DIMENSIONS)[number];

// Fixed SQL fragments per dimension: the model only picks the key.
const DIMENSION_SQL: Record<SpendingDimension, { key: string; join: string }> = {
  category: { key: "e.CATEGORY", join: "" },
  group: { key: "COALESCE(g.NAME, '(no group)')", join: "" },
  merchant: { key: "e.NAME", join: "" },
  tag: { key: "lt.TAG", join: "JOIN LEDGER_TAG lt ON lt.LEDGER_ID = e.ID" },
  month: { key: "e.MONTH", join: "" },
};

export type SpendingBy = {
  by: SpendingDimension;
  filters: Filters;
  total: number;
  count: number;
  rows: Array<{ key: string; total: number; count: number }>;
  truncated: boolean;
  link: string;
};

export async function spendingBy(ws: string, byRaw: unknown, filtersRaw: unknown): Promise<SpendingBy> {
  if (!(SPENDING_DIMENSIONS as readonly unknown[]).includes(byRaw)) throw new ToolInputError(`by must be one of: ${SPENDING_DIMENSIONS.join(", ")}`);
  const by = byRaw as SpendingDimension;
  const f = parseFilters(filtersRaw);
  const { sql, args } = whereFor(ws, f);
  const dim = DIMENSION_SQL[by];
  const order = by === "month" ? "KEY" : "TOTAL DESC";
  const [rows] = await db.execute(
    `SELECT ${dim.key} AS KEY, CAST(SUM(e.AMOUNT) AS REAL) AS TOTAL, COUNT(*) AS N ${FROM} ${dim.join}
     WHERE ${sql} GROUP BY KEY ORDER BY ${order} LIMIT ${MAX_GROUP_ROWS + 1}`,
    args,
  );
  const [sumRows] = await db.execute(`SELECT CAST(COALESCE(SUM(e.AMOUNT), 0) AS REAL) AS TOTAL, COUNT(*) AS N ${FROM} WHERE ${sql}`, args);
  const list = rows as Array<{ KEY: string; TOTAL: number; N: number }>;
  const sum = (sumRows as Array<{ TOTAL: number; N: number }>)[0];
  return {
    by,
    filters: f,
    total: round2(sum.TOTAL),
    count: sum.N,
    rows: list.slice(0, MAX_GROUP_ROWS).map((r) => ({ key: r.KEY, total: round2(r.TOTAL), count: r.N })),
    truncated: list.length > MAX_GROUP_ROWS,
    link: await searchLink(ws, f),
  };
}

export const LIST_ORDERS = ["amount_desc", "amount_asc", "date_desc", "date_asc"] as const;
export type ListOrder = (typeof LIST_ORDERS)[number];

const ORDER_SQL: Record<ListOrder, string> = {
  amount_desc: "e.AMOUNT DESC, e.MONTH DESC",
  amount_asc: "e.AMOUNT ASC, e.MONTH DESC",
  date_desc: "e.MONTH DESC, COALESCE(e.DAY, 0) DESC, e.CREATED_AT DESC",
  date_asc: "e.MONTH ASC, COALESCE(e.DAY, 0) ASC, e.CREATED_AT ASC",
};

export type ListedRow = {
  id: string; month: string; day: number | null; name: string; kind: Kind; category: string;
  group: string | null; amount: number; tags: string | null; recurring: boolean; link: string;
};

export async function listRows(ws: string, filtersRaw: unknown, limitRaw: unknown, orderRaw: unknown): Promise<{ filters: Filters; order: ListOrder; rows: ListedRow[]; link: string }> {
  const f = parseFilters(filtersRaw);
  const limit = limitRaw === undefined || limitRaw === null ? 20 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1) throw new ToolInputError("limit must be a whole number from 1");
  const order = orderRaw === undefined || orderRaw === null ? "date_desc" : orderRaw;
  if (!(LIST_ORDERS as readonly unknown[]).includes(order)) throw new ToolInputError(`order must be one of: ${LIST_ORDERS.join(", ")}`);
  const { sql, args } = whereFor(ws, f);
  const [rows] = await db.execute(
    `SELECT e.ID, e.MONTH, e.DAY, e.NAME, e.KIND, e.CATEGORY, g.NAME AS GROUP_NAME, CAST(e.AMOUNT AS REAL) AS AMOUNT, e.TAGS, e.IS_RECURRING
     ${FROM} WHERE ${sql} ORDER BY ${ORDER_SQL[order as ListOrder]} LIMIT ?`,
    [...args, Math.min(limit, MAX_LIST_ROWS)],
  );
  return {
    filters: f,
    order: order as ListOrder,
    rows: (rows as Array<{ ID: string; MONTH: string; DAY: number | null; NAME: string; KIND: Kind; CATEGORY: string; GROUP_NAME: string | null; AMOUNT: number; TAGS: string | null; IS_RECURRING: number }>).map((r) => ({
      id: r.ID, month: r.MONTH, day: r.DAY, name: r.NAME, kind: r.KIND, category: r.CATEGORY, group: r.GROUP_NAME,
      amount: round2(r.AMOUNT), tags: r.TAGS, recurring: r.IS_RECURRING === 1, link: `/?month=${r.MONTH}#e-${r.ID}`,
    })),
    link: await searchLink(ws, f),
  };
}

export async function monthlyTotals(ws: string, fromRaw: unknown, toRaw: unknown, kindRaw: unknown): Promise<{ kind: Kind; from: string; to: string; months: Array<{ month: string; total: number }>; total: number }> {
  const f = parseFilters({ from_month: fromRaw, to_month: toRaw, kind: kindRaw });
  const rows = await monthlyTotalsQuery(ws, f.kind, f.from, f.to);
  const byMonth = new Map(rows.map((r) => [r.MONTH, round2(r.TOTAL)]));
  const months: Array<{ month: string; total: number }> = [];
  for (let m = f.from; m <= f.to; m = addMonths(m, 1)) months.push({ month: m, total: byMonth.get(m) ?? 0 });
  return { kind: f.kind, from: f.from, to: f.to, months, total: round2(months.reduce((s, m) => s + m.total, 0)) };
}

export async function budgetStatus(ws: string, monthRaw: unknown) {
  const month = optMonth(monthRaw, "month") ?? currentMonth();
  const [plan, budgets, spentRows] = await Promise.all([
    getPlan(ws, month),
    getBudgets(ws),
    db.execute(
      "SELECT CATEGORY, CAST(SUM(AMOUNT) AS REAL) AS TOTAL FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND KIND = 'expense' AND DELETED_AT IS NULL GROUP BY CATEGORY",
      [ws, month],
    ),
  ]);
  const spent = new Map((spentRows[0] as Array<{ CATEGORY: string; TOTAL: number }>).map((r) => [r.CATEGORY, round2(r.TOTAL)]));
  const totalSpent = round2([...spent.values()].reduce((s, v) => s + v, 0));
  return {
    month,
    plan: {
      hasPlan: plan.lines.length > 0,
      plannedIncome: round2(plan.plannedIncome),
      plannedSpending: round2(plan.plannedSpending),
      leftToPlan: round2(plan.leftToPlan),
      actualIncome: round2(plan.actualIncome),
      actualSpending: round2(plan.actualSpending),
      unplannedSpending: round2(plan.unplannedSpending),
      lines: plan.lines.slice(0, 40).map((l) => ({ label: l.LABEL, kind: l.KIND, category: l.CATEGORY, planned: round2(l.PLANNED), actual: round2(l.actual), remaining: round2(l.remaining) })),
      link: `/plan?month=${month}`,
    },
    budgets: {
      total: { budget: budgets.total, spent: totalSpent, left: round2(budgets.total - totalSpent) },
      categories: Object.entries(budgets.categories).map(([category, budget]) => ({
        category, budget: budget ?? 0, spent: spent.get(category) ?? 0, left: round2((budget ?? 0) - (spent.get(category) ?? 0)),
      })),
      link: "/settings",
    },
  };
}

export async function subscriptions(ws: string) {
  const subs = await listSubscriptions(ws, isoDate(new Date()));
  return {
    link: "/subscriptions",
    subscriptions: subs.slice(0, 60).map((s) => ({
      name: s.NAME, amount: s.AMOUNT, cadence: s.CADENCE, status: s.STATUS, monthly: round2(s.monthly), yearly: round2(s.yearly),
      previousAmount: s.previousAmount, priceChangedIn: s.changedIn, nextDue: s.nextDue, unused: s.unused,
      lastCharge: s.lastCharge,
    })),
  };
}

export async function cashflow(ws: string, userId: string) {
  const today = isoDate(new Date());
  const v = await getCashflow(ws, today, { userId });
  const p = v.projection;
  return {
    today,
    link: "/cashflow",
    balanceToday: v.balanceToday,
    balanceKnown: v.balanceToday !== null,
    buffer: v.buffer,
    dailyVariableSpend: round2(v.dailyVariable),
    safeToSpend: p ? round2(p.safeToSpend) : null,
    nextPayday: p?.nextPayday ? { date: p.nextPayday.date, label: p.nextPayday.label, amount: p.nextPayday.amount } : null,
    lowPoint: p ? { date: p.lowPoint.date, balance: round2(p.lowPoint.balance) } : null,
    upcomingBills: v.bills.filter((b) => b.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 15).map((b) => ({ date: b.date, label: b.label, amount: b.amount })),
  };
}

export async function goals(ws: string) {
  const list = await listGoals(ws);
  return {
    link: "/goals",
    goals: list.map((g) => ({
      name: g.NAME, target: g.TARGET_AMOUNT, targetMonth: g.TARGET_MONTH, saved: round2(g.saved), remaining: round2(g.remaining),
      pct: Math.round(g.pct), neededPerMonth: g.neededPerMonth === null ? null : round2(g.neededPerMonth),
      recentPerMonth: round2(g.recentPerMonth), projectedMonth: g.projectedMonth, status: g.status,
    })),
  };
}

export async function netWorth(ws: string) {
  const v = await getNetWorth(ws);
  return {
    link: "/networth",
    month: v.month,
    current: v.current,
    change: v.change,
    accounts: v.accounts.map((a) => ({ name: a.NAME, type: a.TYPE, balance: a.balance, asOf: a.asOf })),
  };
}

// ---------- tool definitions for the API ----------

const FILTERS_SCHEMA = {
  type: "object",
  description: "Optional filters. Months are YYYY-MM; the default range is the 12 months up to this month; kind defaults to expense.",
  properties: {
    from_month: { type: "string", description: "First month, YYYY-MM" },
    to_month: { type: "string", description: "Last month, YYYY-MM (inclusive)" },
    kind: { type: "string", enum: ["expense", "income"] },
    category: { type: "string", enum: CATEGORY_KEYS },
    group_name: { type: "string", description: "One of the workspace's group names" },
    tag: { type: "string", description: "Tag without #" },
    name_contains: { type: "string", description: "Text in the row name or notes (merchant)" },
  },
  additionalProperties: false,
} as const;

export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = [
  {
    name: "spending_by",
    description: "Totals of ledger rows grouped by one dimension (category, group, merchant, tag or month), largest first (months in order). Returns the overall total, per-key totals and counts, and a /search link for the same filters.",
    input_schema: {
      type: "object",
      properties: { by: { type: "string", enum: [...SPENDING_DIMENSIONS] }, filters: FILTERS_SCHEMA },
      required: ["by"],
      additionalProperties: false,
    },
  },
  {
    name: "list_rows",
    description: `Individual ledger rows matching the filters, each with a link to the row. limit 1–${MAX_LIST_ROWS} (default 20).`,
    input_schema: {
      type: "object",
      properties: {
        filters: FILTERS_SCHEMA,
        limit: { type: "integer", description: `1–${MAX_LIST_ROWS}` },
        order: { type: "string", enum: [...LIST_ORDERS] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "monthly_totals",
    description: "Total per month for a kind (expense or income), every month in the range including empty ones.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM" },
        to: { type: "string", description: "YYYY-MM" },
        kind: { type: "string", enum: ["expense", "income"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "budget_status",
    description: "The month's zero-based plan (planned vs actual per line, left to plan) and the category budgets with what was spent. Defaults to this month.",
    input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM" } }, additionalProperties: false },
  },
  {
    name: "subscriptions",
    description: "Tracked subscriptions with price, cadence, status, monthly/yearly cost, previous price and when it changed, next due date and an unused flag.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "cashflow",
    description: "Current balance (if the user recorded one), safe-to-spend until the next payday after keeping the user's buffer, next payday, projected low point and upcoming bills for the next 60 days.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "goals",
    description: "Savings goals with target, saved so far, remaining, needed per month, recent pace and status.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "net_worth",
    description: "Net worth this month (assets, debts, net), the change from last month and each account's latest balance.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export const TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.name);

/**
 * Runs one tool for the caller's workspace. Returns a JSON-serialisable
 * result; throws ToolInputError for bad arguments and Error for unknown tools.
 */
export async function runTool(ctx: ToolContext, name: string, input: unknown): Promise<unknown> {
  const i = isObj(input) ? input : {};
  const ws = ctx.workspaceId;
  switch (name) {
    case "spending_by": return spendingBy(ws, i.by, i.filters);
    case "list_rows": return listRows(ws, i.filters, i.limit, i.order);
    case "monthly_totals": return monthlyTotals(ws, i.from, i.to, i.kind);
    case "budget_status": return budgetStatus(ws, i.month);
    case "subscriptions": return subscriptions(ws);
    case "cashflow": return cashflow(ws, ctx.userId);
    case "goals": return goals(ws);
    case "net_worth": return netWorth(ws);
    default: throw new ToolInputError(`Unknown tool: ${name}`);
  }
}
