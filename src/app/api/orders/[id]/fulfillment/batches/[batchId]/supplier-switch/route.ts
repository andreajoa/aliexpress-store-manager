import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getFulfillmentSupplierSwitchCandidates,
  switchFulfillmentSupplier,
} from "@/lib/fulfillment-supplier-switch";

export const runtime = "nodejs";

const schema = z.object({
  confirm: z.literal(true),
  targetSupplierProductId: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional().nullable(),
}).strict();

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; batchId: string }> },
) {
  try {
    const { id, batchId } = await context.params;
    const result = await getFulfillmentSupplierSwitchCandidates(id, batchId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível avaliar fornecedores alternativos.";
    const status = message.includes("não encontrado") ? 404 : 409;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; batchId: string }> },
) {
  try {
    const { id, batchId } = await context.params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "A troca exige confirmação e um fornecedor alternativo válido." },
        { status: 400 },
      );
    }

    const result = await switchFulfillmentSupplier({
      orderId: id,
      batchId,
      targetSupplierProductId: parsed.data.targetSupplierProductId,
      reason: parsed.data.reason,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      switchedAt: result.switchedAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível trocar o fornecedor.";
    const status = message.includes("não encontrado") ? 404 : 409;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
