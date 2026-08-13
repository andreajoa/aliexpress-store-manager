import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { synchronizeOfficialAliExpressSkus } from "@/lib/aliexpress-sku-sync";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; supplierId: string }> },
) {
  try {
    const { id, supplierId } = await params;
    const supplier = await prisma.supplierProduct.findFirst({
      where: { id: supplierId, productId: id },
      select: { id: true },
    });
    if (!supplier) return NextResponse.json({ ok: false, error: "Fornecedor não encontrado." }, { status: 404 });

    const body = await request.json().catch(() => ({})) as {
      countryCode?: string;
      manualMappings?: Array<{ supplierVariantId: string; orderSkuAttr: string }>;
    };
    const countryCode = body.countryCode?.trim().toUpperCase();
    if (!countryCode) return NextResponse.json({ ok: false, error: "countryCode é obrigatório." }, { status: 400 });

    const result = await synchronizeOfficialAliExpressSkus({
      supplierProductId: supplierId,
      countryCode,
      manualMappings: Array.isArray(body.manualMappings) ? body.manualMappings : undefined,
    });
    return NextResponse.json({ ok: result.ready, result }, {
      status: result.ready ? 200 : 409,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Falha ao sincronizar SKUs oficiais." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
