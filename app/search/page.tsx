import { connection } from "next/server";
import db from "@/lib/db";
import type { Expense } from "@/types/expense";
import { CATEGORIES } from "@/types/expense";
import Link from "next/link";
import SearchInput from "@/components/SearchInput";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await connection();
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  let results: Expense[] = [];
  let totalFound = 0;

  if (query.length >= 2) {
    const [rows] = await db.execute(
      `SELECT e.ID, e.KIND, e.CATEGORY, e.NAME, CAST(e.AMOUNT AS REAL) AS AMOUNT, e.MONTH, e.NOTES, e.IS_RECURRING, e.TAGS,
              e.GROUP_ID, g.NAME AS GROUP_NAME, g.EMOJI AS GROUP_EMOJI, g.COLOR AS GROUP_COLOR
       FROM LEDGER e
       LEFT JOIN CATEGORY_GROUP g ON e.GROUP_ID = g.ID AND g.DELETED_AT IS NULL
       WHERE e.DELETED_AT IS NULL AND (e.NAME LIKE ? OR e.NOTES LIKE ? OR e.TAGS LIKE ?)
       ORDER BY e.MONTH DESC, e.AMOUNT DESC
       LIMIT 50`,
      [`%${query}%`, `%${query}%`, `%${query}%`]
    );
    results = rows as Expense[];

    const [countRows] = await db.execute(
      "SELECT COUNT(*) AS CNT FROM LEDGER WHERE DELETED_AT IS NULL AND (NAME LIKE ? OR NOTES LIKE ? OR TAGS LIKE ?)",
      [`%${query}%`, `%${query}%`, `%${query}%`]
    );
    totalFound = (countRows as Array<{ CNT: number }>)[0]?.CNT ?? 0;
  }

  // Group results by month
  const byMonth = new Map<string, Expense[]>();
  for (const e of results) {
    if (!byMonth.has(e.MONTH)) byMonth.set(e.MONTH, []);
    byMonth.get(e.MONTH)!.push(e);
  }

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 sm:py-10 pb-20">
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

        <div className="animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <SearchInput initialQuery={query} />
        </div>

        {query.length >= 2 && (
          <p className="text-xs text-[#5a6380] animate-fade-up" style={{ animationDelay: "0.08s" }}>
            {totalFound} result{totalFound !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
            {totalFound > 50 && <span className="text-[#5a6380]/50"> (showing first 50)</span>}
          </p>
        )}

        {Array.from(byMonth.entries()).map(([month, items]) => {
          const [y, m] = month.split("-").map(Number);
          const label = new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
          return (
            <div key={month} className="card rounded-2xl overflow-hidden animate-fade-in">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <Link href={`/?month=${month}`} className="text-sm font-bold text-white hover:text-pink-400 transition-colors capitalize">
                  {label}
                </Link>
                <span className="text-xs text-[#5a6380] font-mono tabular-nums">
                  {fmt(items.reduce((s, e) => s + e.AMOUNT, 0))} €
                </span>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {items.map(e => {
                  const cat = CATEGORIES[e.CATEGORY] ?? CATEGORIES.other;
                  return (
                    <div key={e.ID} className="px-4 py-2.5 flex items-center gap-2.5 row-hover">
                      <span className="text-base shrink-0">{cat.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-white/90 truncate">{e.NAME}</span>
                          <span className={`text-sm font-mono font-semibold ml-2 shrink-0 tabular-nums ${e.KIND === "income" ? "text-teal-400" : "text-white/80"}`}>{e.KIND === "income" ? "+" : ""}{fmt(e.AMOUNT)} €</span>
                        </div>
                        {e.NOTES && <p className="text-[10px] text-[#5a6380] truncate mt-0.5">{e.NOTES}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {query.length >= 2 && results.length === 0 && (
          <div className="card rounded-2xl p-8 text-center animate-fade-in">
            <p className="text-sm text-[#9ca3c0]">No expenses found</p>
            <p className="text-xs text-[#5a6380] mt-1">Try a different search term</p>
          </div>
        )}
      </div>
    </main>
  );
}
