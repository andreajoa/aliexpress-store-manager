import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  ACCESS_QUERY,
  isPublicManagerPath,
  managerAccessTokenFromEnv,
  managerAdminCredentialsFromEnv,
  safeEqual,
  verifyManagerAdminAuthorization,
} from "@/lib/manager-admin-auth";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="AliExpress Store Manager", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

/** Strangers get a plain 404: the manager does not reveal that it exists. */
function hidden() {
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

function allowed() {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublicManagerPath(pathname)) {
    return NextResponse.next();
  }

  // Secret-link access: opening any page with ?acesso=<MANAGER_ACCESS_TOKEN> remembers this browser
  // for a year (httpOnly cookie) and then the owner gets in without any password prompt.
  const accessToken = managerAccessTokenFromEnv(process.env);
  if (accessToken) {
    const fromLink = request.nextUrl.searchParams.get(ACCESS_QUERY);
    if (fromLink && safeEqual(fromLink, accessToken)) {
      const clean = request.nextUrl.clone();
      clean.searchParams.delete(ACCESS_QUERY);
      // Behind a proxy the public host comes in X-Forwarded-Host; never send the owner to an internal host.
      const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.nextUrl.host;
      const response = NextResponse.redirect(new URL(clean.pathname + clean.search, `https://${host}`));
      response.cookies.set(ACCESS_COOKIE, accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
    const cookie = request.cookies.get(ACCESS_COOKIE)?.value || "";
    if (cookie && safeEqual(cookie, accessToken)) {
      return allowed();
    }
  }

  const credentials = managerAdminCredentialsFromEnv(process.env);
  if (credentials && verifyManagerAdminAuthorization(request.headers.get("authorization"), credentials)) {
    return allowed();
  }
  if (accessToken) {
    return hidden();
  }
  if (credentials) {
    return unauthorized();
  }
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  return NextResponse.json(
    {
      ok: false,
      error: "Manager admin authentication is not configured.",
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
