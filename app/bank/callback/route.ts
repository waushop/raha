import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth";
import { completeAuth, failAuth, findPending } from "@/lib/bank-connect";
import { syncConnection } from "@/lib/banksync-db";

// Where the bank sends the user back after the consent screen:
// /bank/callback?code=…&state=… (or ?error=…&error_description=…&state=…).
// The STATE must be an auth round-trip started by a workspace this user is
// a member of, less than an hour ago. On success the first sync runs right
// away and /bank shows a toast via ?connected=<new rows>.
export async function GET(request: NextRequest) {
  // Relative Location: request.url may carry the server's bind host rather
  // than the one the browser used, and the session cookie is host-bound.
  const to = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });
  const back = (query: string) => to(`/bank?${query}`);
  const ctx = await getAuthContext();
  if (!ctx) return to("/login");

  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const conn = await findPending(ctx.userId, state);
  if (!conn) return back("bank_error=expired");

  const error = params.get("error");
  const code = params.get("code");
  if (error || !code) {
    await failAuth(conn, params.get("error_description") || error || "No authorisation code");
    return back(`bank_error=${encodeURIComponent((params.get("error_description") || error || "cancelled").slice(0, 120))}`);
  }

  try {
    await completeAuth(conn, code);
  } catch (e) {
    await failAuth(conn, (e as Error).message);
    return back(`bank_error=${encodeURIComponent((e as Error).message.slice(0, 120))}`);
  }
  const result = await syncConnection(conn.WORKSPACE_ID, conn.ID);
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/bank");
  return back(result.error ? `connected=0&bank_error=${encodeURIComponent(result.error.slice(0, 120))}` : `connected=${result.inserted + result.linked}`);
}
