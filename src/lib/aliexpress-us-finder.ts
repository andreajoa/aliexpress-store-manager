import { requireAliExpressSession } from "./aliexpress-connection";
import { officialSkusFromProductResponse } from "./aliexpress-sku-parser";
import {
  isAliExpressSuccessCode,
  regionalProductIdFromEnvelope,
  shipsFromValuesFromEnvelope,
} from "./aliexpress-top-client";
import {
  skuShipsFromCountryCode,
  summarizeProductWarehouses,
} from "./aliexpress-warehouse";
import type { OmkarSearchResult } from "./omkar-search";
import { parseEstimatedDeliveryDays } from "./supplier-delivery";

export type VerifiedShippingCheck = {
  checked: boolean;
  hasUsWarehouse: boolean;
  hasUsInStock: boolean;
  usTotalStock: number;
  dispatchCountry: string;
  countries: string[];
  deliveryMinDays: number | null;
  deliveryMaxDays: number | null;
  ambDisplayMinDays: number | null;
  ambDisplayMaxDays: number | null;
  freightCostUsd: number | null;
  serviceName: string | null;
  error: string | null;
};

export type EnrichedSearchResult = OmkarSearchResult & {
  shippingCheck?: VerifiedShippingCheck;
};

type AliExpressSessionContext = Awaited<ReturnType<typeof requireAliExpressSession>>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];
  return [value as T];
}

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function toNum(value: unknown): number | null {
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} excedeu ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Mirrors AMB Boutique's customer-facing +5 day Stripe settlement buffer + safety cushion
 * so Store Manager previews match the exact delivery range shoppers will see on the PDP.
 */
export function estimateAmbStorefrontDays(minDays: number, maxDays: number) {
  const transitMin = Math.max(2, Math.min(45, Math.round(minDays)));
  const safetyBuffer = transitMin <= 7 ? 2 : transitMin <= 15 ? 3 : 4;
  const transitMax = Math.min(55, Math.max(Math.round(maxDays), transitMin + safetyBuffer));
  return {
    ambDisplayMinDays: 5 + transitMin,
    ambDisplayMaxDays: 5 + transitMax,
  };
}

/**
 * Extracts explicit AliExpress product IDs when the user pastes links or numeric IDs directly.
 */
export function extractDirectAliExpressProductIds(query: string): string[] {
  const ids = new Set<string>();
  for (const m of query.matchAll(/\/item\/(\d{10,})\.html/gi)) {
    ids.add(m[1]);
  }
  for (const m of query.matchAll(/\b(\d{12,20})\b/g)) {
    ids.add(m[1]);
  }
  return Array.from(ids).slice(0, 20);
}

function extractProductRowsFromEnvelope(envelope: Record<string, unknown>): unknown[] {
  const result = asRecord(envelope.result);
  const data = asRecord(result.data ?? envelope.data ?? result);
  const productsContainer =
    data.products ??
    result.products ??
    data.items ??
    result.items ??
    envelope.products;

  if (Array.isArray(productsContainer)) return productsContainer;

  const containerRec = asRecord(productsContainer);
  for (const key of [
    "selection_search_product",
    "traffic_product_d_t_o",
    "traffic_product_dto",
    "ae_multimedia_info_dto",
    "product",
    "item",
    "list",
  ]) {
    if (key in containerRec) {
      return asArray(containerRec[key]);
    }
  }

  return [];
}

function normalizeOfficialSearchRow(raw: unknown, tag: string): OmkarSearchResult | null {
  const row = asRecord(raw);
  const id = asText(row.itemId ?? row.product_id ?? row.item_id ?? row.productId);
  const title = asText(row.title ?? row.product_title ?? row.subject);
  if (!/^\d{8,}$/.test(id) || !title) return null;

  const image = asText(
    row.itemMainPic ?? row.product_main_image_url ?? row.imageUrl ?? row.main_image_url,
  );
  const normalizedImage = image.startsWith("//") ? `https:${image}` : image;
  const salePrice = toNum(
    row.targetSalePrice ?? row.target_sale_price ?? row.salePrice ?? row.sale_price ?? row.app_sale_price,
  );
  const originalPrice = toNum(
    row.targetOriginalPrice ?? row.target_original_price ?? row.originalPrice ?? row.original_price,
  );
  const rating = toNum(row.score ?? row.evaluate_rate ?? row.avg_evaluation_rating);
  const orders = toNum(row.orders ?? row.lastest_volume ?? row.volume);

  return {
    id,
    title,
    link: `https://www.aliexpress.us/item/${id}.html`,
    image: normalizedImage,
    images: normalizedImage ? [normalizedImage] : [],
    rating: rating != null ? (rating > 5 ? Math.round((rating / 20) * 10) / 10 : rating) : null,
    orders_count: orders,
    is_hot_sale: null,
    is_choice: null,
    pricing: {
      sale_price: salePrice,
      original_price: originalPrice ?? salePrice,
      discount_percent: null,
      currency: "USD",
      tax_rate: null,
      sku_id: null,
    },
    tags: [tag],
    store_name: asText(row.storeName ?? row.shop_name ?? row.store_name) || null,
    category_ids: [],
    listed_date: "",
  };
}

