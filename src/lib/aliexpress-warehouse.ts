import type { OmkarVariantGroup } from "./omkar.ts";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

const COUNTRY_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: "US", pattern: /^(?:us|usa|u\.s\.a?\.?|united states(?: of america)?|estados unidos)$/i },
  { code: "CN", pattern: /^(?:cn|chn|china(?:\s+mainland)?|mainland china|p\.?r\.?c\.?)$/i },
  { code: "UK", pattern: /^(?:uk|gb|gbr|united kingdom|great britain|england)$/i },
  { code: "CA", pattern: /^(?:ca|can|canada)$/i },
  { code: "AU", pattern: /^(?:au|aus|australia)$/i },
  { code: "NZ", pattern: /^(?:nz|nzl|new zealand)$/i },
  { code: "ES", pattern: /^(?:es|esp|spain|españa)$/i },
  { code: "DE", pattern: /^(?:de|deu|germany|deutschland)$/i },
  { code: "FR", pattern: /^(?:fr|fra|france)$/i },
  { code: "IT", pattern: /^(?:it|ita|italy|italia)$/i },
  { code: "PL", pattern: /^(?:pl|pol|poland)$/i },
  { code: "CZ", pattern: /^(?:cz|cze|czech republic|czechia)$/i },
  { code: "BR", pattern: /^(?:br|bra|brazil|brasil)$/i },
  { code: "TR", pattern: /^(?:tr|tur|turkey|türkiye)$/i },
  { code: "MX", pattern: /^(?:mx|mex|mexico|méxico)$/i },
];

export function parseShipsFromCountryCode(value: unknown): string | null {
  const raw = asText(value);
  if (!raw) return null;

  // Handle labels like "200007763:201336106:United States" by checking the last segment first
  const segments = raw.split(":").map((part) => part.trim()).filter(Boolean);
  const candidates = segments.length > 1 ? [segments[segments.length - 1], raw] : [raw];

  for (const candidate of candidates) {
    for (const entry of COUNTRY_PATTERNS) {
      if (entry.pattern.test(candidate)) return entry.code;
    }
    if (/united states|\bus warehouse\b|\blocal us\b/i.test(candidate)) return "US";
    if (/china/i.test(candidate)) return "CN";
  }

  return null;
}

export function skuShipsFromCountryCode(
  attributes: unknown,
  variantIds?: string | null,
): string | null {
  const record = asRecord(attributes);
  for (const [key, value] of Object.entries(record)) {
    if (/^ships?\s*from$/i.test(key.trim()) || key.trim() === "attr_200007763" || key.trim() === "200007763") {
      const code = parseShipsFromCountryCode(value);
      if (code) return code;
    }
  }

  const rawIds = asText(variantIds);
  if (rawIds) {
    for (const part of rawIds.split(",")) {
      const idx = part.indexOf(":");
      if (idx <= 0) continue;
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (/^ships?\s*from$/i.test(key) || key === "200007763" || key === "attr_200007763") {
        const code = parseShipsFromCountryCode(val);
        if (code) return code;
      }
    }
  }

  return null;
}

export function isUsWarehouseVariant(
  attributes: unknown,
  variantIds?: string | null,
): boolean {
  return skuShipsFromCountryCode(attributes, variantIds) === "US";
}

function buildShipsFromOptionLookup(variantGroups?: OmkarVariantGroup[] | null): Map<string, string> {
  const lookup = new Map<string, string>();
  if (!Array.isArray(variantGroups)) return lookup;

  for (const group of variantGroups) {
    const name = asText(group.attribute_name);
    const id = asText(group.attribute_id);
    if (!/^ships?\s*from$/i.test(name) && id !== "200007763") continue;
    for (const opt of group.options || []) {
      const code = parseShipsFromCountryCode(opt.name);
      if (!code) continue;
      const valId = asText(opt.value_id);
      if (valId) lookup.set(valId, code);
      lookup.set(`${name}:${opt.name}`, code);
    }
  }

  return lookup;
}

