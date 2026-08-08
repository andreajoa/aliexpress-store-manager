import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getOmkarProduct } from "@/lib/omkar";
import {
  canonicalVariantsForMapping,
  normalizeSupplierProduct,
} from "@/lib/supplier-catalog";
import { suggestSupplierVariantMappings } from "@/lib/supplier-variant-mapper";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; supplierId: string }> },
) {
  try {
    const { id, supplierId } = await context.params;

    const [product, supplier] = await Promise.all([
      prisma.product.findUnique({
        where: { id },
        include: { variants: { orderBy: { createdAt: "asc" } } },
      }),
      prisma.supplierProduct.findFirst({
        where: { id: supplierId, productId: id },
        include: {
          variants: true,
          mappings: true,
        },
      }),
    ]);

    if (!product || !supplier) {
      return NextResponse.json(
        { ok: false, error: "Produto ou fornecedor não encontrado." },
        { status: 404 },
      );
    }

    if (supplier.provider !== "ALIEXPRESS") {
      return NextResponse.json(
        { ok: false, error: `Refresh automático ainda não disponível para ${supplier.provider}.` },
        { status: 422 },
      );
    }

    const omkar = await getOmkarProduct(supplier.sourceProductId);
    const snapshot = normalizeSupplierProduct(omkar);
    const canonicalVariants = canonicalVariantsForMapping(product.variants);
    const report = suggestSupplierVariantMappings({
      canonicalVariants,
      supplierVariants: snapshot.variants,
    });

    const previousBySku = new Map(supplier.variants.map((variant) => [variant.sourceSkuId, variant]));
    const currentSkuIds = new Set(snapshot.variants.map((variant) => variant.sourceSkuId));
    const disappeared = supplier.variants.filter((variant) => !currentSkuIds.has(variant.sourceSkuId));

    const result = await prisma.$transaction(async (tx) => {
      await tx.supplierProduct.update({
        where: { id: supplierId },
        data: {
          sourceUrl: snapshot.sourceUrl,
          sellerId: snapshot.sellerId,
          sellerName: snapshot.sellerName,
          sourceCurrency: snapshot.sourceCurrency,
          costMin: snapshot.costMin,
          costMax: snapshot.costMax,
          rawPayload: JSON.parse(JSON.stringify(snapshot.rawPayload)),
          lastCheckedAt: new Date(),
        },
      });

      const resolvedVariantIds = new Map<string, string>();

      for (const incoming of snapshot.variants) {
        const existing = previousBySku.get(incoming.sourceSkuId);
        if (existing) {
          const updated = await tx.supplierVariant.update({
            where: { id: existing.id },
            data: {
              name: incoming.name,
              sourcePrice: incoming.sourcePrice,
              stock: incoming.stock,
              attributes: JSON.parse(JSON.stringify(incoming.attributes || {})),
              imageUrl: incoming.imageUrl,
            },
          });
          resolvedVariantIds.set(incoming.sourceSkuId, updated.id);
        } else {
          const created = await tx.supplierVariant.create({
            data: {
              supplierProductId: supplierId,
              sourceSkuId: incoming.sourceSkuId,
              name: incoming.name,
              sourcePrice: incoming.sourcePrice,
              stock: incoming.stock,
              attributes: JSON.parse(JSON.stringify(incoming.attributes || {})),
              imageUrl: incoming.imageUrl,
            },
          });
          resolvedVariantIds.set(incoming.sourceSkuId, created.id);
        }
      }

      if (disappeared.length > 0) {
        const missingIds = disappeared.map((variant) => variant.id);
        await tx.supplierVariant.updateMany({
          where: { id: { in: missingIds } },
          data: { stock: 0 },
        });
        await tx.supplierVariantMapping.updateMany({
          where: { supplierProductId: supplierId, supplierVariantId: { in: missingIds } },
          data: { active: false },
        });
      }

      if (supplier.mappings.length === 0 && report.readyForAutomaticConfirmation) {
        await tx.supplierVariantMapping.createMany({
          data: report.suggestions.flatMap((suggestion) => {
            const selected = suggestion.selected;
            if (!selected) return [];
            const supplierVariantId = resolvedVariantIds.get(selected.supplierSourceSkuId);
            if (!supplierVariantId) return [];
            return [{
              supplierProductId: supplierId,
              supplierVariantId,
              canonicalVariantId: suggestion.canonicalVariantId,
              confidence: selected.confidence,
              method: "AUTO" as const,
              evidence: {
                source: "supplier-refresh",
                reasons: selected.reasons,
                sourceSkuId: selected.supplierSourceSkuId,
              },
              active: true,
              verifiedAt: new Date(),
            }];
          }),
        });
      }

      return tx.supplierProduct.findUniqueOrThrow({
        where: { id: supplierId },
        include: { variants: true, mappings: true },
      });
    });

    const activeMappings = result.mappings.filter((mapping) => mapping.active).length;

    return NextResponse.json({
      ok: true,
      supplierId,
      refreshedAt: result.lastCheckedAt?.toISOString() || new Date().toISOString(),
      variants: result.variants.length,
      activeMappings,
      expectedMappings: product.variants.length,
      mappingNeedsReview: activeMappings !== product.variants.length,
      disappearedSkus: disappeared.map((variant) => variant.sourceSkuId),
      suggestedMapping: report,
    });
  } catch (error) {
    console.error("Supplier refresh failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Não foi possível atualizar o fornecedor." },
      { status: 500 },
    );
  }
}
