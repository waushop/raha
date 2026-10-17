import { connection } from "next/server";
import PushSettings from "@/components/PushSettings";
import HouseholdSettings from "@/components/HouseholdSettings";
import { listMembers, listWorkspacesFor } from "@/lib/household";
import Link from "next/link";
import db from "@/lib/db";
import { currentContext, listUsers } from "@/lib/auth";
import UserManager from "@/components/UserManager";
import LockList from "@/components/LockList";
import TwoFactorSettings from "@/components/TwoFactorSettings";
import { getUser } from "@/lib/auth";
import { listDevices } from "@/lib/twofa";
import { mailConfigured } from "@/lib/mailer";
import { listLocks } from "@/lib/ratelimit";
import pkg from "@/package.json";
import { getBudgets, DEFAULT_CATEGORY_BUDGETS, DEFAULT_TOTAL_BUDGET } from "@/lib/budgets";
import { CATEGORIES, CATEGORY_KEYS } from "@/types/expense";
import BackupRestore from "@/components/BackupRestore";
import ChangePin from "@/components/ChangePin";
import BackfillMonth from "@/components/BackfillMonth";
import BudgetEditor from "@/components/BudgetEditor";
import { listMonths } from "@/app/actions";
import CategoryIcon from "@/components/CategoryIcon";
import { Database, Layers, Lock, Mail, Maximize2, Upload, Users } from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function SettingsPage() {
  await connection();
  const ctx = await currentContext();
  const ws = ctx.workspaceId;
  const [existingMonths, budgets, users, me, devices] = await Promise.all([listMonths(), getBudgets(ws), listUsers(), getUser(ctx.userId), listDevices(ctx.userId)]);
  const [myWs, members] = await Promise.all([listWorkspacesFor(ctx.userId), listMembers(ws)]);
  // Stats
  const [statsRows] = await db.execute(
    `SELECT COUNT(*) AS TOTAL_EXPENSES,
            COUNT(DISTINCT MONTH) AS TOTAL_MONTHS,
            CAST(SUM(AMOUNT) AS REAL) AS TOTAL_AMOUNT,
            MIN(MONTH) AS FIRST_MONTH,
            MAX(MONTH) AS LAST_MONTH
     FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL`, [ws]
  );
  const stats = (statsRows as Array<{
    TOTAL_EXPENSES: number;
    TOTAL_MONTHS: number;
    TOTAL_AMOUNT: number | null;
    FIRST_MONTH: string | null;
    LAST_MONTH: string | null;
  }>)[0];

  const [recurringCount] = await db.execute(
    "SELECT COUNT(DISTINCT NAME) AS CNT FROM LEDGER WHERE WORKSPACE_ID = ? AND IS_RECURRING = 1 AND KIND = 'expense' AND DELETED_AT IS NULL", [ws]
  );
  const recurring = (recurringCount as Array<{ CNT: number }>)[0]?.CNT ?? 0;

  const [deletedCount] = await db.execute(
    "SELECT COUNT(*) AS CNT FROM LEDGER WHERE WORKSPACE_ID = ? AND DELETED_AT IS NOT NULL", [ws]
  );
  const deleted = (deletedCount as Array<{ CNT: number }>)[0]?.CNT ?? 0;

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1
            className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1"
            style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}
          >
            Settings
          </h1>
        </div>

        {/* Database stats */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Database size={14} className="text-purple-400" />
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
              <p className="text-base sm:text-lg font-bold text-white font-mono tabular-nums whitespace-nowrap">{fmt(stats.TOTAL_AMOUNT ?? 0)} €</p>
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
            <Layers size={14} className="text-amber-400" />
            Budget targets
          </h2>
          <BudgetEditor
            initialTotal={budgets.total}
            initialCategories={budgets.categories}
            defaultTotal={DEFAULT_TOTAL_BUDGET}
            defaultCategories={DEFAULT_CATEGORY_BUDGETS}
          />
        </div>

        {/* Users (admins) / Profile (everyone else) */}
        {ctx.isAdmin ? (
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.085s" }}>
          <h2 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
            <Users size={14} className="text-teal-400" />
            Users
          </h2>
          <p className="text-xs text-[#5a6380] mb-4">Each user has a private ledger and their own PIN. Signed in as <span className="text-white/80">{ctx.name}</span>.</p>
          <UserManager users={users} currentUserId={ctx.userId} isAdmin={ctx.isAdmin} />
          {ctx.isAdmin && (
            <div className="mt-4 pt-4 border-t border-white/[0.06]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380] mb-2">Sign-in locks</p>
              <p className="text-[10px] text-[#5a6380] mb-2">5 wrong PINs lock a device for a minute; a second time in the same hour locks it for 24 hours. An hour of quiet resets the count. 20 failures from anywhere within 15 minutes pause sign-in for everyone for 15 minutes.</p>
              <LockList locks={listLocks()} />
            </div>
          )}
        </div>
        ) : (
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.085s" }}>
          <h2 className="text-sm font-bold text-white mb-1">Profile</h2>
          <p className="text-xs text-[#5a6380] mb-3">Your ledger is private to you. Only an admin can add or remove users.</p>
          <UserManager users={users.filter((u) => u.ID === ctx.userId)} currentUserId={ctx.userId} isAdmin={false} />
        </div>
        )}

        {/* Email check on new devices */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.088s" }}>
          <h2 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
            <Mail size={14} className="text-purple-400" />
            Email check
          </h2>
          <p className="text-xs text-[#5a6380] mb-4">After your PIN, a new browser gets a six-digit code by email. Remembered devices skip it for 30 days.</p>
          <TwoFactorSettings email={me?.EMAIL ?? null} verified={!!me?.EMAIL_VERIFIED_AT} require2fa={me?.REQUIRE_2FA === 1} devices={devices} mailConfigured={mailConfigured()} />
        </div>

        {/* Security */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.09s" }}>
          <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Lock size={14} className="text-pink-400" />
            Change PIN
          </h2>
          <ChangePin />
        </div>

        {/* Backfill */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.095s" }}>
          <h2 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
            <Maximize2 size={14} className="text-purple-400" />
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
            <Upload size={14} className="text-blue-400" />
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
                  <CategoryIcon category={cat} size={22} className="block mx-auto mb-1 text-[#9ca3c0]" />
                  <span className={`text-xs font-semibold ${"text-white/70"}`}>{meta.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Household */}
        <div className="animate-fade-up" style={{ animationDelay: "0.13s" }}>
          <HouseholdSettings
            current={{ id: ws, name: ctx.workspaceName, kind: ctx.workspaceKind }}
            meId={ctx.userId}
            workspaces={myWs}
            members={members}
            others={users.filter((u) => u.ID !== ctx.userId).map((u) => ({ ID: u.ID, NAME: u.NAME }))}
          />
        </div>

        {/* Push notifications */}
        <div className="animate-fade-up" style={{ animationDelay: "0.135s" }}>
          <PushSettings />
        </div>

        {/* App info */}
        <div className="card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: "0.14s" }}>
          <h2 className="text-sm font-bold text-white mb-3">Application</h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-[#5a6380]">Version</span><span className="text-white/60">{pkg.version}</span></div>
            <div className="flex justify-between"><span className="text-[#5a6380]">Framework</span><span className="text-white/60">Next.js 16</span></div>
            <div className="flex justify-between"><span className="text-[#5a6380]">Database</span><span className="text-white/60">SQLite</span></div>
            <div className="flex justify-between"><span className="text-[#5a6380]">Styling</span><span className="text-white/60">Tailwind CSS v4</span></div>
          </div>
        </div>
      </div>
    </main>
  );
}
