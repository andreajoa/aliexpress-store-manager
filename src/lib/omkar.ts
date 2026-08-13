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

const ALIEXPRESS_PRODUCT_ID_PATTERNS = [
  // /item/1005006123456789.html e /item/en/1005006123456789.html
  /\/item\/(?:[^/?#]+\/)?(\d+)\.html/i,
  /\/item\/(?:[^/?#]+\/)?(\d+)(?:[/?#]|$)/i,
  // Compartilhamento do app mobile: /i/1005006123456789.html
  /\/i\/(\d+)\.html/i,
  /\/i\/(\d+)(?:[/?#]|$)/i,
  // Vitrines antigas: /store/product/nome-do-produto/123_1005006123456789.html
  /\/store\/product\/[^?#]*?_(\d+)\.html/i,
  // Landing pages e checkout: ?productId= / ?itemId= / ?productIds=
  /[?&](?:productId|productIds|itemId|itemIds)=(\d+)/i,
];

const MAX_SHORT_LINK_REDIRECTS = 6;
const SHORT_LINK_TIMEOUT_MS = 10_000;
const SHORT_LINK_BODY_LIMIT_BYTES = 256 * 1024;

export function isAliExpressHost(host: string) {
  const normalized = host.toLowerCase();
  return (
    normalized === "aliexpress.com" ||
    normalized.endsWith(".aliexpress.com") ||
    normalized === "aliexpress.us" ||
    normalized.endsWith(".aliexpress.us") ||
    normalized === "aliexpress.ru" ||
    normalized.endsWith(".aliexpress.ru")
  );
}

function parseAliExpressUrl(rawUrl: string) {
  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Informe uma URL válida do AliExpress.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Informe uma URL válida do AliExpress.");
  }

  if (!isAliExpressHost(url.hostname)) {
    throw new Error("Informe uma URL válida do AliExpress.");
  }

  return url;
}

export function findAliExpressProductId(value: string) {
  for (const pattern of ALIEXPRESS_PRODUCT_ID_PATTERNS) {
    const match = value.match(pattern);
    if (match?.[1] && /^\d{10,}$/.test(match[1])) {
      return match[1];
    }
  }

  return null;
}

export function extractAliExpressProductId(rawUrl: string) {
  const url = parseAliExpressUrl(rawUrl);

  const found = findAliExpressProductId(url.href) || findAliExpressProductId(rawUrl);
  if (found) {
    return validateProductId(found);
  }

  throw new Error(
    "A URL é do AliExpress, mas não contém um Product ID reconhecível."
  );
}

/*
 * Links curtos (a.aliexpress.com/_xxx) e de afiliado (s.click.aliexpress.com/e/_xxx)
 * não carregam o Product ID: ele só aparece depois do redirecionamento. A resolução
 * é best-effort, limitada a hosts do AliExpress, com teto de redirects e timeout.
 */
async function resolveAliExpressShortLink(
  rawUrl: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  let current = parseAliExpressUrl(rawUrl).href;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHORT_LINK_TIMEOUT_MS);

  try {
    for (let redirect = 0; redirect < MAX_SHORT_LINK_REDIRECTS; redirect++) {
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      const location = response.headers.get("location");

      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, current);

        // Nunca seguir para fora do AliExpress.
        if (!isAliExpressHost(next.hostname)) return null;

        current = next.href;

        const fromRedirect = findAliExpressProductId(current);
        if (fromRedirect) return fromRedirect;

        continue;
      }

      const fromFinalUrl = findAliExpressProductId(current);
      if (fromFinalUrl) return fromFinalUrl;

      // Alguns links de afiliado respondem 200 e redirecionam por HTML/JS.
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") || !response.body) return null;

      const body = await readLimitedText(response.body, SHORT_LINK_BODY_LIMIT_BYTES);
      return findAliExpressProductId(body);
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedText(stream: ReadableStream<Uint8Array>, limitBytes: number) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  try {
    while (received < limitBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return text;
}

/*
 * Ponto de entrada para entrada digitada pelo operador: resolve o Product ID
 * inclusive quando a URL é um link curto ou de afiliado. Fail-closed.
 */
export async function resolveAliExpressProductId(
  rawUrl: string,
  options: { fetchImpl?: typeof fetch } = {},
) {
  const url = parseAliExpressUrl(rawUrl);

  const direct = findAliExpressProductId(url.href) || findAliExpressProductId(rawUrl);
  if (direct) return validateProductId(direct);

  const resolved = await resolveAliExpressShortLink(url.href, options.fetchImpl ?? fetch);
  if (resolved) return validateProductId(resolved);

  throw new Error(
    "A URL é do AliExpress, mas não contém um Product ID reconhecível. " +
      "Abra o link no navegador e copie a URL final da página do produto, no formato " +
      "https://www.aliexpress.com/item/1005006123456789.html",
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
