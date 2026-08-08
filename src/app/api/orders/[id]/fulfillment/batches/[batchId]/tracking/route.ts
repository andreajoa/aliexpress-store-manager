import { NextResponse } from "next/server";
import { z } from "zod";

import { updateFulfillmentBatchTracking } from "@/lib/order-fulfillment-lifecycle";

export const runtime = "nodejs";

const schema = z.object({
  status: z.enum(["SHIPPED", "DELIVERED"]),
  trackingCode: z.string().trim().min(1).max(255).optional(),
  trackingUrl: z.string().trim().url().max(2000).optional().nullable(),
  carrier: z.string().trim().max(200).optional().nullable(),
}).strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; batchId: string }> },
) {
  try {
    const { id, batchId } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Informe status e rastreamento válidos." },
        { status: 400 },
      );
    }

    const result = await updateFulfillmentBatchTracking({
      orderId: id,
      batchId,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o rastreamento.";
    const status = message.includes("não encontrado") ? 404 : 409;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
