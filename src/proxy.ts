import { NextResponse, type NextRequest } from "next/server";

import {
  isPublicManagerPath,
  managerAdminCredentialsFromEnv,
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

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublicManagerPath(pathname)) {
    return NextResponse.next();
  }

  const credentials = managerAdminCredentialsFromEnv(process.env);
  if (!credentials) {
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

  if (!verifyManagerAdminAuthorization(request.headers.get("authorization"), credentials)) {
    return unauthorized();
  }

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
