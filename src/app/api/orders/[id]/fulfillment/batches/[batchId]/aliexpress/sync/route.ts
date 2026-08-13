import { NextResponse } from "next/server";

import { syncAliExpressBatch } from "@/lib/aliexpress-fulfillment";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; batchId: string }> },
) {
  try {
    const { id, batchId } = await params;
    const result = await syncAliExpressBatch(id, batchId);
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Sincronização AliExpress falhou." },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
