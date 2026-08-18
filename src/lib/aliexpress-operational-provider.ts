import { getAliExpressBrowserProduct } from "./aliexpress-browser-provider";
import { globalAliExpressProductId } from "./aliexpress-catalog-id";
import { requireAliExpressSession } from "./aliexpress-connection";
import { officialDropshipProductToOperationalProduct } from "./aliexpress-official-product-provider";
import { getAliExpressScrapingBeeProduct } from "./aliexpress-scrapingbee-provider";
import { getOmkarProduct, type OmkarProduct } from "./omkar";

export type AliExpressOperationalProvider =
  | "ALIEXPRESS_OPEN_PLATFORM"
  | "OMKAR"
  | "SCRAPINGBEE_BROWSER"
  | "ALIEXPRESS_BROWSER";

export type AliExpressOperationalProduct = {
  product: OmkarProduct;
  provider: AliExpressOperationalProvider;
  requestedProductId: string;
  resolvedProductId: string;
  warnings: string[];
};

export class AliExpressProviderUnavailableError extends Error {
  readonly code = "ALIEXPRESS_PROVIDER_UNAVAILABLE";
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = "AliExpressProviderUnavailableError";
  }
}

const OMKAR_FAST_TIMEOUT_MS = 20_000;
const OMKAR_FAST_MAX_ATTEMPTS = 3;
let omkarLastFailure = "";
let officialLastFailure = "";
let scrapingBeeLastFailure = "";
let browserLastFailure = "";

function compactError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function validOperationalProduct(value: unknown): value is OmkarProduct {
  if (!value || typeof value !== "object") return false;
  const product = value as OmkarProduct;
  if (!product.id || !product.title) return false;
  if (!Array.isArray(product.sku_pricing) || product.sku_pricing.length === 0) return false;
  return product.sku_pricing.some((sku) =>
    Boolean(sku.sku_id) &&
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
  const product = await getOmkarProduct(productId, {
    maxAttempts: OMKAR_FAST_MAX_ATTEMPTS,
    timeoutMs: OMKAR_FAST_TIMEOUT_MS,
    retryDelayMs: (attempt) => Math.min(1_000, 250 * 2 ** Math.max(0, attempt - 1)),
  });
  if (!validOperationalProduct(product)) {
    throw new Error("Omkar retornou produto sem SKU/preço/estoque operacional completo.");
  }
  return product;
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
    omkarLastFailure: omkarLastFailure || null,
    omkarMaxAttempts: OMKAR_FAST_MAX_ATTEMPTS,
    omkarTimeoutMs: OMKAR_FAST_TIMEOUT_MS,
    scrapingBeeConfigured: Boolean(process.env.SCRAPINGBEE_API_KEY?.trim()),
    scrapingBeeLastFailure: scrapingBeeLastFailure || null,
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
      return {
        product,
        provider: "ALIEXPRESS_OPEN_PLATFORM",
        requestedProductId: productId,
        resolvedProductId: candidate,
        warnings,
      };
    } catch (error) {
      officialLastFailure = compactError(error);
      if (!converted) {
        warnings.push(`API oficial indisponível: ${officialLastFailure}`);
      }
      console.warn("[AliExpress provider] Official dropship API unavailable; trying Omkar fallback.", error);
    }
  }

  for (const candidate of candidates) {
    const converted = candidate !== productId;

    try {
      const product = await getOmkarProductFast(candidate);
      if (String(product.id) !== candidate) {
        throw new Error(
          `Omkar retornou Product ID ${product.id}, diferente do consultado ${candidate}.`,
        );
      }
      omkarLastFailure = "";
      if (converted) {
        warnings.push(`ID regional ${productId} convertido para o catálogo global ${candidate}.`);
      }
      return {
        product,
        provider: "OMKAR",
        requestedProductId: productId,
        resolvedProductId: candidate,
        warnings,
      };
    } catch (error) {
      omkarLastFailure = compactError(error);
      console.warn("[AliExpress provider] Omkar fallback unavailable.", error);
    }
  }
  warnings.push(`Omkar indisponível: ${omkarLastFailure}`);

  // Provedores automáticos não exigem login do usuário. Links aliexpress.us
  // usam o ID global porque é o identificador aceito pelo payload PDP.
  const automaticProductId = globalId || productId;

  try {
    const product = await getAliExpressScrapingBeeProduct(automaticProductId, {
      timeoutMs: 40_000,
    });
    if (String(product.id) !== automaticProductId) {
      throw new Error(
        `ScrapingBee retornou Product ID ${product.id}, diferente do consultado ${automaticProductId}.`,
      );
    }
    scrapingBeeLastFailure = "";
    if (automaticProductId !== productId) {
      warnings.push(`ID regional ${productId} convertido para o catálogo global ${automaticProductId}.`);
    }
    return {
      product,
      provider: "SCRAPINGBEE_BROWSER",
      requestedProductId: productId,
      resolvedProductId: String(product.id),
      warnings,
    };
  } catch (error) {
    scrapingBeeLastFailure = compactError(error);
    console.warn("[AliExpress provider] ScrapingBee fallback unavailable.", error);
  }

  try {
    const product = await getAliExpressBrowserProduct(automaticProductId);
    if (String(product.id) !== automaticProductId) {
      throw new Error(
        `Browser retornou Product ID ${product.id}, diferente do consultado ${automaticProductId}.`,
      );
    }
    browserLastFailure = "";
    if (automaticProductId !== productId) {
      warnings.push(`ID regional ${productId} convertido para o catálogo global ${automaticProductId}.`);
    }
    return {
      product,
      provider: "ALIEXPRESS_BROWSER",
      requestedProductId: productId,
      resolvedProductId: String(product.id),
      warnings,
    };
  } catch (error) {
    browserLastFailure = compactError(error);
    console.warn("[AliExpress provider] Browser fallback unavailable.", error);
  }

  if (globalId) {
    warnings.push(`Variante do catálogo global (${globalId}) também não retornou dados.`);
  }

  console.error("[AliExpress provider] All automatic providers failed.", {
    official: officialLastFailure || null,
    omkar: omkarLastFailure || null,
    scrapingBee: scrapingBeeLastFailure || null,
    browser: browserLastFailure || null,
  });
  throw new AliExpressProviderUnavailableError(
    "Não foi possível consultar SKU/estoque agora. Os provedores automáticos estão temporariamente indisponíveis. " +
    "Nada foi salvo. Tente novamente em alguns instantes.",
  );
}
