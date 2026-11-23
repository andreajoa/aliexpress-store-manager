import type { AmbBridgeConfig } from "./amb-bridge-contract.ts";

export const AMB_DELIVERY_MARKETS = ["US", "CA", "UK", "AU", "NZ"] as const;
export type AmbDeliveryMarket = (typeof AMB_DELIVERY_MARKETS)[number];

export type ParsedDeliveryDays = {
  minDays: number;
  maxDays: number;
  raw: string;
};

export type DeliveryWindowEntry = {
  minDays: number;
  maxDays: number;
  source: "manual" | "supplier-quote";
  updatedAt: string | null;
};

export type SupplierDeliverySummary = {
  markets: Partial<Record<AmbDeliveryMarket, DeliveryWindowEntry>>;
  manualOverride: {
    minDays: number;
    maxDays: number;
    allMarkets: boolean;
    updatedAt: string | null;
  } | null;
  updatedAt: string | null;
};

export type SanitizedAmbProductDelivery = {
  markets: Partial<Record<AmbDeliveryMarket, DeliveryWindowEntry>>;
  updatedAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function clampDays(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 60) return null;
  return rounded;
}

export function normalizeDeliveryMarket(value: unknown): AmbDeliveryMarket | null {
  const code = asText(value).toUpperCase();
  if (code === "GB" || code === "UK") return "UK";
  if (code === "US" || code === "CA" || code === "AU" || code === "NZ") {
    return code;
  }
  return null;
}

/**
 * Parses AliExpress estimated_delivery_time strings into normalized calendar day bounds.
 * Supports: "5days", "10 days", "7-10 days", "8–15", "10 to 14 days", "15", or ISO date "2026-12-05".
 */
