// Database side of net worth: accounts, their monthly snapshots and the
// assembled 24-month series for /networth and the dashboard card.
import db from "./db";
import { addMonths, currentMonth } from "./months";
import { latestBalances, monthlyChange, netWorthSeries, type Account, type NetWorthPoint, type Snapshot } from "./networth";

export const HISTORY_MONTHS = 24;

export async function listAccounts(ws: string): Promise<Account[]> {
  const [rows] = await db.execute(
    "SELECT ID, NAME, TYPE, SORT_ORDER FROM ACCOUNT WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL ORDER BY SORT_ORDER, CREATED_AT, NAME", [ws],
  );
  return rows as Account[];
}

/** Every snapshot of a live account, plus the newest one before the window so carry-forward starts right. */
export async function listSnapshots(ws: string, from: string): Promise<Snapshot[]> {
  const [rows] = await db.execute(
    `SELECT s.ACCOUNT_ID, s.MONTH, CAST(s.BALANCE AS REAL) AS BALANCE
     FROM ACCOUNT_SNAPSHOT s JOIN ACCOUNT a ON a.ID = s.ACCOUNT_ID AND a.DELETED_AT IS NULL
     WHERE s.WORKSPACE_ID = ? AND (s.MONTH >= ? OR s.MONTH = (
       SELECT MAX(p.MONTH) FROM ACCOUNT_SNAPSHOT p WHERE p.ACCOUNT_ID = s.ACCOUNT_ID AND p.MONTH < ?))
     ORDER BY s.ACCOUNT_ID, s.MONTH`,
    [ws, from, from],
  );
  return rows as Snapshot[];
}

export type AccountView = Account & { balance: number | null; asOf: string | null };

export type NetWorthView = {
  month: string;
  accounts: AccountView[];
  series: NetWorthPoint[];
  current: NetWorthPoint;
  change: { amount: number; pct: number | null } | null;
};

export async function getNetWorth(ws: string, month = currentMonth()): Promise<NetWorthView> {
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(month, i - (HISTORY_MONTHS - 1)));
  const [accounts, snapshots] = await Promise.all([listAccounts(ws), listSnapshots(ws, months[0])]);
  const series = netWorthSeries(accounts, snapshots, months);
  const latest = latestBalances(snapshots);
  return {
    month,
    accounts: accounts.map((a) => {
      const l = latest.get(a.ID);
      return { ...a, balance: l?.balance ?? null, asOf: l?.month ?? null };
    }),
    series,
    current: series[series.length - 1],
    change: monthlyChange(series),
  };
}
