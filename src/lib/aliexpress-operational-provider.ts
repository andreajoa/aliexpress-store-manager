import { getAliExpressBrowserProduct } from "./aliexpress-browser-provider";
import { globalAliExpressProductId } from "./aliexpress-catalog-id";
import {
  aliExpressConnectionStatus,
  requireAliExpressSession,
} from "./aliexpress-connection";
import { officialDropshipProductToOperationalProduct } from "./aliexpress-official-product-provider";
import { getAliExpressOxylabsProduct } from "./aliexpress-oxylabs-provider";
import { getAliExpressScrapingBeeProduct } from "./aliexpress-scrapingbee-provider";
import { getOmkarProduct, type OmkarProduct } from "./omkar";

export type AliExpressOperationalProvider =
  | "ALIEXPRESS_OPEN_PLATFORM"
  | "OMKAR"
  | "SCRAPINGBEE_BROWSER"
  | "ALIEXPRESS_BROWSER"
  | "OXYLABS_UNIVERSAL";

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

const OMKAR_FAST_TIMEOUT_MS = 4000;
const OMKAR_FAST_MAX_ATTEMPTS = 2;
const SCRAPINGBEE_TIMEOUT_MS = 86_000;
const OXYLABS_TIMEOUT_MS = 90_000;
const BROWSER_TIMEOUT_MS = 72_000;

let omkarLastFailure = "";
let officialLastFailure = "";
let scrapingBeeLastFailure = "";
let oxylabsLastFailure = "";
let browserLastFailure = "";

