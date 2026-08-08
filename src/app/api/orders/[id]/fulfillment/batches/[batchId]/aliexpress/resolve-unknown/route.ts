import { NextRequest, NextResponse } from "next/server";

import { clearUnknownAliExpressPlacement } from "@/lib/aliexpress-fulfillment";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; batchId: string }> },
) {
  try {
    const { id, batchId } = await params;
    const body = await request.json().catch(() => ({})) as { confirmedNoOrderExists?: boolean };
    const result = await clearUnknownAliExpressPlacement({
      orderId: id,
      batchId,
      confirmedNoOrderExists: body.confirmedNoOrderExists === true,
    });
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Tentativa não liberada." },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
