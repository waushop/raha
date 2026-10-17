import { NextRequest } from "next/server";
import { createExpense } from "@/app/actions";
import { getAuthContext } from "@/lib/auth";
import { parseAddLink, prefillQuery } from "@/lib/add-link";
import { currentMonth } from "@/lib/months";

// GET /add?amount=12.5&name=Coffee&category=restaurants&tags=work&kind=expense
//
// A deep link for Siri Shortcuts / Android intents / the manifest shortcut.
// With a valid name and amount the row is created right away (through the
// createExpense server action, so rules, tags and audit all apply) and the
// browser lands on it in this month's view. Otherwise the month view opens
// the add form prefilled with whatever was valid.
//
// A route handler rather than a page: creating a row is a side effect, which
// Next forbids during render (and a page could be prefetched).
const see = (location: string) => new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  // The proxy already bounced requests without a session cookie; reaching
  // here unauthenticated means a stale one, which /logout clears.
  if (!(await getAuthContext())) return see("/logout");

  const { prefill, complete } = parseAddLink(request.nextUrl.searchParams);
  const month = currentMonth();

  // Only create from a link the user opened themselves (typed, shortcut, app
  // intent → "none") or from inside the app. A link on another site just
  // opens the prefilled form, so it can't add rows behind the user's back.
  const site = request.headers.get("sec-fetch-site");
  const trusted = site === null || site === "none" || site === "same-origin";

  if (complete && trusted) {
    const now = new Date();
    const data = new FormData();
    data.set("month", month);
    data.set("date", `${month}-${String(now.getDate()).padStart(2, "0")}`);
    data.set("name", prefill.name ?? "");
    data.set("amount", String(prefill.amount));
    data.set("category", prefill.category ?? "other");
    data.set("kind", prefill.kind ?? "expense");
    data.set("tags", prefill.tags ?? "");
    const res = await createExpense(data);
    if (res.ok) return see(`/?month=${month}#e-${res.id}`);
  }
  return see(`/?${prefillQuery(prefill)}`);
}
