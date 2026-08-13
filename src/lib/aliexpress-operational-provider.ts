import { getAliExpressBrowserProduct } from "./aliexpress-browser-provider";
import { globalAliExpressProductId } from "./aliexpress-catalog-id";
import { requireAliExpressSession } from "./aliexpress-connection";
import { officialDropshipProductToOperationalProduct } from "./aliexpress-official-product-provider";
import type { OmkarProduct } from "./omkar";

export type AliExpressOperationalProvider = "ALIEXPRESS_OPEN_PLATFORM" | "OMKAR" | "ALIEXPRESS_BROWSER";

export type AliExpressOperationalProduct = {
  product: OmkarProduct;
  provider: AliExpressOperationalProvider;
  warnings: string[];
};

const OMKAR_FAST_TIMEOUT_MS = 5000;
const OMKAR_CIRCUIT_MS = 2 * 60 * 1000;
const BROWSER_CIRCUIT_MS = 5 * 60 * 1000;
let omkarCircuitOpenUntil = 0;
let browserCircuitOpenUntil = 0;
let omkarLastFailure = "";
let officialLastFailure = "";
let browserLastFailure = "";

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

async function getOfficialProduct(productId: string): Promise<OmkarProduct> {
  const { session, client } = await requireAliExpressSession();
  const envelope = await client.getDropshipProduct({
    session,
    productId,
    shipToCountry: "US",
    targetCurrency: "USD",
    targetLanguage: "EN",
  });
  const product = officialDropshipProductToOperationalProduct(envelope, productId);
  if (!validOperationalProduct(product)) {
    throw new Error("AliExpress Open Platform retornou produto sem SKU/preço/estoque operacional completo.");
  }
  return product;
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

export function getAliExpressProviderHealth() {
  return {
    officialConfigured: Boolean(
      process.env.ALIEXPRESS_APP_KEY?.trim() &&
      process.env.ALIEXPRESS_APP_SECRET?.trim() &&
      process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY?.trim(),
    ),
    officialLastFailure: officialLastFailure || null,
    omkarConfigured: Boolean(process.env.OMKAR_API_KEY?.trim()),
    omkarCircuitOpen: Date.now() < omkarCircuitOpenUntil,
    omkarCircuitOpenUntil: omkarCircuitOpenUntil > 0
      ? new Date(omkarCircuitOpenUntil).toISOString()
      : null,
    omkarLastFailure: omkarLastFailure || null,
    browserCircuitOpen: Date.now() < browserCircuitOpenUntil,
    browserCircuitOpenUntil: browserCircuitOpenUntil > 0
      ? new Date(browserCircuitOpenUntil).toISOString()
      : null,
    browserLastFailure: browserLastFailure || null,
  };
}

export async function getAliExpressOperationalProduct(
  productId: string,
): Promise<AliExpressOperationalProduct> {
  if (!/^\d{10,}$/.test(productId)) {
    throw new Error("Product ID do AliExpress inválido.");
  }

  const warnings: string[] = [];

  /*
   * O ID informado sempre é tentado primeiro. A variante global só é consultada
   * se a original falhar, de modo que a conversão nunca substitui um resultado
   * válido nem pode trocar o produto importado por outro.
   */
  const globalId = globalAliExpressProductId(productId);
  const candidates = globalId ? [productId, globalId] : [productId];

  for (const candidate of candidates) {
    const converted = candidate !== productId;

    try {
      const product = await getOfficialProduct(candidate);
      officialLastFailure = "";
      if (converted) {
        warnings.push(`ID regional ${productId} convertido para o catálogo global ${candidate}.`);
      }
      return { product, provider: "ALIEXPRESS_OPEN_PLATFORM", warnings };
    } catch (error) {
      officialLastFailure = compactError(error);
      if (!converted) {
        warnings.push(`API oficial indisponível: ${officialLastFailure}`);
      }
      console.warn("[AliExpress provider] Official dropship API unavailable; trying Omkar fallback.", error);
    }

    if (Date.now() < omkarCircuitOpenUntil) {
      if (!converted) {
        warnings.push("Omkar temporariamente ignorado pelo circuit breaker após falha recente.");
      }
      continue;
    }

    try {
      const product = await getOmkarProductFast(candidate);
      omkarCircuitOpenUntil = 0;
      omkarLastFailure = "";
      if (converted) {
        warnings.push(`ID regional ${productId} convertido para o catálogo global ${candidate}.`);
      }
      return { product, provider: "OMKAR", warnings };
    } catch (error) {
      omkarLastFailure = compactError(error);
      omkarCircuitOpenUntil = Date.now() + OMKAR_CIRCUIT_MS;
      if (!converted) {
        warnings.push(`Omkar indisponível: ${omkarLastFailure}`);
      }
      console.warn("[AliExpress provider] Omkar fallback unavailable.", error);
    }

    if (Date.now() < browserCircuitOpenUntil) {
      if (!converted) {
        warnings.push("Browser temporariamente ignorado pelo circuit breaker após falha recente.");
      }
      continue;
    }

    try {
      const product = await getAliExpressBrowserProduct(candidate);
      browserCircuitOpenUntil = 0;
      browserLastFailure = "";
      if (!validOperationalProduct(product)) {
        throw new Error("Browser retornou produto sem SKU/preço/estoque operacional completo.");
      }
      if (converted) {
        warnings.push(`ID regional ${productId} convertido para o catálogo global ${candidate}.`);
      }
      return { product, provider: "ALIEXPRESS_BROWSER", warnings };
    } catch (error) {
      browserLastFailure = compactError(error);
      browserCircuitOpenUntil = Date.now() + BROWSER_CIRCUIT_MS;
      if (!converted) {
        warnings.push(`Browser indisponível: ${browserLastFailure}`);
      }
      console.warn("[AliExpress provider] Browser fallback unavailable.", error);
    }
  }

  if (globalId) {
    warnings.push(`Variante do catálogo global (${globalId}) também não retornou dados.`);
  }

  throw new Error(
    "Não foi possível consultar SKU/estoque do produto. " +
    `API oficial: ${officialLastFailure || "não autorizada"}. ` +
    `Omkar: ${omkarLastFailure || "indisponível"}. ` +
    `Browser: ${browserLastFailure || "indisponível"}. ` +
    "Abra Configurações → AliExpress e autorize sua conta para usar a API oficial de dropshipping.",
  );
}
