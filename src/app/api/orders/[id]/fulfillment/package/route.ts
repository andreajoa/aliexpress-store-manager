import { NextResponse } from "next/server";

import { getOrderFulfillmentPackage } from "@/lib/order-fulfillment-service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const fulfillmentPackage = await getOrderFulfillmentPackage(id);
    return NextResponse.json({ ok: true, package: fulfillmentPackage });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pacote de fulfillment indisponível.";
    const status = message.includes("não encontrado") ? 404 : 409;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
