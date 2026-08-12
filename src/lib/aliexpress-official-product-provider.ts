import { officialSkusFromProductResponse } from "./aliexpress-sku-parser";
import type {
  OmkarProduct,
  OmkarSkuPricing,
  OmkarVariantGroup,
} from "./omkar";

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

function normalizeUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const normalized = candidate.startsWith("//") ? `https:${candidate}` : candidate;
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function uniqueUrls(values: unknown[]) {
  return Array.from(new Set(values.map(normalizeUrl).filter((value): value is string => Boolean(value))));
}

function optionKey(attributeName: string, optionValue: string) {
  return `${attributeName}:${optionValue}`;
}

function variantGroupsFromOfficialSkus(
  skus: ReturnType<typeof officialSkusFromProductResponse>["skus"],
): OmkarVariantGroup[] {
  const groups = new Map<string, Map<string, { valueId: string; name: string; imageUrl: string | null }>>();

  for (const sku of skus) {
    for (const [attributeName, optionName] of Object.entries(sku.attributes)) {
      if (!optionName) continue;
      const options = groups.get(attributeName) || new Map();
      const valueId = optionKey(attributeName, optionName);
      if (!options.has(optionName)) {
        options.set(optionName, { valueId, name: optionName, imageUrl: null });
      }
      groups.set(attributeName, options);
    }
  }

  return Array.from(groups.entries()).map(([attributeName, options]) => ({
    attribute_name: attributeName,
    attribute_id: attributeName,
    has_color: /color|colour|cor/i.test(attributeName),
    is_size: /size|tamanho/i.test(attributeName),
    options: Array.from(options.values()).map((option) => ({
      value_id: option.valueId,
      name: option.name,
      image_url: option.imageUrl,
      thumbnail_url: option.imageUrl,
    })),
  }));
}

export function officialDropshipProductToOperationalProduct(
  envelope: Record<string, unknown>,
  requestedProductId: string,
): OmkarProduct {
  const result = record(envelope.result);
  const base = record(result.ae_item_base_info_dto);
  const multimedia = record(result.ae_multimedia_info_dto);
  const store = record(result.ae_store_info);
  const packageInfo = record(result.package_info_dto);
  const official = officialSkusFromProductResponse(envelope);

  const productId = text(base.product_id) || official.productId || requestedProductId;
  if (productId !== requestedProductId) {
    throw new Error(`AliExpress Open Platform retornou Product ID ${productId}, diferente de ${requestedProductId}.`);
  }

  const title = text(base.subject);
  if (!title) throw new Error("AliExpress Open Platform retornou produto sem título.");
  if (official.skus.length === 0) throw new Error("AliExpress Open Platform retornou produto sem SKUs oficiais.");

  const imageUrls = text(multimedia.image_urls)
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
  const videos = record(multimedia.ae_video_dtos);
  const firstVideo = array<Record<string, unknown>>(videos.ae_video_d_t_o)[0];
  const videoUrl = normalizeUrl(firstVideo?.media_url || firstVideo?.video_url);
  const images = uniqueUrls(imageUrls);

  const skuPricing: OmkarSkuPricing[] = official.skus.map((sku) => {
    if (sku.price === null || sku.stock === null) {
      throw new Error(`SKU oficial ${sku.orderSkuAttr} sem preço ou estoque verificável.`);
    }
    const variantIds = Object.entries(sku.attributes)
      .filter(([, value]) => Boolean(value))
      .map(([name, value]) => optionKey(name, value))
      .join(",");

    return {
      sku_id: sku.sourceSkuId,
      variant_ids: variantIds,
      list_price: sku.price,
      sale_price: sku.price,
      formatted_sale_price: null,
      discount_label: null,
      available_quantity: Math.max(0, Math.trunc(sku.stock)),
      order_sku_attr: sku.orderSkuAttr,
    };
  });

  const currency = (official.currency || text(base.currency_code) || "USD").toUpperCase();
  const categoryId = text(base.category_id) || null;
  const packageLength = numberOrNull(packageInfo.package_length);
  const packageWidth = numberOrNull(packageInfo.package_width);
  const packageHeight = numberOrNull(packageInfo.package_height);
  const packageWeight = numberOrNull(packageInfo.gross_weight);

  return {
    id: productId,
    title,
    category_id: categoryId,
    listing_url: `https://www.aliexpress.com/item/${productId}.html`,
    images,
    images_hd: images,
    video_url: videoUrl,
    package: {
      length_cm: packageLength,
      width_cm: packageWidth,
      height_cm: packageHeight,
      weight_kg: packageWeight,
    },
    currency,
    base_currency: currency,
    variants: variantGroupsFromOfficialSkus(official.skus),
    sku_pricing: skuPricing,
    seller: {
      name: text(store.store_name) || null,
      id: text(store.store_id) || text(base.owner_member_seq_long) || null,
      logo_url: normalizeUrl(store.store_logo),
    },
    has_welcome_deal: null,
    operational_provider: "ALIEXPRESS_OPEN_PLATFORM",
    official_product_status: official.productStatus,
    official_response: envelope,
  };
}