/**
 * Official AliExpress Dropshipping text search (`aliexpress.ds.text.search`).
 * Omits invalid `sortBy` values by default and logs exact API errors for observability.
 */
export async function searchOfficialAliExpressCatalog(
  query: string,
  page = 1,
  options?: {
    context?: AliExpressSessionContext;
    pageSize?: number;
    timeoutMs?: number;
    sortBy?: string;
  },
): Promise<{
  items: OmkarSearchResult[];
  totalCount: number;
  error: string | null;
}> {
  try {
    const { session, client } =
      options?.context ??
      (await withTimeout(requireAliExpressSession(), 6_000, "Sessão AliExpress"));

    const envelope = await withTimeout(
      client.searchDropshipProducts({
        session,
        keyword: query,
        countryCode: "US",
        currency: "USD",
        page,
        pageSize: options?.pageSize ?? 40,
        sortBy: options?.sortBy,
      }),
      options?.timeoutMs ?? 8_000,
      "Busca oficial AliExpress",
    );

    const result = asRecord(envelope.result);
    const data = asRecord(result.data ?? envelope.data ?? result);
    const totalCount =
      toNum(data.totalCount ?? result.totalCount ?? data.total_record_count ?? result.total_record_count) ?? 0;

    const rawList = extractProductRowsFromEnvelope(envelope);
    const items = rawList
      .map((raw) => normalizeOfficialSearchRow(raw, "official-ds-search"))
      .filter((item): item is OmkarSearchResult => Boolean(item));

    if (items.length === 0) {
      const code = asText(envelope.code ?? result.code ?? result.error_code ?? data.code);
      const msg = asText(envelope.msg ?? result.msg ?? result.error_msg ?? data.msg);
      if (code && !isAliExpressSuccessCode(code)) {
        return { items: [], totalCount: 0, error: `ds.text.search ${code}: ${msg || "sem detalhes"}` };
      }
    }

    return { items, totalCount, error: null };
  } catch (error) {
    return {
      items: [],
      totalCount: 0,
      error: error instanceof Error ? error.message : "Falha na busca oficial AliExpress.",
    };
  }
}

/**
 * Fallback official Dropshipping feed (`aliexpress.ds.recommend.feed.get`, Women's Clothing + Bestsellers)
 * when `aliexpress.ds.text.search` is unavailable or returns 0 results.
 */
