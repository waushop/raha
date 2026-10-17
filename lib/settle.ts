// Household settle-up: who paid what this month, what an equal share is,
// and the fewest transfers that square everyone up. Pure.
export type Member = { ID: string; NAME: string };
export type Paid = { userId: string | null; amount: number };

export type SettleRow = { userId: string; name: string; paid: number; share: number; net: number };
export type Transfer = { from: string; to: string; amount: number };

export type Settlement = {
  members: SettleRow[];
  transfers: Transfer[];
  total: number;
  /** Spending with no payer recorded; left out of the split. */
  unassigned: number;
};

const round = (n: number) => Math.round(n * 100) / 100;

export function settleUp(members: Member[], paid: Paid[]): Settlement {
  const byUser = new Map<string, number>();
  let unassigned = 0;
  for (const p of paid) {
    if (p.userId && members.some((m) => m.ID === p.userId)) byUser.set(p.userId, (byUser.get(p.userId) ?? 0) + p.amount);
    else unassigned += p.amount;
  }
  const total = [...byUser.values()].reduce((s, v) => s + v, 0);
  const share = members.length ? total / members.length : 0;
  const rows: SettleRow[] = members.map((m) => {
    const got = byUser.get(m.ID) ?? 0;
    return { userId: m.ID, name: m.NAME, paid: round(got), share: round(share), net: round(got - share) };
  });
  // Greedy: biggest debtor pays biggest creditor until everyone is within a cent.
  const debtors = rows.filter((r) => r.net < -0.005).map((r) => ({ id: r.userId, left: -r.net })).sort((a, b) => b.left - a.left);
  const creditors = rows.filter((r) => r.net > 0.005).map((r) => ({ id: r.userId, left: r.net })).sort((a, b) => b.left - a.left);
  const transfers: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = round(Math.min(debtors[i].left, creditors[j].left));
    if (amount > 0) transfers.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].left = round(debtors[i].left - amount);
    creditors[j].left = round(creditors[j].left - amount);
    if (debtors[i].left <= 0.005) i++;
    if (creditors[j].left <= 0.005) j++;
  }
  return { members: rows, transfers, total: round(total), unassigned: round(unassigned) };
}
