import { connection } from "next/server";
import { pageInfo, parsePage } from "@/lib/pagination";
import Pagination, { pageHref } from "@/components/Pagination";
import db from "@/lib/db";
import { currentContext } from "@/lib/auth";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES } from "@/types/expense";
import Link from "next/link";
import RestoreButton from "@/components/RestoreButton";
import CategoryIcon from "@/components/CategoryIcon";
import type { AuditAction, AuditSnapshot } from "@/lib/ledger";
import { Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr.replace(" ", "T") + (dateStr.includes("Z") ? "" : "Z")).getTime();
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Event = {
  key: string;
  id: string;
  action: AuditAction;
  name: string;
  category: CategoryKey;
  amount: number;
  month: string;
  time: string;
  changes: string[];
  isDeleted: boolean;
};

// Fields worth describing when a row changes, in display order.
const DIFF_FIELDS: Array<[keyof AuditSnapshot & string, string, (v: unknown) => string]> = [
  ["NAME", "name", String],
  ["AMOUNT", "amount", (v) => `${fmt(Number(v))} €`],
  ["CATEGORY", "category", (v) => CATEGORIES[v as CategoryKey]?.label ?? String(v)],
  ["MONTH", "month", String],
  ["DAY", "day", (v) => (v == null ? "—" : String(v))],
  ["IS_RECURRING", "recurring", (v) => (Number(v) ? "yes" : "no")],
  ["NOTES", "notes", (v) => (v ? String(v) : "—")],
  ["TAGS", "tags", (v) => (v ? String(v) : "—")],
  ["GROUP_ID", "group", (v) => (v ? "changed" : "none")],
];

function describeChanges(before: AuditSnapshot | null, after: AuditSnapshot | null): string[] {
  if (!before || !after) return [];
  const out: string[] = [];
  for (const [key, label, show] of DIFF_FIELDS) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
      out.push(key === "GROUP_ID" ? "group changed" : `${label}: ${show(before[key])} → ${show(after[key])}`);
    }
  }
  return out;
}

