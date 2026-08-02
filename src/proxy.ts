import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  WHO_COOKIE,
  isValidSession,
  readWho,
} from "@/lib/auth";

/**
 * The front door. In Next 16 this file is `proxy.ts` (the old `middleware.ts`
 * name is deprecated) and it runs on the Node runtime, which is what lets it
 * verify an HMAC with node:crypto.
 *
 * Two gates, in order: a valid session cookie, then a chosen name. Anything
 * without both gets bounced to /login or /who.
 */

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/manifest.json",
  "/favicon.ico",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return pathname.startsWith("/icons/");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const signedIn = isValidSession(session);
  const who = readWho(request.cookies.get(WHO_COOKIE)?.value);

  if (isPublic(pathname)) {
    // Already signed in? Skip the login screen.
    if (pathname === "/login" && signedIn) {
      return NextResponse.redirect(new URL(who ? "/week" : "/who", request.url));
    }
    return NextResponse.next();
  }

  if (!signedIn) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  // Signed in but no name picked yet.
  const namePaths = pathname === "/who" || pathname === "/api/auth/name";
  if (!who && !namePaths) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No name selected" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/who", request.url));
  }
  if (who && pathname === "/who") {
    return NextResponse.redirect(new URL("/week", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own static output and the PWA assets that must
     * be reachable before login (the manifest and icons are fetched by the OS,
     * which does not carry our cookie).
     */
    "/((?!_next/static|_next/image|icons/|manifest.json|favicon.ico|apple-touch-icon.png).*)",
  ],
};
