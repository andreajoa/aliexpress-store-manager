import { getOmkarProduct } from "./omkar";
import { prisma } from "./prisma";
import {
  canonicalVariantsForMapping,
  normalizeSupplierProduct,
} from "./supplier-catalog";
import { deriveCanonicalAvailability } from "./supplier-selection";
import { suggestSupplierVariantMappings } from "./supplier-variant-mapper";

function reservationMap(rows: Array<{ fulfillmentSupplierVariantId: string | null; quantity: number }>) {
  const result = new Map<string, number>();
  for (const row of rows) {
    if (!row.fulfillmentSupplierVariantId) continue;
    result.set(
      row.fulfillmentSupplierVariantId,
      (result.get(row.fulfillmentSupplierVariantId) || 0) + row.quantity,
    );
  }
  return result;
}

export async function syncCanonicalAvailability(productId: string) {
  const now = new Date();
  const [product, reservationRows, checkoutReservationRows] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { select: { id: true } },
        supplierProducts: {
          include: {
            mappings: {
              include: { supplierVariant: true },
            },
          },
        },
      },
    }),
    prisma.orderItem.findMany({
      where: {
        productId,
        fulfillmentSupplierVariantId: { not: null },
        OR: [
          { fulfillmentBatch: { status: { in: ["PROCESSING", "ORDERED"] } } },
          {
            fulfillmentBatchId: null,
            order: {
              paymentStatus: "PAID",
              fulfillmentStatus: "UNFULFILLED",
              status: "PAID",
            },
          },
        ],
      },
      select: { fulfillmentSupplierVariantId: true, quantity: true },
    }),
    prisma.inventoryReservationItem.findMany({
      where: {
        productId,
        reservation: { status: "ACTIVE", expiresAt: { gt: now } },
      },
      select: { supplierVariantId: true, quantity: true },
    }),
  ]);

  if (!product) throw new Error("Produto não encontrado para sincronizar disponibilidade.");
  const reserved = reservationMap(reservationRows);
  for (const row of checkoutReservationRows) {
    reserved.set(
      row.supplierVariantId,
      (reserved.get(row.supplierVariantId) || 0) + row.quantity,
    );
  }

  const availability = deriveCanonicalAvailability({
    canonicalVariantIds: product.variants.map((variant) => variant.id),
    suppliers: product.supplierProducts.map((supplier) => ({
      id: supplier.id,
      role: supplier.role,
      priority: supplier.priority,
      status: supplier.status,
      sourceCurrency: supplier.sourceCurrency,
      lastCheckedAt: supplier.lastCheckedAt,
      mappings: supplier.mappings.map((mapping) => ({
        canonicalVariantId: mapping.canonicalVariantId,
        active: mapping.active,
        supplierVariant: {
          id: mapping.supplierVariant.id,
          sourceSkuId: mapping.supplierVariant.sourceSkuId,
          sourcePrice: mapping.supplierVariant.sourcePrice
            ? Number(mapping.supplierVariant.sourcePrice.toString())
            : null,
          stock: Math.max(
            0,
            mapping.supplierVariant.stock - (reserved.get(mapping.supplierVariant.id) || 0),
          ),
        },
      })),
    })),
  });

  await prisma.$transaction(
    availability.map((item) =>
      prisma.productVariant.update({
        where: { id: item.canonicalVariantId },
        data: {
          stock: item.safeStock,
          available: item.available,
        },
      }),
    ),
  );

  return availability;
}

export async function refreshSupplier(input: {
  productId: string;
  supplierId: string;
  syncAvailability?: boolean;
}) {
  const [product, supplier] = await Promise.all([
    prisma.product.findUnique({
      where: { id: input.productId },
      include: { variants: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.supplierProduct.findFirst({
      where: { id: input.supplierId, productId: input.productId },
      include: { variants: true, mappings: true },
    }),
  ]);

  if (!product || !supplier) {
    throw new Error("Produto ou fornecedor não encontrado.");
  }
  if (supplier.status === "DISABLED") {
    throw new Error("Fornecedor desativado não pode ser atualizado automaticamente.");
  }
  if (supplier.provider !== "ALIEXPRESS") {
    throw new Error(`Refresh automático ainda não disponível para ${supplier.provider}.`);
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
  const refreshedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    await tx.supplierProduct.update({
      where: { id: supplier.id },
      data: {
        sourceUrl: snapshot.sourceUrl,
        sellerId: snapshot.sellerId,
        sellerName: snapshot.sellerName,
        sourceCurrency: snapshot.sourceCurrency,
        costMin: snapshot.costMin,
        costMax: snapshot.costMax,
        rawPayload: JSON.parse(JSON.stringify(snapshot.rawPayload)),
        lastCheckedAt: refreshedAt,
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
            supplierProductId: supplier.id,
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
        where: { supplierProductId: supplier.id, supplierVariantId: { in: missingIds } },
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
            supplierProductId: supplier.id,
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
            verifiedAt: refreshedAt,
          }];
        }),
      });
    }

    return tx.supplierProduct.findUniqueOrThrow({
      where: { id: supplier.id },
      include: { variants: true, mappings: true },
    });
  });

  const activeMappings = result.mappings.filter((mapping) => mapping.active).length;
  const availability = input.syncAvailability === false
    ? null
    : await syncCanonicalAvailability(input.productId);

  return {
    supplierId: supplier.id,
    refreshedAt: result.lastCheckedAt || refreshedAt,
    variants: result.variants.length,
    activeMappings,
    expectedMappings: product.variants.length,
    mappingNeedsReview: activeMappings !== product.variants.length,
    disappearedSkus: disappeared.map((variant) => variant.sourceSkuId),
    suggestedMapping: report,
    availability,
  };
}