const PAGE_SIZE = 50;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const params = await searchParams;
  const [countRows] = await db.execute(
    "SELECT COUNT(*) AS N FROM LEDGER_AUDIT a JOIN LEDGER e ON e.ID = a.LEDGER_ID WHERE e.WORKSPACE_ID = ?", [ws],
  );
  const info = pageInfo((countRows as Array<{ N: number }>)[0]?.N ?? 0, parsePage(params.page), PAGE_SIZE);

  // Real history from the audit table; databases from before it existed fall
  // back to a timeline derived from CREATED_AT / UPDATED_AT / DELETED_AT.
  const [auditRows] = await db.execute(
    `SELECT a.ID, a.LEDGER_ID, a.ACTION, a.BEFORE_JSON, a.AFTER_JSON, a.AT, (e.DELETED_AT IS NOT NULL) AS IS_DELETED
     FROM LEDGER_AUDIT a JOIN LEDGER e ON e.ID = a.LEDGER_ID
     WHERE e.WORKSPACE_ID = ?
     ORDER BY a.AT DESC, a.ROWID DESC LIMIT ? OFFSET ?`,
    [ws, PAGE_SIZE, info.offset],
  );
  let events: Event[] = (auditRows as Array<{ ID: string; LEDGER_ID: string; ACTION: AuditAction; BEFORE_JSON: string | null; AFTER_JSON: string | null; AT: string; IS_DELETED: number }>).map((r) => {
    const before = r.BEFORE_JSON ? (JSON.parse(r.BEFORE_JSON) as AuditSnapshot) : null;
    const after = r.AFTER_JSON ? (JSON.parse(r.AFTER_JSON) as AuditSnapshot) : null;
    const snap = after ?? before ?? {};
    return {
      key: r.ID,
      id: r.LEDGER_ID,
      action: r.ACTION,
      name: String(snap.NAME ?? "?"),
      category: (snap.CATEGORY as CategoryKey) ?? "other",
      amount: Number(snap.AMOUNT ?? 0),
      month: String(snap.MONTH ?? ""),
      time: r.AT,
      changes: r.ACTION === "update" ? describeChanges(before, after) : [],
      isDeleted: r.IS_DELETED === 1,
    };
  });

  if (events.length === 0 && info.total === 0) {
    const [added] = await db.execute(
      "SELECT ID, NAME, CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, CREATED_AT AS AT, DELETED_AT FROM LEDGER WHERE WORKSPACE_ID = ? ORDER BY CREATED_AT DESC LIMIT 30", [ws],
    );
    const [deleted] = await db.execute(
      "SELECT ID, NAME, CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, DELETED_AT AS AT FROM LEDGER WHERE WORKSPACE_ID = ? AND DELETED_AT IS NOT NULL ORDER BY DELETED_AT DESC LIMIT 15", [ws],
    );
    const [updated] = await db.execute(
      "SELECT ID, NAME, CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, UPDATED_AT AS AT FROM LEDGER WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL AND UPDATED_AT > CREATED_AT ORDER BY UPDATED_AT DESC LIMIT 15", [ws],
    );
    type Row = { ID: string; NAME: string; CATEGORY: CategoryKey; AMOUNT: number; MONTH: string; AT: string; DELETED_AT?: string | null };
    const mk = (action: AuditAction) => (r: Row): Event => ({
      key: `${action}-${r.ID}`, id: r.ID, action, name: r.NAME, category: r.CATEGORY, amount: r.AMOUNT, month: r.MONTH, time: r.AT, changes: [], isDeleted: action === "delete" || !!r.DELETED_AT,
    });
    events = [...(added as Row[]).map(mk("create")), ...(deleted as Row[]).map(mk("delete")), ...(updated as Row[]).map(mk("update"))]
      .sort((a, b) => b.time.localeCompare(a.time)).slice(0, 50);
  }

  const typeConfig: Record<AuditAction, { icon: LucideIcon; color: string; bg: string; label: string }> = {
    create: { icon: Plus, color: "text-teal-400", bg: "bg-teal-500/10", label: "Added" },
    delete: { icon: Trash2, color: "text-red-400", bg: "bg-red-500/10", label: "Deleted" },
    update: { icon: Pencil, color: "text-blue-400", bg: "bg-blue-500/10", label: "Updated" },
    restore: { icon: Undo2, color: "text-amber-400", bg: "bg-amber-500/10", label: "Restored" },
  };

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1
            className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1"
            style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}
          >
            Activity
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">Every change, newest first</p>
        </div>

        <div className="card rounded-2xl overflow-hidden animate-fade-up" style={{ animationDelay: "0.05s" }}>
          {events.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-[#9ca3c0]">No activity yet</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {events.map((a) => {
                const cfg = typeConfig[a.action];
                return (
                  <div key={a.key} className="px-4 py-3 flex items-center gap-3 row-hover">
                    <div className={`w-7 h-7 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                      <span className={`text-xs font-bold ${cfg.color}`}><cfg.icon size={12} strokeWidth={2.5} /></span>
                    </div>
                    <CategoryIcon category={a.category} size={16} className="text-[#9ca3c0]" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        {a.isDeleted ? (
                          <span className="text-sm truncate text-white/40 line-through">{a.name}</span>
                        ) : (
                          <Link href={`/?month=${a.month}#e-${a.id}`} className="text-sm truncate text-white/90 hover:text-pink-400 transition-colors">{a.name}</Link>
                        )}
                        <span className="text-sm font-mono text-white/60 ml-2 shrink-0 tabular-nums">{fmt(a.amount)} €</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#5a6380] flex-wrap">
                        <span>{cfg.label}</span>
                        <span>·</span>
                        <span>{a.month}</span>
                        <span>·</span>
                        <span>{timeAgo(a.time)}</span>
                        {a.changes.length > 0 && (
                          <span className="text-blue-300/70 truncate">· {a.changes.join(", ")}</span>
                        )}
                      </div>
                    </div>
                    {a.action === "delete" && a.isDeleted && <RestoreButton id={a.id} name={a.name} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {info.pages > 1 && <Pagination info={info} href={pageHref("/activity", params)} label="changes" />}
      </div>
    </main>
  );
}
