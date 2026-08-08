import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { buildAliExpressAuthorizeUrl } from "@/lib/aliexpress-connection";

export const runtime = "nodejs";

export async function GET() {
  try {
    const state = randomBytes(32).toString("base64url");
    const response = NextResponse.redirect(buildAliExpressAuthorizeUrl({ state }));
    response.cookies.set("aliexpress_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60,
      path: "/",
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "OAuth AliExpress indisponível." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
