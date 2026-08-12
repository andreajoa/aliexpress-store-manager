import { getAliExpressBrowserProduct } from "./aliexpress-browser-provider";
import type { OmkarProduct } from "./omkar";

export type AliExpressOperationalProvider = "OMKAR" | "ALIEXPRESS_BROWSER";

export type AliExpressOperationalProduct = {
  product: OmkarProduct;
  provider: AliExpressOperationalProvider;
  warnings: string[];
};

const OMKAR_FAST_TIMEOUT_MS = 8000;
const OMKAR_CIRCUIT_MS = 2 * 60 * 1000;

export const OFFICIAL_CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v141.0.0/chromium-v141.0.0-pack.x64.tar";

let omkarCircuitOpenUntil = 0;
let omkarLastFailure = "";

function compactError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function validOperationalProduct(value: unknown): value is OmkarProduct {
  if (!value || typeof value !== "object") return false;
  const product = value as OmkarProduct;
  if (!product.id || !product.title) return false;
  if (!Array.isArray(product.sku_pricing) || product.sku_pricing.length === 0) return false;
  return product.sku_pricing.every((sku) =>
    Boolean(sku.sku_id) &&
    typeof sku.available_quantity === "number" &&
    Number.isFinite(sku.available_quantity) &&
    sku.available_quantity >= 0 &&
    typeof sku.sale_price === "number" &&
    Number.isFinite(sku.sale_price) &&
    sku.sale_price >= 0,
  );
}

async function getOmkarProductFast(productId: string): Promise<OmkarProduct> {
  const apiKey = process.env.OMKAR_API_KEY?.trim();
  if (!apiKey) throw new Error("OMKAR_API_KEY não configurada.");

  const endpoint = new URL("https://aliexpress-scraper-api.omkar.cloud/aliexpress/product");
  endpoint.searchParams.set("product_id", productId);

  const response = await fetch(endpoint, {
    headers: {
      "API-Key": apiKey,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(OMKAR_FAST_TIMEOUT_MS),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Omkar HTTP ${response.status}: ${body.slice(0, 180)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Omkar retornou JSON inválido.");
  }

  if (!validOperationalProduct(parsed)) {
    throw new Error("Omkar retornou produto sem SKU/preço/estoque operacional completo.");
  }

  return parsed;
}

function ensureVercelChromiumPack() {
  if (!process.env.VERCEL_ENV) return;

  const configured = process.env.CHROMIUM_PACK_URL?.trim();
  const pointsToSelfHostedBrokenPack = Boolean(
    configured && /(?:^|\/)chromium-pack\.tar(?:\?.*)?$/i.test(configured),
  );

  if (!configured || pointsToSelfHostedBrokenPack) {
    process.env.CHROMIUM_PACK_URL = OFFICIAL_CHROMIUM_PACK_URL;
  }
}

export function getAliExpressProviderHealth() {
  return {
    omkarCircuitOpen: Date.now() < omkarCircuitOpenUntil,
    omkarCircuitOpenUntil: omkarCircuitOpenUntil > 0
      ? new Date(omkarCircuitOpenUntil).toISOString()
      : null,
    omkarLastFailure: omkarLastFailure || null,
    chromiumPackUrl: process.env.VERCEL_ENV
      ? process.env.CHROMIUM_PACK_URL || OFFICIAL_CHROMIUM_PACK_URL
      : null,
  };
}

export async function getAliExpressOperationalProduct(
  productId: string,
): Promise<AliExpressOperationalProduct> {
  if (!/^\d{10,}$/.test(productId)) {
    throw new Error("Product ID do AliExpress inválido.");
  }

  const warnings: string[] = [];
  const now = Date.now();

  if (now >= omkarCircuitOpenUntil) {
    try {
      const product = await getOmkarProductFast(productId);
      omkarCircuitOpenUntil = 0;
      omkarLastFailure = "";
      return { product, provider: "OMKAR", warnings };
    } catch (error) {
      omkarLastFailure = compactError(error);
      omkarCircuitOpenUntil = Date.now() + OMKAR_CIRCUIT_MS;
      warnings.push(`Omkar indisponível: ${omkarLastFailure}`);
      console.warn("[AliExpress provider] Omkar failed; opening circuit and using browser fallback.", error);
    }
  } else {
    warnings.push("Omkar temporariamente ignorado pelo circuit breaker após falha recente.");
  }

  try {
    ensureVercelChromiumPack();
    const product = await getAliExpressBrowserProduct(productId);
    if (!validOperationalProduct(product)) {
      throw new Error("Browser retornou produto sem SKU/preço/estoque operacional completo.");
    }
    return { product, provider: "ALIEXPRESS_BROWSER", warnings };
  } catch (browserError) {
    const browserMessage = compactError(browserError);
    console.error("[AliExpress provider] Browser fallback failed.", browserError);
    throw new Error(
      `Não foi possível obter dados operacionais verificáveis do AliExpress. ` +
      `Fonte rápida: ${omkarLastFailure || "indisponível"}. ` +
      `Browser: ${browserMessage}`,
    );
  }
}
