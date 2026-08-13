import { globalAliExpressProductId } from "./aliexpress-catalog-id";
import { requireAliExpressSession } from "./aliexpress-connection";
import { officialDropshipProductToOperationalProduct } from "./aliexpress-official-product-provider";
import { getOmkarProduct, type OmkarProduct } from "./omkar";

export type AliExpressOperationalProvider = "ALIEXPRESS_OPEN_PLATFORM" | "OMKAR";

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

const OMKAR_FAST_TIMEOUT_MS = 5000;
const OMKAR_FAST_MAX_ATTEMPTS = 3;
const OMKAR_CIRCUIT_MS = 2 * 60 * 1000;
let omkarCircuitOpenUntil = 0;
let omkarLastFailure = "";
let officialLastFailure = "";

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
    omkarCircuitOpen: Date.now() < omkarCircuitOpenUntil,
    omkarCircuitOpenUntil: omkarCircuitOpenUntil > 0
      ? new Date(omkarCircuitOpenUntil).toISOString()
      : null,
    omkarLastFailure: omkarLastFailure || null,
    omkarMaxAttempts: OMKAR_FAST_MAX_ATTEMPTS,
    omkarTimeoutMs: OMKAR_FAST_TIMEOUT_MS,
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

  if (Date.now() < omkarCircuitOpenUntil) {
    warnings.push("Omkar temporariamente ignorado após uma falha recente.");
  } else {
    for (const candidate of candidates) {
      const converted = candidate !== productId;

      try {
        const product = await getOmkarProductFast(candidate);
        if (String(product.id) !== candidate) {
          throw new Error(
            `Omkar retornou Product ID ${product.id}, diferente do consultado ${candidate}.`,
          );
        }
        omkarCircuitOpenUntil = 0;
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

    omkarCircuitOpenUntil = Date.now() + OMKAR_CIRCUIT_MS;
    warnings.push(`Omkar indisponível: ${omkarLastFailure}`);
  }

  if (globalId) {
    warnings.push(`Variante do catálogo global (${globalId}) também não retornou dados.`);
  }

  throw new AliExpressProviderUnavailableError(
    "Não foi possível consultar SKU/estoque do produto. " +
    `API oficial: ${officialLastFailure || "não autorizada"}. ` +
    `Omkar: ${omkarLastFailure || "indisponível"}. ` +
    "Abra Configurações → AliExpress e autorize sua conta para usar a API oficial de dropshipping.",
  );
}
