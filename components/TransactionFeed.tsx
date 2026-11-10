"use client";

import { useTransition } from "react";
import { ArrowLeftRight, CircleCheck, Link2, Plus, Undo2 } from "lucide-react";
import CategoryIcon from "./CategoryIcon";
import { useToast } from "./Toast";
import { useDialog } from "./Dialog";
import { CATEGORIES, CATEGORY_KEYS, type ExpenseGroup, type LedgerKind } from "@/types/expense";
import { bulkUpdateExpenses } from "@/app/actions";
import { addToMonth, matchBill, setTransfer, unmatch } from "@/app/transactions/actions";

export type FeedRow = {
  ID: string;
  KIND: LedgerKind;
  /** Signed for transfers (negative = money left). */
  CATEGORY: string;
  GROUP_ID: string | null;
  NAME: string;
  AMOUNT: number;
  DAY: number | null;
  NOTES: string | null;
  FEED_ONLY: number;
  /** Set when the line was folded into a bill ("Match bill"). */
  BILL_NAME: string | null;
};

/** A month-view bill still waiting for money; AMOUNT is what is left to pay. */
export type OpenBill = { ID: string; KIND: "expense" | "income"; NAME: string; AMOUNT: number };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const selectClass = "bg-white/[0.03] border border-white/[0.06] rounded-lg px-1.5 py-1 text-[11px] text-[#9ca3c0] hover:text-white focus:outline-none focus:border-pink-500/40 max-w-[9rem] disabled:opacity-50";

