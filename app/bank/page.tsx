import { connection } from "next/server";
import Link from "next/link";
import { CircleAlert, Landmark } from "lucide-react";
import { currentContext } from "@/lib/auth";
import { bankMode, getBankApi, type Aspsp } from "@/lib/enablebanking";
import { listBankAccounts, listConnections } from "@/lib/banksync-db";
import { listAccounts } from "@/lib/networth-db";
import BankSync from "@/components/BankSync";

const COUNTRY = "EE";

function NotConfigured() {
  const steps = [
    <>Register at <a href="https://enablebanking.com" target="_blank" rel="noreferrer" className="text-pink-400 hover:underline">enablebanking.com</a> and open the Control Panel.</>,
    <>Create an API application in <b className="text-white">production</b> (restricted access: free, and it can link your own accounts). Generate the key pair in the browser or upload your own public key.</>,
    <>Set the redirect URL to <code className="font-mono text-pink-300 break-all">https://raha.waushop.ee/bank/callback</code>.</>,
    <>Link your own accounts to the application in the Control Panel (restricted production only allows accounts you have linked).</>,
    <>Set <code className="font-mono text-pink-300">ENABLE_BANKING_APP_ID</code> (the application id) and <code className="font-mono text-pink-300">ENABLE_BANKING_PRIVATE_KEY</code> (the PEM, <code className="font-mono">\n</code>-escaped is fine) in the deployment&rsquo;s secret, then restart.</>,
  ];
  return (
    <div className="card rounded-2xl p-4 sm:p-5 animate-fade-up border border-amber-500/20">
      <div className="flex items-center gap-2 mb-2">
        <CircleAlert size={14} className="text-amber-300" />
        <h2 className="text-sm font-bold text-white">Not configured</h2>
      </div>
      <p className="text-xs text-[#9ca3c0] mb-3">Bank sync uses Enable Banking (PSD2, read-only). To switch it on:</p>
      <ol className="space-y-2 text-xs text-[#9ca3c0] list-decimal pl-5">
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <p className="text-[11px] text-[#5a6380] mt-3">For development and demos, <code className="font-mono">ENABLE_BANKING_MOCK=1</code> adds two fake banks.</p>
    </div>
  );
}

export default async function BankPage({ searchParams }: { searchParams: Promise<{ connected?: string; bank_error?: string }> }) {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const params = await searchParams;
  const mode = bankMode();
  const api = getBankApi();

  let aspsps: Aspsp[] = [];
  let aspspError: string | null = null;
  if (api) {
    try {
      aspsps = (await api.listAspsps(COUNTRY)).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      aspspError = (e as Error).message;
    }
  }
  const [connections, accounts, networth] = await Promise.all([listConnections(ws), listBankAccounts(ws), listAccounts(ws)]);
  const connected = params.connected !== undefined && /^\d+$/.test(params.connected) ? Number(params.connected) : null;
  const flash = { connected, error: params.bank_error ? params.bank_error.slice(0, 160) : null };

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
            Bank sync
          </h1>
          <p className="text-xs text-[#5a6380] mt-1 flex items-start gap-1.5">
            <Landmark size={12} className="mt-0.5 shrink-0" />
            Transactions arrive by themselves every 6 hours. Rows you already typed in are matched, not duplicated; new ones are categorised by your rules.
          </p>
        </div>

        {mode === "off" ? (
          <NotConfigured />
        ) : (
          <BankSync
            aspsps={aspsps}
            aspspError={aspspError}
            connections={connections}
            accounts={accounts}
            networthAccounts={networth.map((a) => ({ ID: a.ID, NAME: a.NAME }))}
            mock={mode === "mock"}
            flash={flash}
          />
        )}

        {mode === "off" && connections.length > 0 && (
          <p className="text-center text-xs text-[#5a6380]">{connections.length} earlier connection{connections.length === 1 ? "" : "s"} kept; synced rows stay in the ledger.</p>
        )}
      </div>
    </main>
  );
}
