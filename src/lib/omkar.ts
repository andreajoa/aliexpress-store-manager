export type OmkarVariantOption = {
  value_id: string | number;
  name: string;
  image_url?: string | null;
  thumbnail_url?: string | null;
};

export type OmkarVariantGroup = {
  attribute_name: string;
  attribute_id: string | number;
  has_color?: boolean;
  is_size?: boolean;
  options: OmkarVariantOption[];
};

export type OmkarSkuPricing = {
  sku_id: string;
  variant_ids: string;
  list_price: number | null;
  sale_price: number | null;
  formatted_sale_price?: string | null;
  discount_label?: string | null;
  available_quantity: number | null;
};

export type OmkarProduct = {
  id: string;
  title: string;
  category_id?: string | number | null;
  listing_url?: string | null;

  images?: string[];
  images_hd?: string[];
  video_url?: string | null;

  package?: {
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
    weight_kg?: number | null;
  } | null;

  currency?: string | null;
  base_currency?: string | null;

  variants?: OmkarVariantGroup[];
  sku_pricing?: OmkarSkuPricing[];

  seller?: {
    name?: string | null;
    id?: string | number | null;
    logo_url?: string | null;
  } | null;

  has_welcome_deal?: boolean | null;

  [key: string]: unknown;
};

const RETRYABLE_OMKAR_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const OMKAR_MAX_ATTEMPTS = 3;

function validateProductId(value: string) {
  if (!/^\d{10,}$/.test(value)) {
    throw new Error(
      "Não consegui identificar um Product ID válido do AliExpress."
    );
  }

  return value;
}

export function extractAliExpressProductId(rawUrl: string) {
  const url = new URL(rawUrl);

  const host = url.hostname.toLowerCase();

  const validHost =
    host === "aliexpress.com" ||
    host.endsWith(".aliexpress.com") ||
    host === "aliexpress.us" ||
    host.endsWith(".aliexpress.us");

  if (!validHost) {
    throw new Error(
      "Informe uma URL válida do AliExpress."
    );
  }

  const patterns = [
    /\/item\/(\d+)\.html/i,
    /\/item\/(\d+)/i,
    /[?&](?:productId|itemId)=(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = rawUrl.match(pattern);

    if (match?.[1]) {
      return validateProductId(match[1]);
    }
  }

  throw new Error(
    "A URL é do AliExpress, mas não contém um Product ID reconhecível."
  );
}

export function isRetryableOmkarStatus(status: number) {
  return RETRYABLE_OMKAR_STATUS.has(status);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number) {
  return Math.min(6000, 1200 * 2 ** Math.max(0, attempt - 1));
}

function userFacingOmkarError(status: number, body: string) {
  if (status === 401 || status === 403) {
    return new Error(
      "A credencial do provedor de dados do AliExpress foi recusada. Verifique a OMKAR_API_KEY."
    );
  }

  if (status === 429) {
    return new Error(
      "O provedor de dados do AliExpress atingiu o limite temporário de consultas. Aguarde alguns instantes e tente novamente."
    );
  }

  if (status >= 500) {
    return new Error(
      "O provedor de dados do AliExpress está temporariamente indisponível. O produto não foi salvo. Tente novamente em alguns instantes."
    );
  }

  return new Error(
    `Omkar respondeu HTTP ${status}: ${body.slice(0, 300)}`
  );
}

export async function getOmkarProduct(
  productId: string
): Promise<OmkarProduct> {
  const apiKey = process.env.OMKAR_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OMKAR_API_KEY não está configurada."
    );
  }

  const endpoint = new URL(
    "https://aliexpress-scraper-api.omkar.cloud/aliexpress/product"
  );

  endpoint.searchParams.set(
    "product_id",
    productId
  );

  let lastStatus = 0;
  let lastBody = "";
  let lastNetworkError: unknown = null;

  for (let attempt = 1; attempt <= OMKAR_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",

        headers: {
          "API-Key": apiKey,
          Accept: "application/json",
        },

        cache: "no-store",

        signal: AbortSignal.timeout(45000),
      });

      const text = await response.text();
      lastStatus = response.status;
      lastBody = text;

      if (!response.ok) {
        if (isRetryableOmkarStatus(response.status) && attempt < OMKAR_MAX_ATTEMPTS) {
          console.warn(
            `[Omkar] product ${productId} attempt ${attempt}/${OMKAR_MAX_ATTEMPTS} returned HTTP ${response.status}; retrying.`
          );
          await delay(retryDelayMs(attempt));
          continue;
        }

        throw userFacingOmkarError(response.status, text);
      }

      let data: OmkarProduct;

      try {
        data = JSON.parse(text) as OmkarProduct;
      } catch {
        if (attempt < OMKAR_MAX_ATTEMPTS) {
          console.warn(
            `[Omkar] product ${productId} returned invalid JSON on attempt ${attempt}; retrying.`
          );
          await delay(retryDelayMs(attempt));
          continue;
        }
        throw new Error(
          "A Omkar não retornou JSON válido após novas tentativas."
        );
      }

      if (
        !data ||
        !data.id ||
        !data.title
      ) {
        if (attempt < OMKAR_MAX_ATTEMPTS) {
          console.warn(
            `[Omkar] product ${productId} returned incomplete essential fields on attempt ${attempt}; retrying.`
          );
          await delay(retryDelayMs(attempt));
          continue;
        }
        throw new Error(
          "A Omkar respondeu, mas os dados essenciais do produto estão incompletos."
        );
      }

      return data;
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.message.startsWith("O provedor de dados") ||
          error.message.startsWith("A credencial do provedor") ||
          error.message.startsWith("Omkar respondeu HTTP") ||
          error.message.startsWith("A Omkar")
        )
      ) {
        throw error;
      }

      lastNetworkError = error;
      if (attempt < OMKAR_MAX_ATTEMPTS) {
        console.warn(
          `[Omkar] product ${productId} network failure on attempt ${attempt}/${OMKAR_MAX_ATTEMPTS}; retrying.`,
          error
        );
        await delay(retryDelayMs(attempt));
        continue;
      }
    }
  }

  if (lastStatus > 0) {
    throw userFacingOmkarError(lastStatus, lastBody);
  }

  console.error("Omkar product request failed after retries:", lastNetworkError);
  throw new Error(
    "Não foi possível conectar ao provedor de dados do AliExpress após novas tentativas. O produto não foi salvo."
  );
}
