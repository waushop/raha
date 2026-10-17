import { connection } from "next/server";
import Link from "next/link";
import db from "@/lib/db";
import { currentContext } from "@/lib/auth";
import { latestCheckpoint } from "@/lib/cashflow-db";
import WelcomeWizard from "@/components/WelcomeWizard";

export default async function WelcomePage() {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const [[groupRows], [subRows], [paydayRows], checkpoint] = await Promise.all([
    db.execute("SELECT NAME FROM CATEGORY_GROUP WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]),
    db.execute("SELECT NAME FROM SUBSCRIPTION WHERE WORKSPACE_ID = ? AND DELETED_AT IS NULL", [ws]),
    db.execute(
      "SELECT CAST(AMOUNT AS REAL) AS AMOUNT, DAY FROM PAYDAY WHERE WORKSPACE_ID = ? AND CADENCE = 'monthly' AND DELETED_AT IS NULL ORDER BY (LABEL = 'Salary') DESC, AMOUNT DESC LIMIT 1",
      [ws],
    ),
    latestCheckpoint(ws),
  ]);
  const payday = (paydayRows as Array<{ AMOUNT: number; DAY: number | null }>)[0] ?? null;

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1
            className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1"
            style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}
          >
            Set up Empty Wallet
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">Five quick steps. Skip anything and change it later.</p>
        </div>

        <div className="animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <WelcomeWizard
            existingGroups={(groupRows as Array<{ NAME: string }>).map((r) => r.NAME)}
            existingSubscriptions={(subRows as Array<{ NAME: string }>).map((r) => r.NAME)}
            payday={payday ? { amount: payday.AMOUNT, day: payday.DAY ?? 1 } : null}
            balance={checkpoint?.AMOUNT ?? null}
          />
        </div>
      </div>
    </main>
  );
}
