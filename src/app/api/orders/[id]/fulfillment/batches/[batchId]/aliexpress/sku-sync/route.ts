import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { synchronizeOfficialAliExpressSkus } from "@/lib/aliexpress-sku-sync";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; batchId: string }> },
) {
  try {
    const { id, batchId } = await params;
    const batch = await prisma.fulfillmentBatch.findFirst({
      where: { id: batchId, orderId: id },
      include: { order: { include: { shippingAddress: true } } },
    });
    if (!batch?.supplierProductId) throw new Error("Lote sem fornecedor vinculado.");
    const countryCode = batch.order.shippingAddress?.countryCode?.trim().toUpperCase();
    if (!countryCode) throw new Error("Pedido sem país de entrega.");

    const result = await synchronizeOfficialAliExpressSkus({
      supplierProductId: batch.supplierProductId,
      countryCode,
    });
    return NextResponse.json({ ok: result.ready, result }, {
      status: result.ready ? 200 : 409,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "SKU oficial não sincronizado." },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
