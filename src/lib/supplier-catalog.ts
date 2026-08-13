import type { OmkarProduct, OmkarVariantGroup } from "./omkar";
import type {
  CanonicalVariantForMapping,
  SupplierVariantForMapping,
} from "./supplier-variant-mapper";

export type NormalizedSupplierVariant = SupplierVariantForMapping & {
  sourcePrice: number | null;
  stock: number;
  imageUrl: string | null;
};

export type SupplierSnapshot = {
  provider: "ALIEXPRESS";
  sourceProductId: string;
  sourceUrl: string;
  title: string;
  sellerId: string | null;
  sellerName: string | null;
  sourceCurrency: string | null;
  costMin: number | null;
  costMax: number | null;
  variants: NormalizedSupplierVariant[];
  rawPayload: OmkarProduct;
};

function finitePrice(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : null;
}

function optionMap(groups: OmkarVariantGroup[]) {
  const result = new Map<
    string,
    { attributeName: string; optionName: string; imageUrl: string | null }
  >();

  for (const group of groups) {
    for (const option of group.options || []) {
      result.set(String(option.value_id), {
        attributeName: group.attribute_name || "Variant",
        optionName: option.name || String(option.value_id),
        imageUrl: option.image_url || option.thumbnail_url || null,
      });
    }
  }

  return result;
}

function skuAttributes(
  variantIds: string,
  map: ReturnType<typeof optionMap>,
) {
  const attributes: Record<string, string> = {};

  for (const id of variantIds.split(",").map((item) => item.trim()).filter(Boolean)) {
    const option = map.get(id);
    if (option) {
      attributes[option.attributeName] = option.optionName;
    } else {
      attributes[`variant_${id}`] = id;
    }
  }

  return attributes;
}

function skuImage(
  variantIds: string,
  map: ReturnType<typeof optionMap>,
) {
  for (const id of variantIds.split(",").map((item) => item.trim()).filter(Boolean)) {
    const image = map.get(id)?.imageUrl;
    if (image) return image;
  }
  return null;
}

function variantName(attributes: Record<string, string>, fallback: string) {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return fallback;
  return entries.map(([key, value]) => `${key}: ${value}`).join(" · ");
}

export function normalizeSupplierProduct(omkar: OmkarProduct): SupplierSnapshot {
  const groups = omkar.variants || [];
  const map = optionMap(groups);
  const skuPricing = omkar.sku_pricing || [];

  if (skuPricing.length === 0) {
    throw new Error("O fornecedor não retornou variantes/SKUs utilizáveis.");
  }

  const variants: NormalizedSupplierVariant[] = skuPricing.map((sku, index) => {
    const ids = sku.variant_ids || "";
    const attributes = skuAttributes(ids, map);
    return {
      id: `supplier-${String(sku.sku_id)}`,
      sourceSkuId: String(sku.sku_id),
      name: variantName(attributes, `SKU ${index + 1}`),
      attributes,
      price: finitePrice(sku.sale_price),
      sourcePrice: finitePrice(sku.sale_price),
      stock:
        typeof sku.available_quantity === "number" && Number.isFinite(sku.available_quantity)
          ? Math.max(0, Math.trunc(sku.available_quantity))
          : 0,
      imageUrl: skuImage(ids, map),
    };
  });

  const skuIds = variants.map((variant) => variant.sourceSkuId);
  if (new Set(skuIds).size !== skuIds.length) {
    throw new Error("O fornecedor retornou SKUs duplicados; cadastro bloqueado.");
  }

  const validPrices = variants
    .map((variant) => variant.sourcePrice)
    .filter((value): value is number => value !== null);

  return {
    provider: "ALIEXPRESS",
    sourceProductId: String(omkar.id),
    sourceUrl: omkar.listing_url || `https://www.aliexpress.com/item/${String(omkar.id)}.html`,
    title: omkar.title,
    sellerId: omkar.seller?.id ? String(omkar.seller.id) : null,
    sellerName: omkar.seller?.name || null,
    sourceCurrency: omkar.currency?.toUpperCase() || null,
    costMin: validPrices.length ? Math.min(...validPrices) : null,
    costMax: validPrices.length ? Math.max(...validPrices) : null,
    variants,
    rawPayload: omkar,
  };
}

export function canonicalVariantsForMapping(
  variants: Array<{
    id: string;
    sourceSkuId?: string | null;
    attributes: unknown;
  }>,
): CanonicalVariantForMapping[] {
  return variants.map((variant, index) => {
    const attributes =
      variant.attributes && typeof variant.attributes === "object" && !Array.isArray(variant.attributes)
        ? variant.attributes as Record<string, unknown>
        : {};
    const name = Object.entries(attributes)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(" · ") || `Variante ${index + 1}`;

    return {
      id: variant.id,
      sourceSkuId: variant.sourceSkuId || null,
      name,
      attributes,
    };
  });
}
