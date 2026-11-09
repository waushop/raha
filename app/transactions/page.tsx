import { connection } from "next/server";
import Link from "next/link";
import { Building2 } from "lucide-react";
import db from "@/lib/db";
import { currentContext } from "@/lib/auth";
import { getGroups } from "@/app/actions";
import { currentMonth, isValidMonth, monthLabel } from "@/lib/months";
import MonthNav from "@/components/MonthNav";
import TransactionFeed, { type FeedRow } from "@/components/TransactionFeed";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The bank's view of a month: every line sync brought in, newest day first.
// Lines stay out of the month view (which keeps the bills you plan) until
// "Add to month"; bills that matched a bank line show here as "In month".
export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const params = await searchParams;
  const month = isValidMonth(params.month) ? params.month : currentMonth();

  const [[rows], groups, [conn]] = await Promise.all([
    db.execute(
      `SELECT ID, KIND, CATEGORY, GROUP_ID, NAME, CAST(AMOUNT AS REAL) AS AMOUNT, DAY, NOTES, FEED_ONLY
       FROM LEDGER WHERE WORKSPACE_ID = ? AND MONTH = ? AND DELETED_AT IS NULL AND EXTERNAL_ID IS NOT NULL
       ORDER BY COALESCE(DAY, 0) DESC, CREATED_AT DESC`,
      [ws, month],
    ),
    getGroups(),
    db.execute("SELECT COUNT(*) AS N FROM BANK_CONNECTION WHERE WORKSPACE_ID = ? AND STATUS = 'active'", [ws]),
  ]);
  const lines = rows as FeedRow[];
  const connected = ((conn as Array<{ N: number }>)[0]?.N ?? 0) > 0;
  const out = lines.filter((r) => r.KIND === "expense").reduce((s, r) => s + r.AMOUNT, 0);
  const into = lines.filter((r) => r.KIND === "income").reduce((s, r) => s + r.AMOUNT, 0);
  const moved = lines.filter((r) => r.KIND === "transfer").reduce((s, r) => s + Math.abs(r.AMOUNT), 0);

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <Link href="/" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Month</Link>
              <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
                Transactions
              </h1>
            </div>
            <MonthNav month={month} path="/transactions" />
          </div>
          {lines.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="surface rounded-xl px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[#5a6380]">Out</p>
                <p className="text-sm font-semibold text-white tabular-nums">{fmt(out)} €</p>
              </div>
              <div className="surface rounded-xl px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[#5a6380]">In</p>
                <p className="text-sm font-semibold text-emerald-400 tabular-nums">{fmt(into)} €</p>
              </div>
              <div className="surface rounded-xl px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[#5a6380]">Transfers</p>
                <p className="text-sm font-semibold text-[#9ca3c0] tabular-nums">{fmt(moved)} €</p>
              </div>
            </div>
          )}
        </div>

        <div className="animate-fade-up" style={{ animationDelay: "0.05s" }}>
          {lines.length === 0 ? (
            <div className="card rounded-2xl p-8 text-center">
              <Building2 size={28} strokeWidth={1.5} className="mx-auto text-[#5a6380] mb-2" />
              <p className="text-sm text-[#9ca3c0]">No bank transactions in {monthLabel(month)}</p>
              <p className="text-xs text-[#5a6380] mt-1">
                {connected ? "Sync runs twice a day; new lines show up here." : <>Connect your bank on <Link href="/bank" className="text-pink-400 hover:underline">Bank sync</Link> and they flow in here.</>}
              </p>
            </div>
          ) : (
            <TransactionFeed rows={lines} groups={groups} />
          )}
        </div>

        <p className="text-[10px] text-[#5a6380] px-1">
          These count in the dashboard and analytics. The month view keeps your own entries and bills; a bill that matched a bank line shows as paid there. Transfers (between your own accounts, a loan payout) count nowhere: mark one with Transfer and later lines from the same sender follow.
        </p>
      </div>
    </main>
  );
}