export default function TransactionFeed({ rows, groups, bills }: { rows: FeedRow[]; groups: ExpenseGroup[]; bills: OpenBill[] }) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const dialog = useDialog();

  async function pay(r: FeedRow, billId: string) {
    const bill = bills.find((b) => b.ID === billId);
    if (!bill) return;
    const ok = await dialog.confirm({
      title: `Match to ${bill.NAME}?`,
      message: r.AMOUNT >= bill.AMOUNT * 0.75
        ? `${bill.NAME} is paid with the bank amount (${fmt(r.AMOUNT)} €; ${fmt(bill.AMOUNT)} € was left) and this line folds into it. Next month ${r.NAME} pays ${bill.NAME} by itself.`
        : `This pays ${fmt(r.AMOUNT)} € of the ${fmt(bill.AMOUNT)} € left on ${bill.NAME}; match the other parts too. Next month ${r.NAME} pays ${bill.NAME} by itself.`,
      confirmLabel: "Match",
    });
    if (!ok) return;
    navigator.vibrate?.(10);
    startTransition(async () => {
      const res = await matchBill(r.ID, billId);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(`${bill.NAME} paid`);
    });
  }

  // Rows arrive newest day first; keep that order while bucketing by day.
  const days: Array<{ day: number | null; rows: FeedRow[] }> = [];
  for (const r of rows) {
    const last = days.at(-1);
    if (last && last.day === r.DAY) last.rows.push(r);
    else days.push({ day: r.DAY, rows: [r] });
  }

  function move(r: FeedRow) {
    navigator.vibrate?.(10);
    startTransition(async () => {
      const res = await addToMonth(r.ID);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(`${r.NAME} added to the month`);
    });
  }

  function undo(r: FeedRow) {
    startTransition(async () => {
      const res = await unmatch(r.ID);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(`${r.NAME} is back in the feed`);
    });
  }

  function transfer(r: FeedRow, on: boolean) {
    navigator.vibrate?.(10);
    startTransition(async () => {
      const res = await setTransfer(r.ID, on);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(on ? `${r.NAME}: transfer, not counted` : `${r.NAME} counts again`);
    });
  }

  // Corrections here teach the categoriser for the next sync.
  function patch(r: FeedRow, change: { category?: string; groupId?: string | null }) {
    navigator.vibrate?.(10);
    startTransition(async () => {
      const res = await bulkUpdateExpenses([r.ID], change);
      if (!res.ok) toast.showError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      {days.map(({ day, rows: dayRows }) => {
        const spent = dayRows.filter((r) => r.KIND === "expense").reduce((s, r) => s + r.AMOUNT, 0);
        return (
          <section key={day ?? "none"} className="card rounded-2xl overflow-hidden">
            <header className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5a6380]">{day ? `Day ${day}` : "No date"}</span>
              {spent > 0 && <span className="text-[11px] text-[#9ca3c0] tabular-nums">−{fmt(spent)} €</span>}
            </header>
            <ul className="divide-y divide-white/[0.04]">
              {dayRows.map((r) => (
                <li key={r.ID} className="px-4 py-3 flex items-start gap-3">
                  <CategoryIcon category={r.CATEGORY} size={16} className="text-[#9ca3c0] mt-0.5" title={CATEGORIES[r.CATEGORY as keyof typeof CATEGORIES]?.label} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-white/90 truncate">{r.NAME}</span>
                      <span className={`text-sm font-semibold tabular-nums shrink-0 ${r.KIND === "income" ? "text-emerald-400" : r.KIND === "transfer" ? "text-[#5a6380] line-through decoration-white/20" : "text-white"}`}>
                        {r.KIND === "income" || (r.KIND === "transfer" && r.AMOUNT > 0) ? "+" : "−"}{fmt(Math.abs(r.AMOUNT))} €
                      </span>
                    </div>
                    {r.NOTES && <p className="text-[10px] text-[#5a6380] mt-0.5 truncate">{r.NOTES.replace(/^Bank:\s*/, "")}</p>}
                    {r.BILL_NAME ? (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400/90"><CircleCheck size={12} /> Pays {r.BILL_NAME}</span>
                        <span className="flex-1" />
                        <button
                          onClick={() => undo(r)}
                          disabled={isPending}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 transition-colors btn-press disabled:opacity-50"
                        >
                          <Undo2 size={12} /> Unmatch
                        </button>
                      </div>
                    ) : r.KIND === "transfer" ? (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#9ca3c0]"><ArrowLeftRight size={12} /> Transfer · not counted</span>
                        <span className="flex-1" />
                        <button
                          onClick={() => transfer(r, false)}
                          disabled={isPending}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 transition-colors btn-press disabled:opacity-50"
                        >
                          <Undo2 size={12} /> Count it
                        </button>
                      </div>
                    ) : (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <select
                        aria-label="Category"
                        value={r.CATEGORY}
                        disabled={isPending}
                        onChange={(e) => patch(r, { category: e.target.value })}
                        className={selectClass}
                      >
                        {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
                      </select>
                      <select
                        aria-label="Group"
                        value={r.GROUP_ID ?? ""}
                        disabled={isPending}
                        onChange={(e) => patch(r, { groupId: e.target.value || null })}
                        className={selectClass}
                      >
                        <option value="">No group</option>
                        {groups.map((g) => <option key={g.ID} value={g.ID}>{g.NAME}</option>)}
                      </select>
                      {r.FEED_ONLY === 1 && bills.some((b) => b.KIND === r.KIND) && (
                        <label className="inline-flex items-center gap-1 text-[11px] text-[#5a6380]">
                          <Link2 size={12} aria-hidden />
                          <select
                            aria-label="Match to bill"
                            value=""
                            disabled={isPending}
                            onChange={(e) => { if (e.target.value) void pay(r, e.target.value); }}
                            className={selectClass}
                          >
                            <option value="">Match bill…</option>
                            {bills.filter((b) => b.KIND === r.KIND)
                              .sort((a, b) => Math.abs(a.AMOUNT - r.AMOUNT) - Math.abs(b.AMOUNT - r.AMOUNT))
                              .map((b) => <option key={b.ID} value={b.ID}>{b.NAME} · {fmt(b.AMOUNT)} € left</option>)}
                          </select>
                        </label>
                      )}
                      <span className="flex-1" />
                      {r.FEED_ONLY === 1 && (
                        <button
                          onClick={() => transfer(r, true)}
                          disabled={isPending}
                          title="Money moved between your own accounts, or a loan payout: not income or spending"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 transition-colors btn-press disabled:opacity-50"
                        >
                          <ArrowLeftRight size={12} /> Transfer
                        </button>
                      )}
                      {r.FEED_ONLY ? (
                        <button
                          onClick={() => move(r)}
                          disabled={isPending}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2 py-1 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 transition-colors btn-press disabled:opacity-50"
                        >
                          <Plus size={12} /> Add to month
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400/90" title="This line is in the month view">
                          <CircleCheck size={12} /> In month
                        </span>
                      )}
                    </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
