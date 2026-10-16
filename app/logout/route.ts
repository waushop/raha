import { NextResponse } from "next/server";
import { PENDING_COOKIE } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session";

// Clears the session and sends the browser to /login. Also the landing spot
// for a cookie that is validly signed but no longer accepted (user removed,
// PIN changed elsewhere): the proxy can't tell those apart, so without
// clearing the cookie /login and /dashboard would bounce each other forever.
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(PENDING_COOKIE);
  return response;
}
