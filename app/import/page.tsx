import { connection } from "next/server";
import { getImportPatterns } from "@/app/actions";
import Link from "next/link";
import ImportFlow from "./ImportFlow";
import db from "@/lib/db";
import { currentContext } from "@/lib/auth";
import { train } from "@/lib/classifier";

export default async function ImportPage() {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const patterns = await getImportPatterns();
  // Train on everything the user has categorised so far (expenses only).
  const [rows] = await db.execute("SELECT NAME, CATEGORY, GROUP_ID FROM LEDGER WHERE WORKSPACE_ID = ? AND KIND = 'expense' AND DELETED_AT IS NULL", [ws]);
  const model = train((rows as Array<{ NAME: string; CATEGORY: string; GROUP_ID: string | null }>).map((r) => ({ name: r.NAME, category: r.CATEGORY, groupId: r.GROUP_ID })));

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1
            className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1"
            style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}
          >
            Import
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">Upload a bank CSV to import transactions</p>
        </div>

        <div className="animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <ImportFlow patterns={patterns} model={model} />
        </div>
      </div>
    </main>
  );
}
