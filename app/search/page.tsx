import { connection } from "next/server";
import db from "@/lib/db";
import { currentContext } from "@/lib/auth";
import type { Expense } from "@/types/expense";
import { CATEGORIES, CATEGORY_KEYS, GROUP_COLOR_CLASSES } from "@/types/expense";
import Link from "next/link";
import SearchInput from "@/components/SearchInput";
import SearchFilters from "@/components/SearchFilters";
import { getGroups, getTags } from "@/app/actions";
import { isValidMonth, monthLabel } from "@/lib/months";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Params = { q?: string; kind?: string; category?: string; group?: string; tag?: string; min?: string; max?: string; from?: string; to?: string };

// Escape LIKE wildcards so a literal "%" or "_" in the query means itself.
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const p = await searchParams;
  const query = p.q?.trim() ?? "";

  // Every filter is validated before it reaches SQL; invalid values are ignored.
  const where: string[] = ["e.WORKSPACE_ID = ?", "e.DELETED_AT IS NULL"];
  const args: unknown[] = [ws];
  if (query.length >= 2) {
    where.push("(e.NAME LIKE ? ESCAPE '\\' OR e.NOTES LIKE ? ESCAPE '\\' OR e.TAGS LIKE ? ESCAPE '\\')");
    args.push(like(query), like(query), like(query));
  }
  if (p.kind === "expense" || p.kind === "income") { where.push("e.KIND = ?"); args.push(p.kind); }
  if (p.category && (CATEGORY_KEYS as string[]).includes(p.category)) { where.push("e.CATEGORY = ?"); args.push(p.category); }
  if (p.group === "none") where.push("e.GROUP_ID IS NULL");
  else if (p.group && UUID_RE.test(p.group)) { where.push("e.GROUP_ID = ?"); args.push(p.group); }
  const tag = p.tag?.replace(/^#/, "").trim().toLowerCase();
  if (tag) { where.push("EXISTS (SELECT 1 FROM LEDGER_TAG t WHERE t.LEDGER_ID = e.ID AND t.TAG = ?)"); args.push(tag); }
  const min = Number(p.min?.replace(",", "."));
  if (p.min && Number.isFinite(min)) { where.push("e.AMOUNT >= ?"); args.push(min); }
  const max = Number(p.max?.replace(",", "."));
  if (p.max && Number.isFinite(max)) { where.push("e.AMOUNT <= ?"); args.push(max); }
  if (isValidMonth(p.from)) { where.push("e.MONTH >= ?"); args.push(p.from); }
  if (isValidMonth(p.to)) { where.push("e.MONTH <= ?"); args.push(p.to); }

  const hasCriteria = where.length > 2;
  let results: Expense[] = [];
  let totalFound = 0;

  if (hasCriteria) {
    const [rows] = await db.execute(
      `SELECT e.ID, e.KIND, e.CATEGORY, e.NAME, CAST(e.AMOUNT AS REAL) AS AMOUNT, e.MONTH, e.DAY, e.NOTES, e.IS_RECURRING, e.TAGS,
              e.GROUP_ID, g.NAME AS GROUP_NAME, g.EMOJI AS GROUP_EMOJI, g.COLOR AS GROUP_COLOR
       FROM LEDGER e
       LEFT JOIN CATEGORY_GROUP g ON e.GROUP_ID = g.ID AND g.DELETED_AT IS NULL
       WHERE ${where.join(" AND ")}
       ORDER BY e.MONTH DESC, e.DAY DESC, e.AMOUNT DESC
       LIMIT 100`,
      args,
    );
    results = rows as Expense[];
    const [countRows] = await db.execute(`SELECT COUNT(*) AS CNT FROM LEDGER e WHERE ${where.join(" AND ")}`, args);
    totalFound = (countRows as Array<{ CNT: number }>)[0]?.CNT ?? 0;
  }

  const [groups, tags] = await Promise.all([getGroups(), getTags()]);
  const sum = results.reduce((s, e) => s + (e.KIND === "income" ? e.AMOUNT : -e.AMOUNT), 0);

  const byMonth = new Map<string, Expense[]>();
  for (const e of results) {
    if (!byMonth.has(e.MONTH)) byMonth.set(e.MONTH, []);
    byMonth.get(e.MONTH)!.push(e);
  }

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1
            className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1"
            style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}
          >
            Search
          </h1>
        </div>

        <div className="animate-fade-up space-y-3" style={{ animationDelay: "0.05s" }}>
          <SearchInput initialQuery={query} />
          <SearchFilters groups={groups} tags={tags.map((t) => t.TAG)} />
        </div>

        {hasCriteria && (
          <p className="text-xs text-[#5a6380] animate-fade-up flex items-center justify-between" style={{ animationDelay: "0.08s" }}>
            <span>
              {totalFound} result{totalFound !== 1 ? "s" : ""}{query.length >= 2 && <> for &ldquo;{query}&rdquo;</>}
              {totalFound > 100 && <span className="text-[#5a6380]/50"> (showing first 100)</span>}
            </span>
            {results.length > 0 && (
              <span className={`font-mono tabular-nums ${sum >= 0 ? "text-teal-400/80" : "text-white/60"}`}>
                net {sum >= 0 ? "+" : ""}{fmt(sum)} €
              </span>
            )}
          </p>
        )}

        {Array.from(byMonth.entries()).map(([month, items]) => (
          <div key={month} className="card rounded-2xl overflow-hidden animate-fade-in">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <Link href={`/?month=${month}`} className="text-sm font-bold text-white hover:text-pink-400 transition-colors capitalize">
                {monthLabel(month)}
              </Link>
              <span className="text-xs text-[#5a6380] font-mono tabular-nums">
                {fmt(items.filter((e) => e.KIND !== "income").reduce((s, e) => s + e.AMOUNT, 0))} €
              </span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {items.map((e) => {
                const cat = CATEGORIES[e.CATEGORY] ?? CATEGORIES.other;
                const groupText = e.GROUP_COLOR ? (GROUP_COLOR_CLASSES[e.GROUP_COLOR] ?? GROUP_COLOR_CLASSES.blue).text : "";
                return (
                  <Link key={e.ID} href={`/?month=${e.MONTH}#e-${e.ID}`} className="px-4 py-2.5 flex items-center gap-2.5 row-hover">
                    <span className="text-base shrink-0">{cat.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white/90 truncate">{e.NAME}</span>
                        <span className={`text-sm font-mono font-semibold ml-2 shrink-0 tabular-nums ${e.KIND === "income" ? "text-teal-400" : "text-white/80"}`}>{e.KIND === "income" ? "+" : ""}{fmt(e.AMOUNT)} €</span>
                      </div>
                      <p className="text-[10px] text-[#5a6380] truncate mt-0.5 flex items-center gap-1.5">
                        {e.DAY && <span className="font-mono tabular-nums">{e.MONTH}-{String(e.DAY).padStart(2, "0")}</span>}
                        {e.GROUP_NAME && <span className={groupText}>{e.GROUP_EMOJI} {e.GROUP_NAME}</span>}
                        {e.TAGS && <span className="text-purple-300/60">{e.TAGS}</span>}
                        {e.NOTES && <span className="truncate">{e.NOTES}</span>}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {hasCriteria && results.length === 0 && (
          <div className="card rounded-2xl p-8 text-center animate-fade-in">
            <p className="text-sm text-[#9ca3c0]">Nothing matches</p>
            <p className="text-xs text-[#5a6380] mt-1">Try a different term or loosen the filters</p>
          </div>
        )}
      </div>
    </main>
  );
}
