import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  getSessionSecret,
  parseSessionTokenWithCurrentSecret,
  sessionCookieOptions,
} from "@/lib/session";

// Proxy runs on the Node.js runtime in Next 16, so we can verify the HMAC
// cookie here and reject forged sessions before any route executes.
// Server Actions and route handlers additionally call requireAuth()
// themselves (see lib/auth.ts), as Next recommends — a matcher change must
// never silently open a mutation.

const PUBLIC_PATHS = new Set([
  "/login", "/logout", "/privacy", "/terms", "/manifest.json", "/favicon.ico", "/sw.js", "/api/cron",
  "/icon.svg", "/icon-192.png", "/icon-512.png",
]);

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next/");
}

// Sliding expiry: once a token is past the halfway point of its life, hand
// the browser a fresh one. A device that visits at least every six months
// never gets logged out; one that doesn't, does.
const REFRESH_WHEN_REMAINING_MS = SESSION_TTL_SECONDS * 500;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = parseSessionTokenWithCurrentSecret(token);
  const authenticated = claims !== null;

  if (pathname === "/login" && authenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (isPublic(pathname) || authenticated) {
    const response = NextResponse.next();
    if (claims && claims.exp * 1000 - Date.now() < REFRESH_WHEN_REMAINING_MS) {
      response.cookies.set(SESSION_COOKIE, createSessionToken(getSessionSecret(), claims), sessionCookieOptions(process.env.NODE_ENV === "production"));
    }
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  const response = NextResponse.redirect(loginUrl);
  // A present-but-invalid cookie is either expired or forged; clear it so the
  // browser stops sending it.
  if (token) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
