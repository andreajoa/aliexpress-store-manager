import { buildAliExpressImportCosting, unavailableScopedImportCosting } from "./aliexpress-import-costing";
import { supplierCostingSourceSkuIds, selectScopedCostingSkus } from "./supplier-costing-scope";
import { getAliExpressOperationalProduct } from "./aliexpress-operational-provider";
import { aliExpressProductIdAliases } from "./aliexpress-catalog-id";
import { calculateSaleSuggestion } from "./product-pricing";
import { parseSupplierRefreshOptions, SupplierRefreshInputError } from "./supplier-refresh-options";
import { prisma } from "./prisma";
import {
  canonicalVariantsForMapping,
  normalizeSupplierProduct,
} from "./supplier-catalog";
import { deriveCanonicalAvailability } from "./supplier-selection";
import { suggestSupplierVariantMappings } from "./supplier-variant-mapper";

// Large colour/size families need more than Prisma's default five seconds
// to commit all SKU changes through the Neon adapter. Keep the writes atomic.
const supplierTransactionOptions = { timeout: 30_000 };

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
    supplierTransactionOptions,
  );

  return availability;
}

export async function refreshSupplier(input: {
  productId: string;
  supplierId: string;
  syncAvailability?: boolean;
  dryRun?: boolean;
  sourceSkuIds?: string[];
}) {
  const options = parseSupplierRefreshOptions({
    dryRun: input.dryRun,
    sourceSkuIds: input.sourceSkuIds,
  });
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

  /*
   * A atualização de estoque usa a mesma cadeia redundante do import.
   * Se todas as fontes externas falharem, esta função lança antes da transação:
   * o último estoque conhecido permanece intacto em vez de ser zerado por engano.
   */
  const costingScope = options.dryRun ? null : supplierCostingSourceSkuIds(supplier.rawPayload);
  const operational = await getAliExpressOperationalProduct(
    supplier.sourceProductId,
    options.dryRun ? { readOnlySession: true, officialOnly: true } : costingScope ? { officialOnly: true } : undefined,
  );
  const requestedSkus = options.sourceSkuIds ? new Set(options.sourceSkuIds) : null;
  if ((options.dryRun || costingScope) && operational.provider !== "ALIEXPRESS_OPEN_PLATFORM") {
    throw new SupplierRefreshInputError("A cotação dryRun exige dados da fonte oficial.", 422);
  }
  const allSkus = operational.product.sku_pricing || [];
  if (requestedSkus) {
    const known = new Set(allSkus.map((sku) => String(sku.sku_id)));
    const missing = [...requestedSkus].filter((sku) => !known.has(sku));
    if (missing.length) {
      throw new SupplierRefreshInputError(`SKUs ausentes na fonte oficial: ${missing.join(", ")}.`);
    }
  }
  const quotedSkus = requestedSkus ? allSkus.filter((sku) => requestedSkus.has(String(sku.sku_id))) : allSkus;
  const rawSnapshot = normalizeSupplierProduct({ ...operational.product, sku_pricing: quotedSkus });
  if (options.dryRun) {
    const aliases = aliExpressProductIdAliases(supplier.sourceProductId);
    if (!aliases.includes(rawSnapshot.sourceProductId) || !aliases.includes(operational.resolvedProductId)) {
      throw new SupplierRefreshInputError("A fonte retornou outro produto; cotação bloqueada.", 422);
    }
    if (quotedSkus.some((sku) => typeof sku.available_quantity !== "number" || !Number.isInteger(sku.available_quantity) || sku.available_quantity < 0)) {
      throw new SupplierRefreshInputError("A fonte não retornou estoque verificável para todos os SKUs cotados.", 422);
    }
  }
  const scoped = costingScope ? selectScopedCostingSkus(quotedSkus, costingScope) : null;
  const itemCurrency = (operational.product.currency || rawSnapshot.sourceCurrency || "USD").toUpperCase();
  const scopedSoldOut = Boolean(scoped && scoped.available.length === 0);
  const costing = scopedSoldOut ? unavailableScopedImportCosting({ skuPricing: scoped!.rows, itemCurrency }) : await buildAliExpressImportCosting({
    productId: operational.resolvedProductId,
    skuPricing: scoped ? scoped.available : quotedSkus,
    itemCurrency,
    ...(options.dryRun ? { readOnlySession: true } : {}),
  });

  if (costingScope && (costing.costCurrency !== "USD" || costing.snapshot.countryCode !== "US")) {
    throw new SupplierRefreshInputError("O escopo de custo exige cotação oficial US/USD.", 422);
  }
  if (!costing.complete && !scopedSoldOut) {
    throw new Error(
      costing.warning ||
      "Atualização bloqueada: o custo total (produto + frete) ainda não foi confirmado.",
    );
  }

  const landedBySku = new Map(
    costing.costedSkus.map((row) => [String(row.sku.sku_id), row.landedCost]),
  );

  if (options.dryRun) {
    const costs = new Map(costing.costedSkus.map((row) => [String(row.sku.sku_id), row]));
    const validCost = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0;
    if (
      costing.snapshot.status !== "COMPLETE" || costing.snapshot.freight.status !== "AVAILABLE" ||
      costs.size !== quotedSkus.length || costing.costedSkus.length !== quotedSkus.length ||
      rawSnapshot.variants.some((variant) => {
        const row = costs.get(variant.sourceSkuId);
        return !row || !validCost(row.landedCost) || !validCost(row.itemCostInCostCurrency) ||
          !validCost(row.freightCostInCostCurrency) || row.costCurrency !== costing.costCurrency;
      })
    ) {
      throw new SupplierRefreshInputError("Cotação incompleta: todos os SKUs exigem custo do item e frete confirmados.", 422);
    }
    const selectedCanonical = requestedSkus
      ? product.variants.filter((variant) => variant.sourceSkuId && requestedSkus.has(variant.sourceSkuId))
      : product.variants;
    const quotedVariants = rawSnapshot.variants.map((variant) => {
      const row = costs.get(variant.sourceSkuId)!;
      const landedCost = row.landedCost!;
      const officialSkuAttrs = operational.product.official_sku_attrs as Record<string, unknown> | undefined;
      return {
        sourceSkuId: variant.sourceSkuId,
        name: variant.name,
        attributes: variant.attributes,
        imageUrl: variant.imageUrl,
        orderSkuAttr: typeof officialSkuAttrs?.[variant.sourceSkuId] === "string"
          ? officialSkuAttrs[variant.sourceSkuId] as string : null,
        stock: variant.stock,
        available: variant.stock > 0,
        itemPrice: row.itemPrice,
        itemCurrency: row.itemCurrency,
        itemCostInCostCurrency: row.itemCostInCostCurrency,
        freightCostInCostCurrency: row.freightCostInCostCurrency,
        freightServiceName: costing.snapshot.perSku?.find((sku) => sku.skuId === variant.sourceSkuId)?.freightServiceName
          ?? costing.snapshot.freight.selectedServiceName,
        landedCost,
        costCurrency: costing.costCurrency,
        countryCode: costing.snapshot.countryCode,
        verifiedAt: costing.snapshot.calculatedAt,
        minimumRetail3x: Math.round(landedCost * 300) / 100,
        suggestedRetail3x90: landedCost > 0 ? calculateSaleSuggestion({
          cost: landedCost, sourceCurrency: costing.costCurrency, sellingCurrency: costing.costCurrency,
          multiplier: 3, reservePercent: 0, ending: "90",
        }).suggestedPrice : null,
      };
    });
    return {
      dryRun: true as const,
      persisted: false as const,
      supplierId: supplier.id,
      sourceProductId: rawSnapshot.sourceProductId,
      requestedProductId: operational.requestedProductId,
      resolvedProductId: operational.resolvedProductId,
      operationalProvider: operational.provider,
      warnings: operational.warnings,
      refreshedAt: new Date(costing.snapshot.calculatedAt),
      variants: quotedVariants.length,
      quotedSkus: quotedVariants,
      costSnapshot: costing.snapshot,
      suggestedMapping: suggestSupplierVariantMappings({
        canonicalVariants: canonicalVariantsForMapping(selectedCanonical),
        supplierVariants: rawSnapshot.variants.map((variant) => ({
          ...variant, price: costs.get(variant.sourceSkuId)!.landedCost,
        })),
      }),
    };
  }

  const snapshot = {
    ...rawSnapshot,
    sourceCurrency: costing.costCurrency,
    costMin: costing.costMin,
    costMax: costing.costMax,
    variants: rawSnapshot.variants.map((variant) => ({
      ...variant,
      price: landedBySku.get(variant.sourceSkuId) ?? null,
      sourcePrice: landedBySku.get(variant.sourceSkuId) ?? null,
    })),
  };

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
        rawPayload: JSON.parse(JSON.stringify({
          operationalProvider: operational.provider,
          operationalWarnings: operational.warnings,
          product: snapshot.rawPayload,
          ...(costingScope ? { costingSourceSkuIds: costingScope, costSnapshot: costing.snapshot } : {}),
        })),
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
              operationalProvider: operational.provider,
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
  }, supplierTransactionOptions);

  const activeMappings = result.mappings.filter((mapping) => mapping.active).length;
  const availability = input.syncAvailability === false
    ? null
    : await syncCanonicalAvailability(input.productId);

  return {
    supplierId: supplier.id,
    operationalProvider: operational.provider,
    warnings: operational.warnings,
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
