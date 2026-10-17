"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { attempt, type ActionResult } from "@/lib/action-result";
import { parseCountryCode, parseId, parseName, parseOptionalId, parseOptionalIsoDate, ValidationError } from "@/lib/validate";
import { configuredRedirectUrl, getBankApi, isSessionGone } from "@/lib/enablebanking";
import { beginAuth } from "@/lib/bank-connect";
import { getConnection, syncConnection } from "@/lib/banksync-db";

function revalidate() {
  revalidatePath("/bank");
  revalidatePath("/");
  revalidatePath("/dashboard");
}

/** ENABLE_BANKING_REDIRECT_URL, else APP_URL, else this request's own origin. */
async function redirectUrl(): Promise<string> {
  const configured = configuredRedirectUrl();
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}/bank/callback`;
}

/** Starts the consent flow for a bank; the client navigates to the returned URL. */
export async function connectBank(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const ctx = await requireAuth();
  return attempt(async () => {
    const name = parseName(formData.get("aspsp"), "Bank", 200);
    const country = parseCountryCode(formData.get("country"));
    const { url } = await beginAuth(ctx, { name, country }, await redirectUrl());
    return { url };
  });
}

/** New consent with the same bank (before or after the old one expires). */
export async function reconnectBank(id: string): Promise<ActionResult<{ url: string }>> {
  const ctx = await requireAuth();
  return attempt(async () => {
    const conn = await getConnection(ctx.workspaceId, parseId(id));
    if (!conn) throw new ValidationError("That connection no longer exists");
    const { url } = await beginAuth(ctx, { name: conn.ASPSP_NAME, country: conn.COUNTRY }, await redirectUrl(), conn.ID);
    return { url };
  });
}

export async function syncNow(id: string): Promise<ActionResult<{ inserted: number; linked: number }>> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const conn = await getConnection(ws, parseId(id));
    if (!conn) throw new ValidationError("That connection no longer exists");
    const r = await syncConnection(ws, conn.ID);
    revalidate();
    if (r.error) throw new ValidationError(r.error);
    return { inserted: r.inserted, linked: r.linked };
  });
}

/** Ends the consent at the bank and stops syncing. Ledger rows stay. */
export async function disconnectBank(id: string): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const conn = await getConnection(ws, parseId(id));
    if (!conn) throw new ValidationError("That connection no longer exists");
    const api = getBankApi();
    if (api && conn.SESSION_ID) {
      try {
        await api.deleteSession(conn.SESSION_ID);
      } catch (e) {
        if (!isSessionGone(e)) console.error("[bank] delete session failed:", (e as Error).message);
      }
    }
    await db.execute("UPDATE BANK_CONNECTION SET STATUS = 'revoked', SESSION_ID = NULL, STATE = NULL, LAST_ERROR = NULL WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [conn.ID, ws]);
    revalidate();
    return {};
  });
}

/** Per-account settings: enabled, sync-from date, linked net worth account. */
export async function updateBankAccount(id: string, formData: FormData): Promise<ActionResult> {
  const { workspaceId: ws } = await requireAuth();
  return attempt(async () => {
    const accountId = parseId(id);
    const enabled = formData.get("enabled") === "on" ? 1 : 0;
    const syncFrom = parseOptionalIsoDate(formData.get("sync_from"));
    const networth = parseOptionalId(formData.get("networth_account_id"), "Net worth account");
    if (networth) {
      const [rows] = await db.execute("SELECT 1 FROM ACCOUNT WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL", [networth, ws]);
      if ((rows as unknown[]).length === 0) throw new ValidationError("Unknown net worth account");
    }
    const [res] = await db.execute(
      // Moving "sync from" earlier forgets the sync position so the next run reads back that far (EXTERNAL_ID keeps it duplicate-free).
      `UPDATE BANK_ACCOUNT SET ENABLED = ?, NETWORTH_ACCOUNT_ID = ?,
         LAST_BOOKING_DATE = CASE WHEN ? IS NOT NULL AND (SYNC_FROM IS NULL OR ? < SYNC_FROM) THEN NULL ELSE LAST_BOOKING_DATE END,
         SYNC_FROM = ?
       WHERE ID = ? AND WORKSPACE_ID = ? AND DELETED_AT IS NULL`,
      [enabled, networth, syncFrom, syncFrom, syncFrom, accountId, ws],
    );
    if ((res as { affectedRows: number }).affectedRows === 0) throw new ValidationError("That account no longer exists");
    revalidatePath("/bank");
    return {};
  });
}
