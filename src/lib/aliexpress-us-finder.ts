import { requireAliExpressSession } from "./aliexpress-connection";
import { officialSkusFromProductResponse } from "./aliexpress-sku-parser";
import { shipsFromValuesFromEnvelope } from "./aliexpress-top-client";
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

type AliExpressSessionContext = Awaited<ReturnType<typeof requireAliExpressSession>>;

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
 * Optional official AliExpress Dropshipping text search (returns [] if app lacks scope or fails).
 */
export async function tryOfficialAliExpressSearch(
  query: string,
  page = 1,
): Promise<OmkarSearchResult[]> {
  try {
    const { session, client } = await withTimeout(
      requireAliExpressSession({ readOnly: true }),
      6_000,
      "Sessão AliExpress",
    );
    const envelope = await withTimeout(
      client.searchDropshipProducts({
        session,
        keyword: query,
        countryCode: "US",
        currency: "USD",
        page,
        pageSize: 30,
        sortBy: "orders,desc",
      }),
      8_000,
      "Busca oficial AliExpress",
    );

    const result = asRecord(envelope.result);
    const data = asRecord(result.data ?? result);
    const productsContainer = data.products ?? result.products;
    const rawList = Array.isArray(productsContainer)
      ? productsContainer
      : asArray(asRecord(productsContainer).selection_search_product ?? asRecord(productsContainer).product);

    return rawList.flatMap<OmkarSearchResult>((raw) => {
      const row = asRecord(raw);
      const id = asText(row.itemId ?? row.product_id ?? row.item_id);
      const title = asText(row.title ?? row.product_title);
      if (!/^\d{10,}$/.test(id) || !title) return [];

      const image = asText(row.itemMainPic ?? row.product_main_image_url);
      const salePrice = toNum(row.targetSalePrice ?? row.target_sale_price ?? row.salePrice);
      const originalPrice = toNum(row.targetOriginalPrice ?? row.target_original_price ?? row.originalPrice);
      const rating = toNum(row.score ?? row.evaluate_rate);
      const orders = toNum(row.orders ?? row.lastest_volume);

      return [{
        id,
        title,
        link: `https://www.aliexpress.us/item/${id}.html`,
        image: image.startsWith("//") ? `https:${image}` : image,
        images: image ? [image.startsWith("//") ? `https:${image}` : image] : [],
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
        tags: ["official-ds-search"],
        store_name: asText(row.storeName ?? row.shop_name) || null,
        category_ids: [],
        listed_date: "",
      }];
    });
  } catch {
    return [];
  }
}

export async function verifySingleProductUsShipping(
  productId: string,
  options?: {
    context?: AliExpressSessionContext;
    skipFreightIfNoUsStock?: boolean;
    callTimeoutMs?: number;
  },
): Promise<VerifiedShippingCheck> {
  const timeoutMs = options?.callTimeoutMs ?? 7_000;
  try {
    const { session, client } =
      options?.context ?? (await requireAliExpressSession({ readOnly: true }));

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

    const quotes = await withTimeout(
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

    // Prefer fastest quote that has a valid delivery estimate, breaking ties by lowest cost
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

export async function verifyAndFilterSearchResults(
  items: OmkarSearchResult[],
  options: {
    usOnly?: boolean;
    maxDays?: number | null;
    maxInspect?: number;
    budgetMs?: number;
  },
): Promise<{
  results: EnrichedSearchResult[];
  inspectedCount: number;
  usWarehouseCount: number;
  partial: boolean;
}> {
  const maxInspect = Math.min(20, Math.max(1, options.maxInspect ?? 12));
  const candidates = items.slice(0, maxInspect);
  const enriched: EnrichedSearchResult[] = [];
  const concurrency = 6;
  const deadlineMs = Date.now() + Math.max(5_000, Math.min(35_000, options.budgetMs ?? 20_000));
  let partial = false;

  const sharedContext = await withTimeout(
    requireAliExpressSession({ readOnly: true }),
    6_000,
    "Sessão AliExpress",
  );

  for (let i = 0; i < candidates.length; i += concurrency) {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 1_500 && enriched.length > 0) {
      partial = true;
      break;
    }

    const chunk = candidates.slice(i, i + concurrency);
    const callTimeoutMs = Math.max(3_500, Math.min(7_000, remainingMs - 500));
    const verifiedChunk = await Promise.all(
      chunk.map(async (item): Promise<EnrichedSearchResult> => {
        const shippingCheck = await verifySingleProductUsShipping(item.id, {
          context: sharedContext,
          skipFreightIfNoUsStock: Boolean(options.usOnly),
          callTimeoutMs,
        });
        return { ...item, shippingCheck };
      }),
    );
    enriched.push(...verifiedChunk);
  }

  const usWarehouseCount = enriched.filter((item) => item.shippingCheck?.hasUsInStock).length;

  const filtered = enriched
    .filter((item) => {
      const check = item.shippingCheck;
      if (!check?.checked) return false;
      if (options.usOnly && !check.hasUsInStock) return false;
      if (options.maxDays && (check.deliveryMaxDays == null || check.deliveryMaxDays > options.maxDays)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aUs = a.shippingCheck?.hasUsInStock ? 0 : 1;
      const bUs = b.shippingCheck?.hasUsInStock ? 0 : 1;
      if (aUs !== bUs) return aUs - bUs;
      const aDays = a.shippingCheck?.deliveryMaxDays ?? 999;
      const bDays = b.shippingCheck?.deliveryMaxDays ?? 999;
      if (aDays !== bDays) return aDays - bDays;
      return (b.orders_count ?? 0) - (a.orders_count ?? 0);
    });

  return {
    results: filtered,
    inspectedCount: enriched.length,
    usWarehouseCount,
    partial,
  };
}
