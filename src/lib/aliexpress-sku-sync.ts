import { prisma } from "./prisma";
import { requireAliExpressSession } from "./aliexpress-connection";
import {
  suggestSupplierVariantMappings,
  validateManualVariantMapping,
  type SupplierVariantForMapping,
} from "./supplier-variant-mapper";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];
  return [value as T];
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type OfficialAliExpressSku = SupplierVariantForMapping & {
  orderSkuAttr: string;
};

export function officialSkusFromProductResponse(envelope: Record<string, unknown>) {
  const result = record(envelope.result);
  const baseInfo = record(result.ae_item_base_info_dto);
  const skuContainer = record(result.ae_item_sku_info_dtos);
  const rows = array<Record<string, unknown>>(skuContainer.ae_item_sku_info_d_t_o);

  const skus: OfficialAliExpressSku[] = rows.flatMap((row) => {
    const orderSkuAttr = text(row.id);
    if (!orderSkuAttr) return [];
    const propertyContainer = record(row.ae_sku_property_dtos);
    const properties = array<Record<string, unknown>>(propertyContainer.ae_sku_property_d_t_o);
    const attributes: Record<string, string> = {};
    const nameParts: string[] = [];
    for (const property of properties) {
      const name = text(property.sku_property_name) || `attr_${text(property.sku_property_id)}`;
      const value = text(property.property_value_definition_name) || text(property.sku_property_value);
      if (value) {
        attributes[name] = value;
        nameParts.push(value);
      }
    }
    const stock = numberOrNull(row.sku_available_stock ?? row.ipm_sku_stock);
    const price = numberOrNull(row.offer_sale_price ?? row.sku_price);
    return [{
      id: orderSkuAttr,
      orderSkuAttr,
      sourceSkuId: text(row.sku_code) || orderSkuAttr,
      name: nameParts.join(" / ") || orderSkuAttr,
      attributes,
      price,
      stock,
    }];
  });

  return {
    productId: text(baseInfo.product_id) || null,
    productStatus: text(baseInfo.product_status_type) || null,
    currency: text(baseInfo.currency_code) || null,
    skus,
  };
}

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
