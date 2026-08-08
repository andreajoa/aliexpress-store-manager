import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { exchangeAliExpressCode, saveAliExpressConnection } from "@/lib/aliexpress-connection";

export const runtime = "nodejs";

function stateMatches(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function settingsRedirect(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/settings/aliexpress", request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.set("aliexpress_oauth_state", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}

export async function GET(request: NextRequest) {
  const receivedState = request.nextUrl.searchParams.get("state") || "";
  const expectedState = request.cookies.get("aliexpress_oauth_state")?.value || "";
  const code = request.nextUrl.searchParams.get("code") || "";
  const oauthError = request.nextUrl.searchParams.get("error") || "";

  if (oauthError) return settingsRedirect(request, { error: "authorization_denied" });
  if (!receivedState || !expectedState || !stateMatches(receivedState, expectedState)) {
    return settingsRedirect(request, { error: "invalid_state" });
  }
  if (!code) return settingsRedirect(request, { error: "missing_code" });

  try {
    const token = await exchangeAliExpressCode({ code });
    await saveAliExpressConnection(token);
    return settingsRedirect(request, { connected: "1" });
  } catch (error) {
    console.error("AliExpress OAuth callback failed:", error);
    return settingsRedirect(request, { error: "token_exchange_failed" });
  }
}
