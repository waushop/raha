"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, CircleAlert, Landmark, Link2, RefreshCw, Search, Unplug } from "lucide-react";
import { useToast } from "./Toast";
import { useDialog } from "./Dialog";
import { connectBank, disconnectBank, reconnectBank, syncNow, updateBankAccount } from "@/app/bank/actions";
import type { Aspsp } from "@/lib/enablebanking";
import type { BankAccountRow, BankConnectionRow } from "@/lib/banksync-db";
import { daysLeft, maskIban } from "@/lib/bank-format";

const inputCls = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#5a6380] focus:outline-none focus:border-purple-500/50";
const labelCls = "block text-[9px] font-bold uppercase tracking-widest text-[#5a6380] mb-1";
const btnCls = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50";

const STATUS_TONE: Record<BankConnectionRow["STATUS"], string> = {
  active: "bg-teal-500/15 text-teal-300",
  pending: "bg-white/10 text-[#9ca3c0]",
  expired: "bg-amber-500/15 text-amber-300",
  error: "bg-red-500/15 text-red-300",
  revoked: "bg-white/10 text-[#9ca3c0]",
};

function ago(sql: string | null): string {
  if (!sql) return "never";
  const ms = Date.now() - Date.parse(`${sql.replace(" ", "T")}${sql.endsWith("Z") ? "" : "Z"}`);
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

type Props = {
  aspsps: Aspsp[];
  aspspError: string | null;
  connections: BankConnectionRow[];
  accounts: BankAccountRow[];
  networthAccounts: Array<{ ID: string; NAME: string }>;
  mock: boolean;
  flash: { connected: number | null; error: string | null };
};

export default function BankSync({ aspsps, aspspError, connections, accounts, networthAccounts, mock, flash }: Props) {
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const dialog = useDialog();
  const router = useRouter();

  // One-shot toast from the callback redirect, then drop the query string.
  const flashed = useRef(false);
  useEffect(() => {
    if (flashed.current || (flash.connected === null && !flash.error)) return;
    flashed.current = true;
    if (flash.error) toast.showError(flash.error === "expired" ? "That bank sign-in expired — please try again" : `Bank: ${flash.error}`);
    else toast.show(`Bank connected · ${flash.connected} transaction${flash.connected === 1 ? "" : "s"} matched or added`);
    router.replace("/bank");
  }, [flash.connected, flash.error, toast, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? aspsps.filter((a) => a.name.toLowerCase().includes(q)) : aspsps;
  }, [aspsps, query]);

  function go(url: string) {
    navigator.vibrate?.(10);
    // A full navigation: the bank's page, or (mock) our own callback route handler.
    window.location.assign(url);
  }

  function connect(a: Aspsp) {
    const data = new FormData();
    data.set("aspsp", a.name);
    data.set("country", a.country);
    setBusy(`connect:${a.name}`);
    startTransition(async () => {
      const res = await connectBank(data);
      setBusy(null);
      if (!res.ok) { toast.showError(res.error); return; }
      go(res.url);
    });
  }

  function reconnect(c: BankConnectionRow) {
    setBusy(`reconnect:${c.ID}`);
    startTransition(async () => {
      const res = await reconnectBank(c.ID);
      setBusy(null);
      if (!res.ok) { toast.showError(res.error); return; }
      go(res.url);
    });
  }

  function sync(c: BankConnectionRow) {
    setBusy(`sync:${c.ID}`);
    startTransition(async () => {
      const res = await syncNow(c.ID);
      setBusy(null);
      if (!res.ok) { toast.showError(res.error); return; }
      navigator.vibrate?.(10);
      toast.show(res.inserted + res.linked === 0 ? "Up to date · nothing new" : `${res.inserted} new, ${res.linked} matched to existing rows`);
    });
  }

  async function disconnect(c: BankConnectionRow) {
    if (!(await dialog.confirm({ title: `Disconnect ${c.ASPSP_NAME}?`, message: "Syncing stops and the bank access is revoked. Rows already synced stay in your ledger.", confirmLabel: "Disconnect", tone: "danger", icon: Unplug }))) return;
    setBusy(`disconnect:${c.ID}`);
    startTransition(async () => {
      const res = await disconnectBank(c.ID);
      setBusy(null);
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(`${c.ASPSP_NAME} disconnected`);
    });
  }

  function saveAccount(e: React.FormEvent<HTMLFormElement>, a: BankAccountRow) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateBankAccount(a.ID, data);
      if (!res.ok) { toast.showError(res.error); return; }
      navigator.vibrate?.(10);
      toast.show("Account settings saved");
    });
  }

  return (
    <div className="space-y-5">
      {/* Connections */}
      {connections.map((c) => {
        const left = daysLeft(c.VALID_UNTIL);
        const own = accounts.filter((a) => a.CONNECTION_ID === c.ID);
        const live = c.STATUS === "active" || c.STATUS === "error";
        return (
          <section key={c.ID} className="card rounded-2xl p-4 sm:p-5 animate-fade-up" aria-label={c.ASPSP_NAME}>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl surface flex items-center justify-center shrink-0"><Landmark size={16} className="text-purple-400" /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-bold text-white truncate">{c.ASPSP_NAME}</h2>
                  <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${STATUS_TONE[c.STATUS]}`}>{c.STATUS}</span>
                </div>
                <p className="text-[11px] text-[#9ca3c0] mt-0.5">
                  {c.VALID_UNTIL ? <>Access until {c.VALID_UNTIL.slice(0, 10)}{left !== null && live ? <span className={left <= 7 ? "text-amber-300" : ""}> · {left} day{left === 1 ? "" : "s"} left</span> : null}</> : "No access yet"}
                  {" · "}Last sync {ago(c.LAST_SYNC_AT)}
                </p>
                {c.LAST_ERROR && (
                  <p className="text-[11px] text-red-300 mt-1 flex items-start gap-1"><CircleAlert size={12} className="mt-0.5 shrink-0" />{c.LAST_ERROR}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {live && (
                <button type="button" onClick={() => sync(c)} disabled={isPending} className={`${btnCls} bg-teal-500/15 text-teal-300 hover:bg-teal-500/25`}>
                  <RefreshCw size={12} className={busy === `sync:${c.ID}` ? "animate-spin" : ""} /> Sync now
                </button>
              )}
              <button type="button" onClick={() => reconnect(c)} disabled={isPending} className={`${btnCls} bg-purple-500/15 text-purple-300 hover:bg-purple-500/25`}>
                <Link2 size={12} /> Reconnect
              </button>
              {c.STATUS !== "revoked" && (
                <button type="button" onClick={() => disconnect(c)} disabled={isPending} className={`${btnCls} bg-white/5 text-[#9ca3c0] hover:text-red-300 hover:bg-red-500/10`}>
                  <Unplug size={12} /> Disconnect
                </button>
              )}
            </div>

            {own.length > 0 && (
              <div className="mt-4 space-y-3">
                {own.map((a) => (
                  <form key={a.ID} onSubmit={(e) => saveAccount(e, a)} className="surface rounded-xl p-3 border border-white/[0.06]" aria-label={`Account ${a.NAME ?? a.IBAN ?? ""}`}>
                    <div className="flex items-center gap-2">
                      <Building2 size={14} className="text-[#9ca3c0] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/90 truncate">{a.NAME || "Account"}</p>
                        <p className="text-[10px] text-[#5a6380] font-mono">{maskIban(a.IBAN) || "no IBAN"}{a.CURRENCY ? ` · ${a.CURRENCY}` : ""}{a.LAST_BOOKING_DATE ? ` · booked to ${a.LAST_BOOKING_DATE}` : ""}</p>
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-[#9ca3c0] shrink-0">
                        <input type="checkbox" name="enabled" defaultChecked={a.ENABLED === 1} className="accent-purple-500 w-4 h-4" />
                        Sync
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 mt-3 items-end">
                      <div>
                        <label className={labelCls} htmlFor={`from-${a.ID}`}>Sync from</label>
                        <input id={`from-${a.ID}`} type="date" name="sync_from" defaultValue={a.SYNC_FROM ?? ""} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor={`nw-${a.ID}`}>Net worth account</label>
                        <select id={`nw-${a.ID}`} name="networth_account_id" defaultValue={a.NETWORTH_ACCOUNT_ID ?? ""} className={inputCls}>
                          <option value="">Not linked</option>
                          {networthAccounts.map((n) => <option key={n.ID} value={n.ID}>{n.NAME}</option>)}
                        </select>
                      </div>
                      <button type="submit" disabled={isPending} className={`${btnCls} justify-center py-2 bg-white/5 text-white hover:bg-white/10`}>Save</button>
                    </div>
                  </form>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* Connect a bank */}
      <section className="card rounded-2xl p-4 sm:p-5 animate-fade-up" style={{ animationDelay: "0.05s" }}>
        <div className="flex items-center gap-2 mb-1">
          <Building2 size={14} className="text-pink-400" />
          <h2 className="text-sm font-bold text-white">Connect a bank</h2>
          {mock && <span className="ml-auto text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-amber-500/15 text-amber-300">Mock mode</span>}
        </div>
        <p className="text-xs text-[#5a6380] mb-3">Read-only access through Enable Banking. You approve it at your bank; the consent lasts up to 180 days and can be ended here any time.</p>
        {aspspError ? (
          <p className="text-xs text-red-300 flex items-start gap-1"><CircleAlert size={12} className="mt-0.5 shrink-0" />Could not load the bank list: {aspspError}</p>
        ) : (
          <>
            {aspsps.length > 6 && (
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5a6380]" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search banks in Estonia" aria-label="Search banks" className={`${inputCls} pl-9`} />
              </div>
            )}
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filtered.map((a) => (
                <li key={`${a.country}:${a.name}`}>
                  <button type="button" onClick={() => connect(a)} disabled={isPending} className="w-full flex items-center gap-3 surface rounded-xl px-3 py-2.5 border border-white/[0.06] hover:border-purple-500/40 transition-colors text-left disabled:opacity-50">
                    {a.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- remote bank logos from the API
                      <img src={a.logo} alt="" className="w-7 h-7 rounded-lg object-contain bg-white shrink-0" loading="lazy" />
                    ) : (
                      <span className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0"><Landmark size={14} className="text-[#9ca3c0]" /></span>
                    )}
                    <span className="text-sm text-white/90 truncate flex-1">{a.name}</span>
                    {busy === `connect:${a.name}` && <RefreshCw size={12} className="animate-spin text-[#9ca3c0]" />}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && <li className="text-xs text-[#5a6380]">No bank matches &ldquo;{query}&rdquo;.</li>}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