function compactError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function providerDurationMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function officialConfigured() {
  return Boolean(
    process.env.ALIEXPRESS_APP_KEY?.trim() &&
    process.env.ALIEXPRESS_APP_SECRET?.trim() &&
    process.env.ALIEXPRESS_OAUTH_REDIRECT_URI?.trim() &&
    process.env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY?.trim(),
  );
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
    throw new Error(
      "AliExpress Open Platform retornou produto sem SKU/preço/estoque operacional completo.",
    );
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
    officialConfigured: officialConfigured(),
    officialLastFailure: officialLastFailure || null,
    omkarConfigured: Boolean(process.env.OMKAR_API_KEY?.trim()),
    omkarLastFailure: omkarLastFailure || null,
    omkarMaxAttempts: OMKAR_FAST_MAX_ATTEMPTS,
    omkarTimeoutMs: OMKAR_FAST_TIMEOUT_MS,
    scrapingBeeConfigured: Boolean(process.env.SCRAPINGBEE_API_KEY?.trim()),
    scrapingBeeLastFailure: scrapingBeeLastFailure || null,
    oxylabsConfigured: Boolean(
      process.env.OXYLABS_USERNAME?.trim() && process.env.OXYLABS_PASSWORD?.trim(),
    ),
    oxylabsLastFailure: oxylabsLastFailure || null,
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
  const failures = {
    official: "",
    omkar: "",
    scrapingBee: "",
    oxylabs: "",
    browser: "",
  };

  const globalId = globalAliExpressProductId(productId);
  const candidates = globalId ? [productId, globalId] : [productId];

  let officialConnected = false;
  try {
    officialConnected = (await aliExpressConnectionStatus()).connected;
  } catch (error) {
    failures.official = compactError(error);
    officialLastFailure = failures.official;
    console.warn(
      "[AliExpress provider] Could not read official connection status; using automatic providers.",
      { productId, error: failures.official },
    );
  }

  if (officialConnected) {
    for (const candidate of candidates) {
      const converted = candidate !== productId;
      const startedAt = Date.now();

      try {
        const product = await getOfficialProduct(candidate);
        officialLastFailure = "";
        console.info("[AliExpress provider] Official provider succeeded.", {
          productId: candidate,
          durationMs: providerDurationMs(startedAt),
        });

        if (converted) {
          warnings.push(
            `ID regional ${productId} convertido para o catálogo global ${candidate}.`,
          );
        }

        return {
          product,
          provider: "ALIEXPRESS_OPEN_PLATFORM",
          requestedProductId: productId,
          resolvedProductId: candidate,
          warnings,
        };
      } catch (error) {
        failures.official = compactError(error);
        officialLastFailure = failures.official;

        if (!converted) {
          warnings.push(`API oficial indisponível: ${failures.official}`);
        }

        console.warn(
          "[AliExpress provider] Official provider failed; using automatic providers.",
          {
            productId: candidate,
            durationMs: providerDurationMs(startedAt),
            error: failures.official,
          },
        );
      }
    }
  } else if (!failures.official) {
    failures.official = officialConfigured()
      ? "credenciais configuradas, mas a conta ainda não está autorizada em Configurações → AliExpress"
      : "credenciais da AliExpress Open Platform ainda não estão configuradas no ambiente";
    officialLastFailure = failures.official;
    console.info(
      "[AliExpress provider] Official provider skipped because no active session exists.",
      { productId, reason: failures.official },
    );
  }

  const automaticProductId = globalId || productId;

  const omkarStartedAt = Date.now();
  try {
    const product = await getOmkarProductFast(automaticProductId);
    if (String(product.id) !== automaticProductId) {
      throw new Error(
        `Omkar retornou Product ID ${product.id}, diferente do consultado ${automaticProductId}.`,
      );
    }

    omkarLastFailure = "";
    console.info("[AliExpress provider] Omkar provider succeeded.", {
      productId: automaticProductId,
      durationMs: providerDurationMs(omkarStartedAt),
    });

    if (automaticProductId !== productId) {
      warnings.push(
        `ID regional ${productId} convertido para o catálogo global ${automaticProductId}.`,
      );
    }

    return {
      product,
      provider: "OMKAR",
      requestedProductId: productId,
      resolvedProductId: automaticProductId,
      warnings,
    };
  } catch (error) {
    failures.omkar = compactError(error);
    omkarLastFailure = failures.omkar;
    console.warn("[AliExpress provider] Omkar fallback unavailable.", {
      productId: automaticProductId,
      durationMs: providerDurationMs(omkarStartedAt),
      error: failures.omkar,
    });
  }

  warnings.push(`Omkar indisponível: ${failures.omkar}`);

  const fallbackController = new AbortController();

  const scrapingBeeAttempt = (async () => {
    const startedAt = Date.now();
    try {
      const product = await getAliExpressScrapingBeeProduct(automaticProductId, {
        maxAttempts: 1,
        timeoutMs: SCRAPINGBEE_TIMEOUT_MS,
        signal: fallbackController.signal,
      });

      if (String(product.id) !== automaticProductId) {
        throw new Error(
          `ScrapingBee retornou Product ID ${product.id}, diferente do consultado ${automaticProductId}.`,
        );
      }

      scrapingBeeLastFailure = "";
      console.info("[AliExpress provider] ScrapingBee provider succeeded.", {
        productId: automaticProductId,
        durationMs: providerDurationMs(startedAt),
      });
      return { product, provider: "SCRAPINGBEE_BROWSER" as const };
    } catch (error) {
      if (!fallbackController.signal.aborted) {
        failures.scrapingBee = compactError(error);
        scrapingBeeLastFailure = failures.scrapingBee;
        console.warn("[AliExpress provider] ScrapingBee fallback unavailable.", {
          productId: automaticProductId,
          durationMs: providerDurationMs(startedAt),
          error: failures.scrapingBee,
        });
      }
      throw error;
    }
  })();

  const browserAttempt = (async () => {
    const startedAt = Date.now();
    try {
      const product = await getAliExpressBrowserProduct(automaticProductId, {
        timeoutMs: BROWSER_TIMEOUT_MS,
        signal: fallbackController.signal,
      });

      if (String(product.id) !== automaticProductId) {
        throw new Error(
          `Browser retornou Product ID ${product.id}, diferente do consultado ${automaticProductId}.`,
        );
      }

      browserLastFailure = "";
      console.info("[AliExpress provider] Browser provider succeeded.", {
        productId: automaticProductId,
        durationMs: providerDurationMs(startedAt),
      });
      return { product, provider: "ALIEXPRESS_BROWSER" as const };
    } catch (error) {
      if (!fallbackController.signal.aborted) {
        failures.browser = compactError(error);
        browserLastFailure = failures.browser;
        console.warn("[AliExpress provider] Browser fallback unavailable.", {
          productId: automaticProductId,
          durationMs: providerDurationMs(startedAt),
          error: failures.browser,
        });
      }
      throw error;
    }
  })();

  const oxylabsAttempt = (async () => {
    const startedAt = Date.now();
    try {
      const product = await getAliExpressOxylabsProduct(automaticProductId, {
        timeoutMs: OXYLABS_TIMEOUT_MS,
        signal: fallbackController.signal,
      });

      if (String(product.id) !== automaticProductId) {
        throw new Error(
          `Oxylabs retornou Product ID ${product.id}, diferente do consultado ${automaticProductId}.`,
        );
      }

      oxylabsLastFailure = "";
      console.info("[AliExpress provider] Oxylabs provider succeeded.", {
        productId: automaticProductId,
        durationMs: providerDurationMs(startedAt),
      });
      return { product, provider: "OXYLABS_UNIVERSAL" as const };
    } catch (error) {
      if (!fallbackController.signal.aborted) {
        failures.oxylabs = compactError(error);
        oxylabsLastFailure = failures.oxylabs;
        console.warn("[AliExpress provider] Oxylabs fallback unavailable.", {
          productId: automaticProductId,
          durationMs: providerDurationMs(startedAt),
          error: failures.oxylabs,
        });
      }
      throw error;
    }
  })();

  try {
    // Promise.any espera a primeira RESPOSTA COM SUCESSO. Uma falha rápida de
    // um provedor (por exemplo Oxylabs 401) não pode cancelar os demais.
    const winner = await Promise.any([
      oxylabsAttempt,
      scrapingBeeAttempt,
      browserAttempt,
    ]);

    fallbackController.abort("AliExpress provider selected");

    if (automaticProductId !== productId) {
      warnings.push(
        `ID regional ${productId} convertido para o catálogo global ${automaticProductId}.`,
      );
    }

    return {
      product: winner.product,
      provider: winner.provider,
      requestedProductId: productId,
      resolvedProductId: String(winner.product.id),
      warnings,
    };
  } catch {
    fallbackController.abort("All AliExpress automatic providers failed");
  }

  console.error("[AliExpress provider] All providers failed.", {
    productId: automaticProductId,
    official: failures.official || null,
    omkar: failures.omkar || null,
    scrapingBee: failures.scrapingBee || null,
    oxylabs: failures.oxylabs || null,
    browser: failures.browser || null,
  });

  throw new AliExpressProviderUnavailableError(
    "Todos os provedores de dados do AliExpress falharam. " +
      `API oficial: ${failures.official || "sem resposta"}. ` +
      `Omkar: ${failures.omkar || "sem resposta"}. ` +
      `ScrapingBee: ${failures.scrapingBee || "sem resposta"}. ` +
      `Oxylabs: ${failures.oxylabs || "sem resposta"}. ` +
      `Browser: ${failures.browser || "sem resposta"}. ` +
      "Se a API oficial estiver configurada, confirme a autorização em Configurações → AliExpress e tente novamente.",
  );
}
