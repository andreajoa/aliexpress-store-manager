import { prisma } from "./prisma";
import { requireAliExpressSession } from "./aliexpress-connection";
import { officialSkusFromProductResponse } from "./aliexpress-sku-parser";
import {
  suggestSupplierVariantMappings,
  validateManualVariantMapping,
} from "./supplier-variant-mapper";

export { officialSkusFromProductResponse } from "./aliexpress-sku-parser";

export async function synchronizeOfficialAliExpressSkus(input: {
  supplierProductId: string;
  countryCode: string;
  manualMappings?: Array<{ supplierVariantId: string; orderSkuAttr: string }>;
}) {
  const supplier = await prisma.supplierProduct.findUnique({
    where: { id: input.supplierProductId },
    include: { variants: { orderBy: { createdAt: "asc" } } },
  });
  if (!supplier) throw new Error("Fornecedor não encontrado.");
  if (supplier.provider !== "ALIEXPRESS") throw new Error("Este fornecedor não é AliExpress.");
  if (supplier.status !== "ACTIVE") throw new Error("Fornecedor inativo não pode ser sincronizado.");

  const { session, client } = await requireAliExpressSession();
  const envelope = await client.getDropshipProduct({
    session,
    productId: supplier.sourceProductId,
    shipToCountry: input.countryCode,
    targetCurrency: supplier.sourceCurrency || "USD",
    targetLanguage: "EN",
  });
  const official = officialSkusFromProductResponse(envelope);
  if (official.skus.length === 0) throw new Error("AliExpress não retornou SKUs oficiais para o produto.");

  const canonicalVariants = supplier.variants.map((variant) => ({
    id: variant.id,
    sourceSkuId: variant.sourceSkuId,
    name: variant.name,
    attributes: variant.attributes,
  }));

  let pairs: Array<{ supplierVariantId: string; orderSkuAttr: string }> = [];
  let report = suggestSupplierVariantMappings({
    canonicalVariants,
    supplierVariants: official.skus,
  });

  if (input.manualMappings) {
    const mappingInput = input.manualMappings.map((mapping) => ({
      canonicalVariantId: mapping.supplierVariantId,
      supplierVariantId: mapping.orderSkuAttr,
    }));
    const validation = validateManualVariantMapping({
      canonicalVariants,
      supplierVariants: official.skus,
      mappings: mappingInput,
    });
    if (!validation.valid) {
      return { ready: false, written: false, official, report, issues: validation.issues };
    }
    pairs = input.manualMappings;
  } else {
    const exactBySourceSku = new Map<string, typeof official.skus[number]>();
    for (const sku of official.skus) {
      for (const key of [sku.sourceSkuId, sku.orderSkuAttr]) {
        const normalized = key.trim();
        if (!normalized || exactBySourceSku.has(normalized)) continue;
        exactBySourceSku.set(normalized, sku);
      }
    }

    const exactPairs = canonicalVariants.flatMap((variant) => {
      const sourceSkuId = variant.sourceSkuId?.trim();
      if (!sourceSkuId) return [];
      const exact = exactBySourceSku.get(sourceSkuId);
      return exact
        ? [{ supplierVariantId: variant.id, orderSkuAttr: exact.orderSkuAttr }]
        : [];
    });
    const exactOrderAttrs = new Set(exactPairs.map((pair) => pair.orderSkuAttr));
    const exactReady =
      exactPairs.length === canonicalVariants.length &&
      exactOrderAttrs.size === exactPairs.length;

    if (exactReady) {
      pairs = exactPairs;
    } else {
      if (!report.readyForAutomaticConfirmation) {
        return {
          ready: false,
          written: false,
          official,
          report,
          issues: ["Correspondência de variantes exige revisão manual antes de habilitar compra automática."],
        };
      }
      pairs = report.suggestions.flatMap((suggestion) => suggestion.selected
        ? [{ supplierVariantId: suggestion.canonicalVariantId, orderSkuAttr: suggestion.selected.supplierVariantId }]
        : []);
    }
  }

  const officialByAttr = new Map(official.skus.map((sku) => [sku.orderSkuAttr, sku]));
  await prisma.$transaction(async (tx) => {
    for (const pair of pairs) {
      const officialSku = officialByAttr.get(pair.orderSkuAttr);
      if (!officialSku) throw new Error(`SKU oficial não encontrado: ${pair.orderSkuAttr}`);
      const price = officialSku.price;
      const stock = officialSku.stock;
      await tx.supplierVariant.update({
        where: { id: pair.supplierVariantId },
        data: {
          orderSkuAttr: officialSku.orderSkuAttr,
          ...(price != null ? { sourcePrice: price } : {}),
          ...(stock != null ? { stock: Math.max(0, Math.trunc(stock)) } : {}),
        },
      });
    }
    await tx.supplierProduct.update({
      where: { id: supplier.id },
      data: { lastCheckedAt: new Date() },
    });
  });

  report = suggestSupplierVariantMappings({ canonicalVariants, supplierVariants: official.skus });
  return { ready: true, written: true, official, report, issues: [] as string[] };
}