export async function searchOfficialRecommendFeed(
  query: string,
  page = 1,
  options?: {
    context?: AliExpressSessionContext;
    timeoutMs?: number;
  },
): Promise<{
  items: OmkarSearchResult[];
  totalCount: number;
  error: string | null;
}> {
  const errors: string[] = [];
  try {
    const { session, client } =
      options?.context ??
      (await withTimeout(requireAliExpressSession(), 6_000, "Sessão AliExpress"));

    // 200000345 = Women's Clothing on AliExpress
    const attempts: Array<{ feedName: string; categoryId?: string }> = [
      { feedName: "DS bestseller", categoryId: "200000345" },
      { feedName: "DS bestseller" },
    ];

    const queryTokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !["women", "us", "usa", "warehouse"].includes(t));

    for (const attempt of attempts) {
      try {
        const envelope = await withTimeout(
          client.getDropshipRecommendFeed({
            session,
            feedName: attempt.feedName,
            country: "US",
            targetCurrency: "USD",
            targetLanguage: "EN",
            categoryId: attempt.categoryId,
            pageNo: page,
            pageSize: 50,
            sort: "LAST_VOLUME_DESC",
          }),
          options?.timeoutMs ?? 8_000,
          "Feed oficial AliExpress",
        );

        const result = asRecord(envelope.result);
        const totalCount = toNum(result.total_record_count ?? result.current_record_count) ?? 0;
        const rawList = extractProductRowsFromEnvelope(envelope);
        const items = rawList
          .map((raw) => normalizeOfficialSearchRow(raw, "official-ds-feed"))
          .filter((item): item is OmkarSearchResult => Boolean(item));

        if (items.length > 0) {
          // Prioritize items whose title matches the requested search keywords
          const scored = [...items].sort((a, b) => {
            const aTitle = a.title.toLowerCase();
            const bTitle = b.title.toLowerCase();
            const aHits = queryTokens.reduce((acc, tok) => acc + (aTitle.includes(tok) ? 1 : 0), 0);
            const bHits = queryTokens.reduce((acc, tok) => acc + (bTitle.includes(tok) ? 1 : 0), 0);
            if (bHits !== aHits) return bHits - aHits;
            return (b.orders_count ?? 0) - (a.orders_count ?? 0);
          });
          return { items: scored, totalCount: Math.max(totalCount, scored.length), error: null };
        }
      } catch (err) {
        errors.push(`${attempt.feedName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { items: [], totalCount: 0, error: errors.join(" | ") || null };
  } catch (error) {
    return {
      items: [],
      totalCount: 0,
      error: error instanceof Error ? error.message : "Falha no feed oficial AliExpress.",
    };
  }
}

export async function tryOfficialAliExpressSearch(
  query: string,
  page = 1,
): Promise<OmkarSearchResult[]> {
  const res = await searchOfficialAliExpressCatalog(query, page);
  return res.items;
}

export async function verifySingleProductUsShipping(
  productId: string,
  options?: {
    context?: AliExpressSessionContext;
    skipFreightIfNoUsStock?: boolean;
    fastDirectFreight?: boolean;
    callTimeoutMs?: number;
  },
): Promise<VerifiedShippingCheck & { resolvedTitle?: string; resolvedImage?: string; resolvedPrice?: number | null; storeName?: string }> {
  const timeoutMs = options?.callTimeoutMs ?? 6_500;
  try {
    const { session, client } =
      options?.context ?? (await requireAliExpressSession());

    const envelope = await withTimeout(
      client.getDropshipProduct({
        session,
        productId,
        shipToCountry: "US",
        targetCurrency: "USD",
        targetLanguage: "EN",
      }),
      timeoutMs,
      "Consulta de produto AliExpress",
    );

    const result = asRecord(envelope.result);
    const baseInfo = asRecord(result.ae_item_base_info_dto);
    const mediaInfo = asRecord(result.ae_multimedia_info_dto);
    const rawImages = asText(mediaInfo.image_urls).split(";").map((u) => u.trim()).filter(Boolean);
    const resolvedTitle = asText(baseInfo.subject) || undefined;
    const resolvedImage = rawImages[0] || undefined;
    const storeName = asText(asRecord(result.ae_store_info).store_name) || undefined;

    const shipsFromValues = shipsFromValuesFromEnvelope(envelope);
    const official = officialSkusFromProductResponse(envelope);
    const summary = summarizeProductWarehouses(
      official.skus.map((sku) => ({
        attributes: sku.attributes,
        stock: sku.stock,
        available: (sku.stock ?? 0) > 0,
      })),
      shipsFromValues,
    );

    const firstPrice = official.skus.find((sku) => sku.price != null)?.price ?? null;

    // Fast path for US-only sourcing: skip freight quote when product has zero US warehouse stock
    if (options?.skipFreightIfNoUsStock && !summary.hasUsInStock) {
      return {
        checked: true,
        hasUsWarehouse: summary.hasUsWarehouse,
        hasUsInStock: false,
        usTotalStock: summary.usTotalStock,
        dispatchCountry: summary.countries[0] || "CN",
        countries: summary.countries,
        deliveryMinDays: null,
        deliveryMaxDays: null,
        ambDisplayMinDays: null,
        ambDisplayMaxDays: null,
        freightCostUsd: null,
        serviceName: null,
        error: null,
        resolvedTitle,
        resolvedImage,
        resolvedPrice: firstPrice,
        storeName,
      };
    }

    const preferredSku =
      official.skus.find(
        (sku) => skuShipsFromCountryCode(sku.attributes) === "US" && (sku.stock ?? 0) > 0,
      ) ||
      official.skus.find((sku) => (sku.stock ?? 0) > 0) ||
      official.skus[0] ||
      null;

    const sendGoodsCountryCode =
      (preferredSku ? skuShipsFromCountryCode(preferredSku.attributes) : null) ||
      (summary.hasUsWarehouse ? "US" : "CN");

    const regionalId = regionalProductIdFromEnvelope(envelope, "US");
    const candidateIds = [regionalId, productId].filter((id): id is string => Boolean(id));

    let quotes = await withTimeout(
      client.calculateFreightDirect({
        session,
        productIds: candidateIds,
        quantity: 1,
        countryCode: "US",
        sendGoodsCountryCode,
        price: preferredSku?.price != null ? String(preferredSku.price) : undefined,
        priceCurrency: preferredSku?.currencyCode || "USD",
        skuId: preferredSku?.sourceSkuId || undefined,
      }),
      timeoutMs,
      "Cálculo direto de frete AliExpress",
    ).catch(() => []);

    if (quotes.length === 0 && !options?.fastDirectFreight) {
      quotes = await withTimeout(
        client.calculateFreight({
          session,
          productId,
          quantity: 1,
          countryCode: "US",
          sendGoodsCountryCode,
          price: preferredSku?.price != null ? String(preferredSku.price) : undefined,
          priceCurrency: preferredSku?.currencyCode || "USD",
          skuId: preferredSku?.sourceSkuId || undefined,
        }),
        timeoutMs,
        "Cálculo de frete AliExpress",
      );
    }

    const parsedQuotes = quotes
      .map((quote) => ({
        quote,
        days: parseEstimatedDeliveryDays(quote.estimatedDeliveryTime),
      }))
      .sort((a, b) => {
        const aMax = a.days?.maxDays ?? 999;
        const bMax = b.days?.maxDays ?? 999;
        if (aMax !== bMax) return aMax - bMax;
        return (a.quote.amount ?? 999) - (b.quote.amount ?? 999);
      });

    const best = parsedQuotes[0] || null;
    const minDays = best?.days?.minDays ?? null;
    const maxDays = best?.days?.maxDays ?? null;
    const ambDays = minDays != null && maxDays != null
      ? estimateAmbStorefrontDays(minDays, maxDays)
      : { ambDisplayMinDays: null, ambDisplayMaxDays: null };

    return {
      checked: true,
      hasUsWarehouse: summary.hasUsWarehouse,
      hasUsInStock: summary.hasUsInStock,
      usTotalStock: summary.usTotalStock,
      dispatchCountry: best?.quote.sendGoodsCountryCode || sendGoodsCountryCode,
      countries: summary.countries,
      deliveryMinDays: minDays,
      deliveryMaxDays: maxDays,
      ambDisplayMinDays: ambDays.ambDisplayMinDays,
      ambDisplayMaxDays: ambDays.ambDisplayMaxDays,
      freightCostUsd: best?.quote.amount ?? null,
      serviceName: best?.quote.serviceName ?? null,
      error: null,
      resolvedTitle,
      resolvedImage,
      resolvedPrice: preferredSku?.price ?? firstPrice,
      storeName,
    };
  } catch (error) {
    return {
      checked: false,
      hasUsWarehouse: false,
      hasUsInStock: false,
      usTotalStock: 0,
      dispatchCountry: "UNKNOWN",
      countries: [],
      deliveryMinDays: null,
      deliveryMaxDays: null,
      ambDisplayMinDays: null,
      ambDisplayMaxDays: null,
      freightCostUsd: null,
      serviceName: null,
      error: error instanceof Error ? error.message : "Falha ao verificar envio.",
    };
  }
}

export async function verifySearchBatch(
  items: OmkarSearchResult[],
  options: {
    usOnly?: boolean;
    maxDays?: number | null;
  },
): Promise<{
  results: EnrichedSearchResult[];
  inspectedCount: number;
  usWarehouseCount: number;
}> {
  const batch = items.slice(0, 4);
  if (batch.length === 0) {
    return { results: [], inspectedCount: 0, usWarehouseCount: 0 };
  }

  const sharedContext = await withTimeout(
    requireAliExpressSession(),
    6_000,
    "Sessão AliExpress",
  );

  const enriched = await Promise.all(
    batch.map(async (item): Promise<EnrichedSearchResult> => {
      const shippingCheck = await verifySingleProductUsShipping(item.id, {
        context: sharedContext,
        skipFreightIfNoUsStock: Boolean(options.usOnly),
        fastDirectFreight: true,
        callTimeoutMs: 6_500,
      });

      return {
        ...item,
        title: item.title && !item.title.startsWith("AliExpress #")
          ? item.title
          : shippingCheck.resolvedTitle || item.title,
        image: item.image || shippingCheck.resolvedImage || "",
        store_name: item.store_name || shippingCheck.storeName || null,
        images: item.images.length > 0
          ? item.images
          : shippingCheck.resolvedImage ? [shippingCheck.resolvedImage] : [],
        pricing: {
          ...item.pricing,
          sale_price: item.pricing.sale_price ?? shippingCheck.resolvedPrice ?? null,
        },
        shippingCheck,
      };
    }),
  );

  const usWarehouseCount = enriched.filter((item) => item.shippingCheck?.hasUsInStock).length;

  const filtered = enriched.filter((item) => {
    const check = item.shippingCheck;
    if (!check?.checked) return false;
    if (options.usOnly && !check.hasUsInStock) return false;
    if (options.maxDays && (check.deliveryMaxDays == null || check.deliveryMaxDays > options.maxDays)) {
      return false;
    }
    return true;
  });

  return {
    results: filtered,
    inspectedCount: enriched.length,
    usWarehouseCount,
  };
}
