import { officialSkusFromProductResponse } from "./aliexpress-sku-parser.ts";
import type {
  OmkarProduct,
  OmkarSkuPricing,
  OmkarVariantGroup,
} from "./omkar.ts";

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

function stringAttributes(value: unknown): Record<string, string> {
  const source = record(value);
  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(source)) {
    const normalized = text(rawValue);
    if (normalized) result[key] = normalized;
  }
  return result;
}

function optionKey(attributeName: string, optionValue: string) {
  return `${attributeName}:${optionValue}`;
}

function valueShape(value: unknown) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return "null";
  return typeof value;
}

function safeResponseShape(envelope: Record<string, unknown>) {
  const result = record(envelope.result);
  const skuContainer = result.ae_item_sku_info_dtos;
  const skuRecord = record(skuContainer);
  const wrappedRows = skuRecord.ae_item_sku_info_d_t_o;
  const firstRow = Array.isArray(wrappedRows)
    ? wrappedRows[0]
    : wrappedRows && typeof wrappedRows === "object"
      ? wrappedRows
      : Array.isArray(skuContainer)
        ? skuContainer[0]
        : undefined;

  return [
    `envelopeKeys=${Object.keys(envelope).sort().join(",") || "none"}`,
    `resultKeys=${Object.keys(result).sort().join(",") || "none"}`,
    `skuContainer=${valueShape(skuContainer)}`,
    `skuContainerKeys=${Object.keys(skuRecord).sort().join(",") || "none"}`,
    `wrappedRows=${valueShape(wrappedRows)}`,
    `firstSkuKeys=${Object.keys(record(firstRow)).sort().join(",") || "none"}`,
  ].join(" | ");
}

function variantGroupsFromOfficialSkus(
  skus: ReturnType<typeof officialSkusFromProductResponse>["skus"],
): OmkarVariantGroup[] {
  const groups = new Map<string, Map<string, { valueId: string; name: string; imageUrl: string | null }>>();

  for (const sku of skus) {
    const attributes = stringAttributes(sku.attributes);
    for (const [attributeName, optionName] of Object.entries(attributes)) {
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
  if (official.skus.length === 0) {
    throw new Error(
      `AliExpress Open Platform retornou produto sem SKUs oficiais. Diagnóstico de formato: ${safeResponseShape(envelope)}`,
    );
  }

  const imageUrls = text(multimedia.image_urls)
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
  const videos = record(multimedia.ae_video_dtos);
  const firstVideo = array<Record<string, unknown>>(videos.ae_video_d_t_o)[0];
  const videoUrl = normalizeUrl(firstVideo?.media_url || firstVideo?.video_url);
  const images = uniqueUrls(imageUrls);

  const skuPricing: OmkarSkuPricing[] = official.skus.map((sku) => {
    const price = sku.price ?? null;
    const stock = sku.stock ?? null;
    if (price === null || stock === null) {
      throw new Error(`SKU oficial ${sku.orderSkuAttr} sem preço ou estoque verificável.`);
    }

    const attributes = stringAttributes(sku.attributes);
    const variantIds = Object.entries(attributes)
      .map(([name, value]) => optionKey(name, value))
      .join(",");

    return {
      sku_id: sku.sourceSkuId,
      variant_ids: variantIds,
      list_price: price,
      sale_price: price,
      formatted_sale_price: null,
      discount_label: null,
      available_quantity: Math.max(0, Math.trunc(stock)),
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
    official_sku_attrs: Object.fromEntries(
      official.skus.map((sku) => [sku.sourceSkuId, sku.orderSkuAttr]),
    ),
    official_response: envelope,
  };
}
