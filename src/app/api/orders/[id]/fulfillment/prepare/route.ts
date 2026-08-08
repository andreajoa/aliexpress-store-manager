import { NextResponse } from "next/server";
import { z } from "zod";

import { prepareOrderFulfillment } from "@/lib/order-fulfillment-service";

export const runtime = "nodejs";

const payloadSchema = z.object({ confirm: z.literal(true) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "A preparação exige confirmação explícita." },
        { status: 400 },
      );
    }

    const result = await prepareOrderFulfillment(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível preparar o fulfillment.";
    const status = message.includes("não encontrado") ? 404 : 409;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
