import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionTokenWithCurrentSecret } from "@/lib/session";

// Proxy runs on the Node.js runtime in Next 16, so we can verify the HMAC
// cookie here and reject forged sessions before any route executes.
// Server Actions and route handlers additionally call requireAuth()
// themselves (see lib/auth.ts), as Next recommends — a matcher change must
// never silently open a mutation.

const PUBLIC_PATHS = new Set(["/login", "/manifest.json", "/favicon.ico", "/sw.js"]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/icon")) return true;
  return false;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = verifySessionTokenWithCurrentSecret(token);

  if (pathname === "/login" && authenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (isPublic(pathname) || authenticated) {
    return NextResponse.next();
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