export function resolveSendGoodsCountryForSku(input: {
  skuVariantIds?: string | null;
  skuAttributes?: unknown;
  variantGroups?: OmkarVariantGroup[] | null;
  shipsFromValues?: string[] | null;
  defaultCountry?: string;
}): string {
  const direct = skuShipsFromCountryCode(input.skuAttributes, input.skuVariantIds);
  if (direct) return direct;

  const lookup = buildShipsFromOptionLookup(input.variantGroups);
  if (lookup.size > 0 && input.skuVariantIds) {
    for (const token of input.skuVariantIds.split(",").map((part) => part.trim()).filter(Boolean)) {
      const mapped = lookup.get(token);
      if (mapped) return mapped;
    }
  }

  const productCountries = Array.from(
    new Set(
      (input.shipsFromValues || [])
        .map((item) => parseShipsFromCountryCode(item))
        .filter((code): code is string => Boolean(code)),
    ),
  );
  if (productCountries.length === 1) {
    return productCountries[0];
  }

  return (input.defaultCountry || "CN").trim().toUpperCase() || "CN";
}

export function summarizeProductWarehouses(
  variants: Array<{
    attributes?: unknown;
    variant_ids?: string | null;
    stock?: number | null;
    available_quantity?: number | null;
    available?: boolean;
  }>,
  shipsFromValues?: string[] | null,
) {
  const countries = new Set<string>();
  let usInStockSkuCount = 0;
  let usTotalStock = 0;
  let totalStock = 0;

  for (const value of shipsFromValues || []) {
    const code = parseShipsFromCountryCode(value);
    if (code) countries.add(code);
  }

  for (const variant of variants) {
    const stockRaw = variant.stock ?? variant.available_quantity ?? 0;
    const stock = Number.isFinite(Number(stockRaw)) ? Math.max(0, Math.trunc(Number(stockRaw))) : 0;
    const isAvailable = variant.available !== false && stock > 0;
    totalStock += stock;

    const country = skuShipsFromCountryCode(variant.attributes, variant.variant_ids);
    if (country) {
      countries.add(country);
      if (country === "US") {
        usTotalStock += stock;
        if (isAvailable) usInStockSkuCount++;
      }
    }
  }

  const hasUsWarehouse = countries.has("US");
  const primaryDispatchCountry = hasUsWarehouse
    ? "US"
    : countries.size === 1
      ? [...countries][0]
      : "CN";

  return {
    hasUsWarehouse,
    hasUsInStock: usInStockSkuCount > 0 || (hasUsWarehouse && variants.length === 0),
    usInStockSkuCount,
    usTotalStock,
    totalStock,
    countries: [...countries].sort(),
    primaryDispatchCountry,
  };
}

export function prioritizedSendGoodsCountries(input: {
  requested?: string | null;
  destinationCountry: string;
  shipsFromValues: string[];
}): string[] {
  const dest = input.destinationCountry.trim().toUpperCase();
  const explicit = input.requested?.trim().toUpperCase() || "";
  const available = Array.from(
    new Set(
      input.shipsFromValues
        .map((item) => parseShipsFromCountryCode(item))
        .filter((code): code is string => Boolean(code)),
    ),
  );

  const ordered: string[] = [];
  const push = (code: string) => {
    if (code && !ordered.includes(code)) ordered.push(code);
  };

  if (explicit) {
    push(explicit);
    // If product actually dispatches from US (or another single origin) and explicit default fails,
    // allow falling back to the product's declared origin(s).
    if (available.includes("US") && dest === "US") push("US");
    for (const code of available) push(code);
  } else {
    if (dest === "US" && available.includes("US")) push("US");
    for (const code of available) push(code);
    push("CN");
  }

  return ordered.length > 0 ? ordered : ["CN"];
}
