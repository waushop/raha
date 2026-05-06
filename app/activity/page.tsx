import { connection } from "next/server";
import db from "@/lib/db";
import type { CategoryKey } from "@/types/expense";
import { CATEGORIES } from "@/types/expense";
import Link from "next/link";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function ActivityPage() {
  await connection();
  // Recent additions
  const [addedRows] = await db.execute(
    `SELECT NAME, CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, CREATED_AT
     FROM EXPENSE WHERE DELETED_AT IS NULL
     ORDER BY CREATED_AT DESC LIMIT 30`
  );
  const added = addedRows as { NAME: string; CATEGORY: CategoryKey; AMOUNT: number; MONTH: string; CREATED_AT: string }[];

  // Recent deletions
  const [deletedRows] = await db.execute(
    `SELECT NAME, CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, DELETED_AT
     FROM EXPENSE WHERE DELETED_AT IS NOT NULL
     ORDER BY DELETED_AT DESC LIMIT 15`
  );
  const deleted = deletedRows as { NAME: string; CATEGORY: CategoryKey; AMOUNT: number; MONTH: string; DELETED_AT: string }[];

  // Recent updates
  const [updatedRows] = await db.execute(
    `SELECT NAME, CATEGORY, CAST(AMOUNT AS REAL) AS AMOUNT, MONTH, UPDATED_AT, CREATED_AT
     FROM EXPENSE WHERE DELETED_AT IS NULL AND UPDATED_AT > CREATED_AT
     ORDER BY UPDATED_AT DESC LIMIT 15`
  );
  const updated = updatedRows as { NAME: string; CATEGORY: CategoryKey; AMOUNT: number; MONTH: string; UPDATED_AT: string; CREATED_AT: string }[];

  // Merge into timeline
  type Activity = { type: "add" | "delete" | "update"; name: string; category: CategoryKey; amount: number; month: string; time: string };
  const timeline: Activity[] = [
    ...added.map(r => ({ type: "add" as const, name: r.NAME, category: r.CATEGORY, amount: r.AMOUNT, month: r.MONTH, time: r.CREATED_AT })),
    ...deleted.map(r => ({ type: "delete" as const, name: r.NAME, category: r.CATEGORY, amount: r.AMOUNT, month: r.MONTH, time: r.DELETED_AT })),
    ...updated.map(r => ({ type: "update" as const, name: r.NAME, category: r.CATEGORY, amount: r.AMOUNT, month: r.MONTH, time: r.UPDATED_AT })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 50);

  const typeConfig = {
    add: { icon: "+", color: "text-teal-400", bg: "bg-teal-500/10", label: "Added" },
    delete: { icon: "×", color: "text-red-400", bg: "bg-red-500/10", label: "Deleted" },
    update: { icon: "~", color: "text-blue-400", bg: "bg-blue-500/10", label: "Updated" },
  };

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 sm:py-10 pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1
            className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1"
            style={{ fontFamily: "'Caveat', cursive", fontWeight: 700 }}
          >
            Activity
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">Recent changes across all months</p>
        </div>

        <div className="card rounded-2xl overflow-hidden animate-fade-up" style={{ animationDelay: "0.05s" }}>
          {timeline.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-[#9ca3c0]">No activity yet</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {timeline.map((a, i) => {
                const cat = CATEGORIES[a.category] ?? CATEGORIES.other;
                const cfg = typeConfig[a.type];
                return (
                  <div key={`${a.type}-${a.name}-${a.time}-${i}`} className="px-4 py-3 flex items-center gap-3 row-hover">
                    <div className={`w-7 h-7 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                      <span className={`text-xs font-bold ${cfg.color}`}>{cfg.icon}</span>
                    </div>
                    <span className="text-base shrink-0">{cat.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm truncate ${a.type === "delete" ? "text-white/40 line-through" : "text-white/90"}`}>
                          {a.name}
                        </span>
                        <span className="text-sm font-mono text-white/60 ml-2 shrink-0 tabular-nums">{fmt(a.amount)} €</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#5a6380]">
                        <span>{cfg.label}</span>
                        <span>·</span>
                        <span>{a.month}</span>
                        <span>·</span>
                        <span>{timeAgo(a.time)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
