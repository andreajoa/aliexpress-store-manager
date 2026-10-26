import { NextResponse } from "next/server";

import { refreshSupplier } from "@/lib/supplier-refresh-service";
import { parseSupplierRefreshOptions, SupplierRefreshInputError } from "@/lib/supplier-refresh-options";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; supplierId: string }> },
) {
  try {
    const { id, supplierId } = await context.params;
    const text = await request.text();
    let body: unknown = {};
    try {
      if (text.trim()) body = JSON.parse(text);
    } catch {
      throw new SupplierRefreshInputError("Corpo JSON inválido.");
    }
    const options = parseSupplierRefreshOptions(body);
    const result = await refreshSupplier({ productId: id, supplierId, ...options });

    return NextResponse.json({
      ok: true,
      ...result,
      refreshedAt: result.refreshedAt.toISOString(),
    });
  } catch (error) {
    console.error("Supplier refresh failed:", error);
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o fornecedor.";
    const status = error instanceof SupplierRefreshInputError ? error.status
      : message.includes("não encontrado") ? 404 : message.includes("não pode") || message.includes("não disponível") ? 422 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
