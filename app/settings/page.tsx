import { connection } from "next/server";
import Link from "next/link";
import db from "@/lib/db";
import { getBudgets, DEFAULT_CATEGORY_BUDGETS, DEFAULT_TOTAL_BUDGET } from "@/lib/budgets";
import { CATEGORIES, CATEGORY_KEYS } from "@/types/expense";
import BackupRestore from "@/components/BackupRestore";
import ChangePin from "@/components/ChangePin";
import BackfillMonth from "@/components/BackfillMonth";
import BudgetEditor from "@/components/BudgetEditor";
import { listMonths } from "@/app/actions";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function SettingsPage() {
  await connection();
  const existingMonths = await listMonths();
  const budgets = await getBudgets();
  // Stats
  const [statsRows] = await db.execute(
    `SELECT COUNT(*) AS TOTAL_EXPENSES,
            COUNT(DISTINCT MONTH) AS TOTAL_MONTHS,
            CAST(SUM(AMOUNT) AS REAL) AS TOTAL_AMOUNT,
            MIN(MONTH) AS FIRST_MONTH,
            MAX(MONTH) AS LAST_MONTH
     FROM EXPENSE WHERE DELETED_AT IS NULL`
  );
  const stats = (statsRows as Array<{
    TOTAL_EXPENSES: number;
    TOTAL_MONTHS: number;
    TOTAL_AMOUNT: number | null;
    FIRST_MONTH: string | null;
    LAST_MONTH: string | null;
  }>)[0];

  const [recurringCount] = await db.execute(
    "SELECT COUNT(DISTINCT NAME) AS CNT FROM EXPENSE WHERE IS_RECURRING = 1 AND DELETED_AT IS NULL"
  );
  const recurring = (recurringCount as Array<{ CNT: number }>)[0]?.CNT ?? 0;

  const [deletedCount] = await db.execute(
    "SELECT COUNT(*) AS CNT FROM EXPENSE WHERE DELETED_AT IS NOT NULL"
  );
  const deleted = (deletedCount as Array<{ CNT: number }>)[0]?.CNT ?? 0;

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 sm:py-10 pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1
            className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1"
            style={{ fontFamily: "'Caveat', cursive", fontWeight: 700 }}
          >
            Settings
          </h1>
        </div>

        {/* Database stats */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
              <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
            Database
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-white/[0.03] rounded-xl p-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Expenses</p>
              <p className="text-lg font-bold text-white tabular-nums">{stats.TOTAL_EXPENSES}</p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Months</p>
              <p className="text-lg font-bold text-white tabular-nums">{stats.TOTAL_MONTHS}</p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Total</p>
              <p className="text-lg font-bold text-white font-mono tabular-nums">{fmt(stats.TOTAL_AMOUNT ?? 0)} €</p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Recurring</p>
              <p className="text-lg font-bold text-teal-400 tabular-nums">{recurring}</p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Deleted</p>
              <p className="text-lg font-bold text-red-400/60 tabular-nums">{deleted}</p>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1">Period</p>
              <p className="text-xs font-bold text-white">{stats.FIRST_MONTH} – {stats.LAST_MONTH}</p>
            </div>
          </div>
        </div>

        {/* Budget targets */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.08s" }}>
          <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            Budget targets
          </h2>
          <BudgetEditor
            initialTotal={budgets.total}
            initialCategories={budgets.categories}
            defaultTotal={DEFAULT_TOTAL_BUDGET}
            defaultCategories={DEFAULT_CATEGORY_BUDGETS}
          />
        </div>

        {/* Security */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.09s" }}>
          <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-pink-400">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            Change PIN
          </h2>
          <ChangePin />
        </div>

        {/* Backfill */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.095s" }}>
          <h2 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
              <path d="M16 3h5v5" /><path d="M21 3l-7 7" /><path d="M8 21H3v-5" /><path d="M3 21l7-7" />
            </svg>
            Copy month
          </h2>
          <p className="text-xs text-[#5a6380] mb-4">
            Clone every expense from one month into one or more other months. Skips entries that already exist.
          </p>
          <BackfillMonth existingMonths={existingMonths} />
        </div>

        {/* Backup & Restore */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.1s" }}>
          <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Backup
          </h2>
          <BackupRestore />
        </div>

        {/* Categories */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.12s" }}>
          <h2 className="text-sm font-bold text-white mb-4">Categories</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CATEGORY_KEYS.map(cat => {
              const meta = CATEGORIES[cat];
              return (
                <div key={cat} className="bg-white/[0.03] rounded-xl p-3 text-center">
                  <span className="text-xl block mb-1">{meta.icon}</span>
                  <span className={`text-xs font-semibold ${"text-white/70"}`}>{meta.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* App info */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.14s" }}>
          <h2 className="text-sm font-bold text-white mb-3">Application</h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-[#5a6380]">Version</span><span className="text-white/60">2.0</span></div>
            <div className="flex justify-between"><span className="text-[#5a6380]">Framework</span><span className="text-white/60">Next.js 16</span></div>
            <div className="flex justify-between"><span className="text-[#5a6380]">Database</span><span className="text-white/60">SQLite</span></div>
            <div className="flex justify-between"><span className="text-[#5a6380]">Styling</span><span className="text-white/60">Tailwind CSS v4</span></div>
          </div>
        </div>
      </div>
    </main>
  );
}
