export type PublishedProductLookup = {
  externalProductId: string;
  productId: string;
  sourceUrl: string;
  variants: Array<{
    id: string;
    sourceSkuId: string;
    attributes: unknown;
  }>;
};

export type ExternalOrderItemForResolution = {
  externalProductId: string;
  externalVariantId?: string | null;
  title: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
};

export type ResolvedOrderItem = {
  externalProductId: string;
  productId: string;
  variantId: string | null;
  sourceSkuId: string | null;
  sourceUrl: string;
  title: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  variantSnapshot: unknown | null;
};

export type OrderItemResolutionResult = {
  ready: boolean;
  items: ResolvedOrderItem[];
  blockers: Array<{
    code: "PRODUCT_NOT_PUBLISHED" | "VARIANT_REQUIRED" | "VARIANT_NOT_FOUND";
    externalProductId: string;
    externalVariantId?: string | null;
    detail: string;
  }>;
};

export function canonicalSourceSkuFromExternalVariantId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("sku-") ? trimmed.slice(4) : trimmed;
}

export function resolvePaidOrderItems(input: {
  items: ExternalOrderItemForResolution[];
  publishedProducts: PublishedProductLookup[];
}): OrderItemResolutionResult {
  const products = new Map(input.publishedProducts.map((product) => [product.externalProductId, product]));
  const resolved: ResolvedOrderItem[] = [];
  const blockers: OrderItemResolutionResult["blockers"] = [];

  for (const item of input.items) {
    const product = products.get(item.externalProductId);
    if (!product) {
      blockers.push({
        code: "PRODUCT_NOT_PUBLISHED",
        externalProductId: item.externalProductId,
        externalVariantId: item.externalVariantId,
        detail: "O externalProductId não corresponde a uma publicação PUBLISHED desta loja.",
      });
      continue;
    }

    if (product.variants.length === 0) {
      resolved.push({
        externalProductId: item.externalProductId,
        productId: product.productId,
        variantId: null,
        sourceSkuId: null,
        sourceUrl: product.sourceUrl,
        title: item.title,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalPriceCents: item.totalPriceCents,
        variantSnapshot: null,
      });
      continue;
    }

    const sourceSkuId = canonicalSourceSkuFromExternalVariantId(item.externalVariantId);
    if (!sourceSkuId) {
      blockers.push({
        code: "VARIANT_REQUIRED",
        externalProductId: item.externalProductId,
        externalVariantId: item.externalVariantId,
        detail: "O produto possui variantes; externalVariantId é obrigatório.",
      });
      continue;
    }

    const variant = product.variants.find((candidate) => candidate.sourceSkuId === sourceSkuId);
    if (!variant) {
      blockers.push({
        code: "VARIANT_NOT_FOUND",
        externalProductId: item.externalProductId,
        externalVariantId: item.externalVariantId,
        detail: `Nenhuma variante canônica possui sourceSkuId ${sourceSkuId}.`,
      });
      continue;
    }

    resolved.push({
      externalProductId: item.externalProductId,
      productId: product.productId,
      variantId: variant.id,
      sourceSkuId: variant.sourceSkuId,
      sourceUrl: product.sourceUrl,
      title: item.title,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalPriceCents,
      variantSnapshot: {
        externalVariantId: item.externalVariantId || null,
        sourceSkuId: variant.sourceSkuId,
        attributes: variant.attributes,
      },
    });
  }

  return {
    ready: blockers.length === 0 && resolved.length === input.items.length,
    items: blockers.length === 0 ? resolved : [],
    blockers,
  };
}
