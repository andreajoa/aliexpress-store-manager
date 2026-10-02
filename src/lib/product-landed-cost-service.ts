import { buildAliExpressImportCosting, aliExpressImportCostBreakdown } from "./aliexpress-import-costing";
import { getAliExpressOperationalProduct } from "./aliexpress-operational-provider";
import { prisma } from "./prisma";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function recalculateProductLandedCost(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: { orderBy: { createdAt: "asc" } },
      supplierProducts: {
        where: { provider: "ALIEXPRESS" },
        include: {
          variants: true,
          mappings: true,
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!product) throw new Error("Produto não encontrado.");

  const operational = await getAliExpressOperationalProduct(product.sourceProductId);
  const sourceProduct = operational.product;
  const skuPricing = sourceProduct.sku_pricing || [];
  const itemCurrency = (sourceProduct.currency || "USD").trim().toUpperCase();

  if (skuPricing.length === 0) {
    throw new Error("AliExpress não retornou SKUs com preço para recalcular o custo.");
  }

  const costing = await buildAliExpressImportCosting({
    productId: operational.resolvedProductId,
    skuPricing,
    itemCurrency,
  });

  if (!costing.complete) {
    throw new Error(
      costing.warning ||
      "O custo total ainda não pode ser confirmado porque o frete do AliExpress está pendente.",
    );
  }

  const bySku = new Map(
    costing.costedSkus.map((row) => [String(row.sku.sku_id), row]),
  );
  const sourceSku = new Map(
    skuPricing.map((sku) => [String(sku.sku_id), sku]),
  );

  for (const variant of product.variants) {
    if (!bySku.has(variant.sourceSkuId)) {
      throw new Error(
        `A variante ${variant.sourceSkuId} não foi encontrada no retorno atual do AliExpress.`,
      );
    }
  }

  const primarySupplier =
    product.supplierProducts.find((supplier) => supplier.role === "PRIMARY") ||
    product.supplierProducts[0] ||
    null;

  const refreshedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: product.id },
      data: {
        sourceCurrency: costing.costCurrency,
        costMin: costing.costMin,
        costMax: costing.costMax,
      },
    });

    for (const variant of product.variants) {
      const row = bySku.get(variant.sourceSkuId)!;
      const sku = sourceSku.get(variant.sourceSkuId);
      const currentRaw = asRecord(variant.rawPayload);

      await tx.productVariant.update({
        where: { id: variant.id },
        data: {
          costPrice: row.landedCost,
          sourceCurrency: costing.costCurrency,
          stock:
            typeof sku?.available_quantity === "number"
              ? Math.max(0, Math.floor(sku.available_quantity))
              : variant.stock,
          available:
            typeof sku?.available_quantity === "number"
              ? sku.available_quantity > 0
              : variant.available,
          rawPayload: {
            ...currentRaw,
            originalItemPrice: row.itemPrice,
            originalItemCurrency: row.itemCurrency,
            costBreakdown: aliExpressImportCostBreakdown(row, costing),
          },
        },
      });
    }

    if (primarySupplier) {
      await tx.supplierProduct.update({
        where: { id: primarySupplier.id },
        data: {
          sourceCurrency: costing.costCurrency,
          costMin: costing.costMin,
          costMax: costing.costMax,
          lastCheckedAt: refreshedAt,
        },
      });

      const supplierVariantBySku = new Map(
        primarySupplier.variants.map((variant) => [variant.sourceSkuId, variant]),
      );

      for (const [skuId, row] of bySku.entries()) {
        const supplierVariant = supplierVariantBySku.get(skuId);
        if (!supplierVariant) continue;
        const sku = sourceSku.get(skuId);

        await tx.supplierVariant.update({
          where: { id: supplierVariant.id },
          data: {
            sourcePrice: row.landedCost,
            stock:
              typeof sku?.available_quantity === "number"
                ? Math.max(0, Math.floor(sku.available_quantity))
                : supplierVariant.stock,
          },
        });
      }
    }
  });

  return {
    productId: product.id,
    sourceProductId: product.sourceProductId,
    operationalProvider: operational.provider,
    costCurrency: costing.costCurrency,
    costMin: costing.costMin,
    costMax: costing.costMax,
    variants: costing.costedSkus.map((row) => ({
      skuId: String(row.sku.sku_id),
      itemPrice: row.itemPrice,
      itemCurrency: row.itemCurrency,
      freight: row.freightCostInCostCurrency,
      landedCost: row.landedCost,
      costCurrency: row.costCurrency,
    })),
    recalculatedAt: refreshedAt,
  };
}