export function parseEstimatedDeliveryDays(
  raw: unknown,
  referenceDateMs = Date.now(),
): ParsedDeliveryDays | null {
  if (typeof raw === "number") {
    const days = clampDays(raw);
    return days ? { minDays: days, maxDays: days, raw: `${days}days` } : null;
  }

  const text = asText(raw);
  if (!text) return null;

  // ISO calendar date (e.g. "2026-12-05")
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const targetMs = Date.parse(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00Z`);
    if (Number.isFinite(targetMs)) {
      const diffDays = clampDays((targetMs - referenceDateMs) / 86_400_000);
      if (diffDays) return { minDays: diffDays, maxDays: diffDays, raw: text };
    }
    return null;
  }

  // Range: "7-10 days", "8–15days", "10 to 14"
  const rangeMatch = text.match(/(\d{1,2})\s*(?:-|–|—|to|~)\s*(\d{1,2})/i);
  if (rangeMatch) {
    const first = clampDays(Number(rangeMatch[1]));
    const second = clampDays(Number(rangeMatch[2]));
    if (!first || !second) return null;
    const minDays = Math.min(first, second);
    const maxDays = Math.max(first, second);
    return { minDays, maxDays, raw: text };
  }

  // Single integer: "5days", "15 days", "12"
  const singleMatch = text.match(/^(\d{1,2})\s*(?:days?|d)?$/i) || text.match(/\b(\d{1,2})\s*days?\b/i);
  if (singleMatch) {
    const days = clampDays(Number(singleMatch[1]));
    if (!days) return null;
    return { minDays: days, maxDays: days, raw: text };
  }

  return null;
}

/**
 * Merges SKU-level estimatedDeliveryTime values without dropping data when SKUs vary slightly.
 */
export function summarizeFreightDeliveryTimes(
  values: Array<string | null | undefined>,
  referenceDateMs = Date.now(),
): { estimatedDeliveryTime: string; minDays: number; maxDays: number } | null {
  const parsed = values
    .map((value) => parseEstimatedDeliveryDays(value, referenceDateMs))
    .filter((item): item is ParsedDeliveryDays => Boolean(item));

  if (parsed.length === 0) return null;

  const minDays = Math.min(...parsed.map((item) => item.minDays));
  const maxDays = Math.max(...parsed.map((item) => item.maxDays));
  const estimatedDeliveryTime = minDays === maxDays ? `${minDays}days` : `${minDays}-${maxDays}days`;

  return { estimatedDeliveryTime, minDays, maxDays };
}

function isoStringOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = asText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseCostSnapshotEntry(
  snapshotValue: unknown,
  fallbackUpdatedAt: string | null,
): { market: AmbDeliveryMarket; entry: DeliveryWindowEntry } | null {
  const snapshot = asRecord(snapshotValue);
  if (Object.keys(snapshot).length === 0) return null;

  const freight = asRecord(snapshot.freight);
  const perSku = Array.isArray(snapshot.perSku) ? snapshot.perSku : [];
  const candidateStrings: Array<string | null | undefined> = [
    asText(freight.estimatedDeliveryTime) || null,
    ...perSku.map((row) => asText(asRecord(row).estimatedDeliveryTime) || null),
  ];

  // Also support legacy shippingInfo shape directly (when freight IS the root object)
  if (!candidateStrings.some(Boolean) && snapshot.estimatedDeliveryTime !== undefined) {
    candidateStrings.push(asText(snapshot.estimatedDeliveryTime) || null);
  }

  const updatedAt = isoStringOrNull(snapshot.calculatedAt) || fallbackUpdatedAt;
  const refMs = updatedAt ? Date.parse(updatedAt) : Date.now();
  const summary = summarizeFreightDeliveryTimes(candidateStrings, refMs);
  if (!summary) return null;

  const market = normalizeDeliveryMarket(snapshot.countryCode) || "US";
  return {
    market,
    entry: {
      minDays: summary.minDays,
      maxDays: summary.maxDays,
      source: "supplier-quote",
      updatedAt,
    },
  };
}

function parseManualOverride(rawPayload: Record<string, unknown>) {
  const manual = asRecord(rawPayload.manualDeliveryDays);
  if (Object.keys(manual).length === 0) return null;

  const minDays = clampDays(Number(manual.minDays));
  const maxDays = clampDays(Number(manual.maxDays ?? manual.minDays));
  if (!minDays || !maxDays) return null;

  return {
    minDays: Math.min(minDays, maxDays),
    maxDays: Math.max(minDays, maxDays),
    allMarkets: manual.allMarkets === true,
    updatedAt: isoStringOrNull(manual.updatedAt),
  };
}

export function extractSupplierDeliveryProfile(input: {
  supplierRawPayload?: unknown;
  supplierUpdatedAt?: Date | string | null;
  productRawPayload?: unknown;
  productSpecifications?: unknown;
}): SupplierDeliverySummary | null {
  const supplierRaw = asRecord(input.supplierRawPayload);
  const productRaw = asRecord(input.productRawPayload);
  const productSpecs = asRecord(input.productSpecifications);
  const fallbackUpdatedAt = isoStringOrNull(input.supplierUpdatedAt);

  const markets: Partial<Record<AmbDeliveryMarket, DeliveryWindowEntry>> = {};

  // 1. Lowest priority: product-level import snapshot (covers legacy suppliers already in DB)
  for (const candidate of [productRaw.costSnapshot, productSpecs.importFreight, productSpecs.costing, productSpecs.shippingInfo]) {
    const parsed = parseCostSnapshotEntry(candidate, fallbackUpdatedAt);
    if (parsed && !markets[parsed.market]) {
      markets[parsed.market] = parsed.entry;
    }
  }

  // 2. Supplier-level costSnapshot (overrides product-level)
  const supplierSnapshot = parseCostSnapshotEntry(supplierRaw.costSnapshot, fallbackUpdatedAt);
  if (supplierSnapshot) {
    markets[supplierSnapshot.market] = supplierSnapshot.entry;
  }

  // 3. Explicit multi-market delivery quotes recorded on supplier
  const deliveryByMarket = asRecord(supplierRaw.deliveryByMarket);
  for (const [rawMarket, rawEntry] of Object.entries(deliveryByMarket)) {
    const market = normalizeDeliveryMarket(rawMarket);
    if (!market) continue;
    const rec = asRecord(rawEntry);
    const minDays = clampDays(Number(rec.minDays));
    const maxDays = clampDays(Number(rec.maxDays ?? rec.minDays));
    if (!minDays || !maxDays) continue;
    markets[market] = {
      minDays: Math.min(minDays, maxDays),
      maxDays: Math.max(minDays, maxDays),
      source: rec.source === "manual" ? "manual" : "supplier-quote",
      updatedAt: isoStringOrNull(rec.updatedAt) || fallbackUpdatedAt,
    };
  }

  // 4. Highest priority: explicit manual override configured in Store Manager
  const manualOverride = parseManualOverride(supplierRaw);
  if (manualOverride) {
    const targetMarkets: readonly AmbDeliveryMarket[] = manualOverride.allMarkets
      ? AMB_DELIVERY_MARKETS
      : ["US"];
    for (const market of targetMarkets) {
      markets[market] = {
        minDays: manualOverride.minDays,
        maxDays: manualOverride.maxDays,
        source: "manual",
        updatedAt: manualOverride.updatedAt || fallbackUpdatedAt,
      };
    }
  }

  const timestamps = Object.values(markets)
    .map((entry) => entry?.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort();

  if (Object.keys(markets).length === 0 && !manualOverride) {
    return null;
  }

  return {
    markets,
    manualOverride,
    updatedAt: timestamps.at(-1) || fallbackUpdatedAt,
  };
}

/**
 * Preserves manual delivery overrides and multi-market quotes when refreshing a supplier's rawPayload.
 */
export function mergeDeliveryPayloadFields(
  existingRawPayload: unknown,
  costSnapshot: {
    countryCode?: string;
    calculatedAt?: string;
    freight?: { estimatedDeliveryTime?: string | null };
    perSku?: Array<{ estimatedDeliveryTime?: string | null }>;
  } | null | undefined,
): Record<string, unknown> {
  const existing = asRecord(existingRawPayload);
  const next: Record<string, unknown> = {};

  if (existing.manualDeliveryDays && typeof existing.manualDeliveryDays === "object") {
    next.manualDeliveryDays = existing.manualDeliveryDays;
  }

  const existingByMarket = asRecord(existing.deliveryByMarket);
  const mergedByMarket: Record<string, unknown> = { ...existingByMarket };

  const parsed = parseCostSnapshotEntry(costSnapshot, null);
  if (parsed) {
    mergedByMarket[parsed.market] = {
      minDays: parsed.entry.minDays,
      maxDays: parsed.entry.maxDays,
      source: "supplier-quote",
      updatedAt: parsed.entry.updatedAt,
    };
  }

  if (Object.keys(mergedByMarket).length > 0) {
    next.deliveryByMarket = mergedByMarket;
  }

  return next;
}

export type AmbDeliveryProductSource = {
  id: string;
  sourceProductId: string;
  rawPayload: unknown;
  specifications: unknown;
  updatedAt: Date | string;
  supplierProducts: Array<{
    role: string;
    priority: number;
    status: string;
    rawPayload: unknown;
    lastCheckedAt: Date | string | null;
    updatedAt: Date | string;
  }>;
};

function selectPrimarySupplier(suppliers: AmbDeliveryProductSource["supplierProducts"]) {
  const active = suppliers.filter((supplier) => supplier.status === "ACTIVE");
  if (active.length === 0) return null;
  const roleRank = (role: string) => (role === "PRIMARY" ? 0 : role === "BACKUP" ? 1 : 2);
  return [...active].sort(
    (a, b) => roleRank(a.role) - roleRank(b.role) || a.priority - b.priority,
  )[0] || null;
}

/**
 * Builds the strictly sanitized AMB Boutique delivery-windows payload.
 * Never includes supplier names, source URLs, product IDs, carrier names, or costs.
 */
export function buildSanitizedAmbDeliveryPayload(input: {
  storeId: string;
  bridge: AmbBridgeConfig | null;
  publications: Array<{ externalSlug: string | null; productId: string }>;
  products: AmbDeliveryProductSource[];
  generatedAt?: Date;
}) {
  const bySourceProductId = new Map(input.products.map((product) => [product.sourceProductId, product]));
  const byProductId = new Map(input.products.map((product) => [product.id, product]));

  const slugToProduct = new Map<string, AmbDeliveryProductSource>();

  for (const publication of input.publications) {
    const slug = asText(publication.externalSlug);
    if (!slug) continue;
    const product = byProductId.get(publication.productId);
    if (product) slugToProduct.set(slug, product);
  }

  if (input.bridge) {
    for (const [slug, binding] of Object.entries(input.bridge.products)) {
      const cleanSlug = asText(slug);
      if (!cleanSlug) continue;
      const product = bySourceProductId.get(binding.sourceProductId);
      if (product) slugToProduct.set(cleanSlug, product);
    }
  }

  const sanitizedProducts: Record<string, SanitizedAmbProductDelivery> = {};
  for (const [slug, product] of [...slugToProduct.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const primarySupplier = selectPrimarySupplier(product.supplierProducts);
    const summary = extractSupplierDeliveryProfile({
      supplierRawPayload: primarySupplier?.rawPayload,
      supplierUpdatedAt: primarySupplier?.lastCheckedAt || primarySupplier?.updatedAt || product.updatedAt,
      productRawPayload: product.rawPayload,
      productSpecifications: product.specifications,
    });

    if (!summary || Object.keys(summary.markets).length === 0) continue;

    // Strictly copy ONLY customer-safe fields
    const safeMarkets: Partial<Record<AmbDeliveryMarket, DeliveryWindowEntry>> = {};
    for (const market of AMB_DELIVERY_MARKETS) {
      const entry = summary.markets[market];
      if (!entry) continue;
      safeMarkets[market] = {
        minDays: entry.minDays,
        maxDays: entry.maxDays,
        source: entry.source,
        updatedAt: entry.updatedAt,
      };
    }

    if (Object.keys(safeMarkets).length > 0) {
      sanitizedProducts[slug] = {
        markets: safeMarkets,
        updatedAt: summary.updatedAt,
      };
    }
  }

  return {
    ok: true as const,
    storeId: input.storeId,
    generatedAt: (input.generatedAt || new Date()).toISOString(),
    linkedCount: slugToProduct.size,
    productCount: Object.keys(sanitizedProducts).length,
    products: sanitizedProducts,
  };
}
