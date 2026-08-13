import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  refreshSupplier,
  syncCanonicalAvailability,
} from "@/lib/supplier-refresh-service";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        supplierProducts: {
          where: { status: { not: "DISABLED" } },
          select: { id: true, role: true, priority: true },
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!product) {
      return NextResponse.json({ ok: false, error: "Produto não encontrado." }, { status: 404 });
    }

    const results: Array<{
      supplierId: string;
      ok: boolean;
      error?: string;
      mappingNeedsReview?: boolean;
      activeMappings?: number;
      expectedMappings?: number;
    }> = [];

    for (const supplier of product.supplierProducts) {
      try {
        const refreshed = await refreshSupplier({
          productId: id,
          supplierId: supplier.id,
          syncAvailability: false,
        });
        results.push({
          supplierId: supplier.id,
          ok: true,
          mappingNeedsReview: refreshed.mappingNeedsReview,
          activeMappings: refreshed.activeMappings,
          expectedMappings: refreshed.expectedMappings,
        });
      } catch (error) {
        results.push({
          supplierId: supplier.id,
          ok: false,
          error: error instanceof Error ? error.message : "Falha ao atualizar fornecedor.",
        });
      }
    }

    const availability = await syncCanonicalAvailability(id);
    const failed = results.filter((result) => !result.ok);

    return NextResponse.json({
      ok: failed.length === 0,
      partial: failed.length > 0 && failed.length < results.length,
      refreshedSuppliers: results.filter((result) => result.ok).length,
      failedSuppliers: failed.length,
      results,
      availability,
      refreshedAt: new Date().toISOString(),
    }, { status: failed.length === results.length && results.length > 0 ? 502 : 200 });
  } catch (error) {
    console.error("Refresh all suppliers failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Não foi possível atualizar fornecedores." },
      { status: 500 },
    );
  }
}
