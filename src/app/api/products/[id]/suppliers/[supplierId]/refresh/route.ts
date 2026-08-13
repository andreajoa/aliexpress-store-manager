import { NextResponse } from "next/server";

import { refreshSupplier } from "@/lib/supplier-refresh-service";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; supplierId: string }> },
) {
  try {
    const { id, supplierId } = await context.params;
    const result = await refreshSupplier({ productId: id, supplierId });

    return NextResponse.json({
      ok: true,
      ...result,
      refreshedAt: result.refreshedAt.toISOString(),
    });
  } catch (error) {
    console.error("Supplier refresh failed:", error);
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o fornecedor.";
    const status = message.includes("não encontrado") ? 404 : message.includes("não pode") || message.includes("não disponível") ? 422 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
