// Net worth from manually recorded account balances: one snapshot per
// account per month, carried forward when a month has no entry. Debts are
// stored as positive balances and subtracted. Pure; database access in
// lib/networth-db.ts.

export const ACCOUNT_TYPES = ["cash", "savings", "investment", "property", "debt"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  cash: "Cash", savings: "Savings", investment: "Investment", property: "Property", debt: "Debt",
};

export type Account = { ID: string; NAME: string; TYPE: AccountType; SORT_ORDER: number };
export type Snapshot = { ACCOUNT_ID: string; MONTH: string; BALANCE: number };

export type NetWorthPoint = { month: string; assets: number; debts: number; net: number };

const round = (n: number) => Math.round(n * 100) / 100;

/** Snapshots grouped per account and sorted by month ascending. */
function byAccount(snapshots: Snapshot[]): Map<string, Snapshot[]> {
  const map = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    if (!map.has(s.ACCOUNT_ID)) map.set(s.ACCOUNT_ID, []);
    map.get(s.ACCOUNT_ID)!.push(s);
  }
  for (const list of map.values()) list.sort((a, b) => a.MONTH.localeCompare(b.MONTH));
  return map;
}

/** The newest snapshot on or before `month` (any month when omitted), or null. */
function balanceAt(list: Snapshot[] | undefined, month?: string): number | null {
  if (!list || list.length === 0) return null;
  let found: number | null = null;
  for (const s of list) {
    if (month !== undefined && s.MONTH > month) break;
    found = s.BALANCE;
  }
  return found;
}

/**
 * Assets, debts and net for each month in `months` (ascending YYYY-MM).
 * A month without a snapshot for an account uses that account's last known
 * balance; accounts with no earlier snapshot contribute nothing yet.
 */
export function netWorthSeries(accounts: Account[], snapshots: Snapshot[], months: string[]): NetWorthPoint[] {
  const groups = byAccount(snapshots);
  return months.map((month) => {
    let assets = 0;
    let debts = 0;
    for (const a of accounts) {
      const b = balanceAt(groups.get(a.ID), month);
      if (b === null) continue;
      if (a.TYPE === "debt") debts += b;
      else assets += b;
    }
    return { month, assets: round(assets), debts: round(debts), net: round(assets - debts) };
  });
}

/** Last known balance per account id (accounts without snapshots are omitted). */
export function latestBalances(snapshots: Snapshot[]): Map<string, { month: string; balance: number }> {
  const out = new Map<string, { month: string; balance: number }>();
  for (const [id, list] of byAccount(snapshots)) {
    const last = list[list.length - 1];
    out.set(id, { month: last.MONTH, balance: last.BALANCE });
  }
  return out;
}

/** Net change between the last two points of a series (null with fewer than two). */
export function monthlyChange(series: NetWorthPoint[]): { amount: number; pct: number | null } | null {
  if (series.length < 2) return null;
  const prev = series[series.length - 2];
  const last = series[series.length - 1];
  const amount = round(last.net - prev.net);
  const pct = prev.net !== 0 ? round((amount / Math.abs(prev.net)) * 100) : null;
  return { amount, pct };
}
