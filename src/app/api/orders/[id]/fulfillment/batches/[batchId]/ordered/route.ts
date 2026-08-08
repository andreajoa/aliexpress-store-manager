import { NextResponse } from "next/server";
import { z } from "zod";

import { markFulfillmentBatchOrdered } from "@/lib/order-fulfillment-lifecycle";

export const runtime = "nodejs";

const schema = z.object({
  confirm: z.literal(true),
  externalOrderId: z.string().trim().min(1).max(255),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; batchId: string }> },
) {
  try {
    const { id, batchId } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Confirme e informe o número do pedido realizado no fornecedor." },
        { status: 400 },
      );
    }

    const result = await markFulfillmentBatchOrdered({
      orderId: id,
      batchId,
      externalOrderId: parsed.data.externalOrderId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível registrar o pedido externo.";
    const status = message.includes("não encontrado") ? 404 : 409;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
