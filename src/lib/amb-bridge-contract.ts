export type AmbProductBinding = {
  sourceProductId: string;
  color: string;
};

export type AmbBridgeConfig = {
  version: number;
  mode: string;
  products: Record<string, AmbProductBinding>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalized(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAmbBridgeConfig(value: unknown): AmbBridgeConfig | null {
  const root = record(value);
  const bridge = record(root.ambBridge);
  const products = record(bridge.products);
  if (Number(bridge.version) !== 1 || Object.keys(products).length === 0) return null;

  const parsed: Record<string, AmbProductBinding> = {};
  for (const [slug, raw] of Object.entries(products)) {
    const binding = record(raw);
    const sourceProductId = text(binding.sourceProductId);
    const color = text(binding.color);
    if (!slug.trim() || !sourceProductId || !color) continue;
    parsed[slug] = { sourceProductId, color };
  }
  if (Object.keys(parsed).length === 0) return null;
  return {
    version: 1,
    mode: text(bridge.mode) || "backend-only",
    products: parsed,
  };
}

export type AliExpressFreightChoice = {
  serviceName: string;
  amount: number | null;
  estimatedDeliveryTime: string | null;
};

export function chooseAliExpressFreight<T extends AliExpressFreightChoice>(
  quotes: T[],
  preferred = "AliExpress Standard Shipping",
): T | null {
  if (quotes.length === 0) return null;
  const exact = quotes.find((quote) => normalized(quote.serviceName) === normalized(preferred));
  if (exact) return exact;
  const standard = quotes.find((quote) => normalized(quote.serviceName).includes("aliexpress standard"));
  if (standard) return standard;
  return [...quotes].sort((a, b) => {
    const amountA = a.amount == null ? Number.POSITIVE_INFINITY : a.amount;
    const amountB = b.amount == null ? Number.POSITIVE_INFINITY : b.amount;
    return amountA - amountB || a.serviceName.localeCompare(b.serviceName);
  })[0] || null;
}
