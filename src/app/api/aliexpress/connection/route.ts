import { NextResponse } from "next/server";

import {
  aliExpressConnectionStatus,
  aliExpressConfig,
  disconnectAliExpress,
} from "@/lib/aliexpress-connection";

export const runtime = "nodejs";

export async function GET() {
  let configured = true;
  try {
    aliExpressConfig();
  } catch {
    configured = false;
  }
  const status = await aliExpressConnectionStatus();
  return NextResponse.json({ ok: true, configured, ...status }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE() {
  await disconnectAliExpress();
  return NextResponse.json({ ok: true, disconnected: true }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
