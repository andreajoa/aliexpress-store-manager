import { NextRequest, NextResponse } from "next/server";

import { placeAliExpressBatchOrder } from "@/lib/aliexpress-fulfillment";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; batchId: string }> },
) {
  try {
    const { id, batchId } = await params;
    const body = await request.json().catch(() => ({})) as { logisticsServiceName?: string; confirm?: boolean };
    if (body.confirm !== true) {
      return NextResponse.json({ ok: false, error: "Confirmação explícita obrigatória." }, { status: 400 });
    }
    const result = await placeAliExpressBatchOrder({
      orderId: id,
      batchId,
      logisticsServiceName: body.logisticsServiceName || "",
    });
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Pedido AliExpress não criado." },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
