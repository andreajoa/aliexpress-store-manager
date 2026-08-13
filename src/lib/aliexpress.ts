import { createHash } from "node:crypto";

export type AliExpressExtractedProduct = {
  productId: string;
  title: string;
  description: string;
  currency: string;
  minPrice: number | null;
  maxPrice: number | null;
  images: string[];
  variants: string[];
  specifications: string[];
  sellerName: string;
  sellerId: string;
  shippingInfo: string;
  stockInfo: string;
  sourceUrl: string;
  raw: Record<string, unknown>;
};

const INVALID_TEXT = new Set([
  "",
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "unavailable",
  "not available",
  "not found",
  "-",
]);

function normalizeString(value: unknown) {
  if (typeof value !== "string") return "";

  const normalized = value.trim();

  if (INVALID_TEXT.has(normalized.toLowerCase())) {
    return "";
  }

  return normalized;
}

function cleanTitle(value: unknown) {
  return normalizeString(value)
    .replace(/\s*[-|]\s*AliExpress.*$/i, "")
    .trim();
}

function normalizeNumber(value: unknown): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value
    .replace(/[^\d,.-]/g, "")
    .trim();

  if (!cleaned) return null;

  let normalized = cleaned;

  if (
    cleaned.includes(",") &&
    cleaned.includes(".")
  ) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");

    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map(normalizeString)
        .filter(Boolean)
    )
  );
}

function imageList(value: unknown): string[] {
  return stringList(value)
    .filter((url) => /^https?:\/\//i.test(url))
    .filter(
      (url) =>
        !/avatar|logo|icon|sprite/i.test(url)
    )
    .slice(0, 50);
}

function extractNumericProductId(
  value: string
): string {
  const patterns = [
    /\/item\/(\d+)\.html/i,
    /\/item\/(\d+)/i,
    /[?&](?:productId|itemId)=(\d+)/i,
    /\b(\d{10,})\b/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function fallbackProductId(url: string) {
  return `url-${createHash("sha256")
    .update(url)
    .digest("hex")
    .slice(0, 20)}`;
}

function isAliExpressHost(hostname: string) {
  const host = hostname.toLowerCase();

  return (
    host === "aliexpress.com" ||
    host.endsWith(".aliexpress.com") ||
    host === "aliexpress.us" ||
    host.endsWith(".aliexpress.us")
  );
}

export function validateAliExpressUrl(
  rawUrl: string
) {
  const url = new URL(rawUrl);

  if (
    !["http:", "https:"].includes(url.protocol)
  ) {
    throw new Error(
      "A URL precisa usar HTTP ou HTTPS."
    );
  }

  if (!isAliExpressHost(url.hostname)) {
    throw new Error(
      "Informe uma URL válida de produto do AliExpress."
    );
  }

  return url.toString();
}

async function requestScrapingBee(
  apiKey: string,
  sourceUrl: string,
  params: Record<string, string>
) {
  const endpoint = new URL(
    "https://app.scrapingbee.com/api/v1"
  );

  endpoint.searchParams.set(
    "url",
    sourceUrl
  );

  endpoint.searchParams.set(
    "render_js",
    "true"
  );

  endpoint.searchParams.set(
    "country_code",
    "br"
  );

  endpoint.searchParams.set(
    "block_ads",
    "true"
  );

  endpoint.searchParams.set(
    "wait",
    "3000"
  );

  for (const [key, value] of Object.entries(
    params
  )) {
    endpoint.searchParams.set(key, value);
  }

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },

    signal: AbortSignal.timeout(120000),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `ScrapingBee respondeu HTTP ${response.status}: ${text.slice(
        0,
        300
      )}`
    );
  }

  try {
    return JSON.parse(text) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error(
      "O ScrapingBee não retornou JSON válido."
    );
  }
}

async function fetchMetadataFallback(
  apiKey: string,
  sourceUrl: string
) {
  const rules = {
    heading: {
      selector: "h1",
      output: "text",
    },

    ogTitle: {
      selector:
        'meta[property="og:title"]',
      output: "@content",
    },

    twitterTitle: {
      selector:
        'meta[name="twitter:title"]',
      output: "@content",
    },

    canonical: {
      selector:
        'link[rel="canonical"]',
      output: "@href",
    },
  };

  return requestScrapingBee(
    apiKey,
    sourceUrl,
    {
      extract_rules: JSON.stringify(rules),
    }
  );
}

export async function scrapeAliExpressProduct(
  rawUrl: string
): Promise<AliExpressExtractedProduct> {
  const apiKey =
    process.env.SCRAPINGBEE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "SCRAPINGBEE_API_KEY não está configurada."
    );
  }

  const sourceUrl =
    validateAliExpressUrl(rawUrl);

  const urlProductId =
    extractNumericProductId(sourceUrl);

  const extractionRules = {
    productId: {
      description:
        "Numeric AliExpress product item ID. Return an empty string if unavailable. Never return N/A.",
      type: "string",
    },

    title: {
      description:
        "Exact main product title shown on this AliExpress product page. Do not use a recommendation product. Return an empty string if unavailable. Never return N/A.",
      type: "string",
    },

    description: {
      description:
        "Factual description of the main product only. Do not invent information.",
      type: "string",
    },

    currency: {
      description:
        "Currency displayed for the main product, preferably ISO code such as BRL, USD or EUR.",
      type: "string",
    },

    minPrice: {
      description:
        "Lowest current price for the main product or its selectable variants, number only.",
      type: "number",
    },

    maxPrice: {
      description:
        "Highest current price for the main product or its selectable variants, number only.",
      type: "number",
    },

    images: {
      description:
        "Full-size images belonging only to the main product, including its gallery and product-description images. Exclude recommendations, logos, icons and seller avatars.",
      type: "list",
    },

    variants: {
      description:
        "Every selectable option of the main product exactly as displayed, such as color, size, model or kit.",
      type: "list",
    },

    specifications: {
      description:
        "Factual specifications of the main product as concise name: value strings.",
      type: "list",
    },

    sellerName: {
      description:
        "Seller or store name for this product.",
      type: "string",
    },

    sellerId: {
      description:
        "Seller or store identifier if explicitly available. Empty string if unavailable.",
      type: "string",
    },

    shippingInfo: {
      description:
        "Shipping cost, delivery estimate and origin shown for Brazil. Do not invent unavailable information.",
      type: "string",
    },

    stockInfo: {
      description:
        "Availability or stock information explicitly shown for this product.",
      type: "string",
    },
  };

  const raw = await requestScrapingBee(
    apiKey,
    sourceUrl,
    {
      ai_extract_rules:
        JSON.stringify(extractionRules),
    }
  );

  let title = cleanTitle(raw.title);

  let productId =
    urlProductId ||
    extractNumericProductId(
      normalizeString(raw.productId)
    );

  let canonicalUrl = "";

  if (!title || !productId) {
    const metadata =
      await fetchMetadataFallback(
        apiKey,
        sourceUrl
      );

    title =
      title ||
      cleanTitle(metadata.heading) ||
      cleanTitle(metadata.ogTitle) ||
      cleanTitle(metadata.twitterTitle);

    canonicalUrl =
      normalizeString(metadata.canonical);

    productId =
      productId ||
      extractNumericProductId(
        canonicalUrl
      );
  }

  if (!title || title.length < 4) {
    throw new Error(
      "A extração ficou incompleta: não consegui confirmar o título real do produto. Nada foi salvo."
    );
  }

  if (!productId) {
    productId =
      fallbackProductId(
        canonicalUrl || sourceUrl
      );
  }

  const minPrice =
    normalizeNumber(raw.minPrice);

  const maxPrice =
    normalizeNumber(raw.maxPrice) ??
    minPrice;

  const images =
    imageList(raw.images);

  if (images.length === 0) {
    throw new Error(
      "A extração ficou incompleta: nenhuma imagem válida do produto foi encontrada. Nada foi salvo."
    );
  }

  if (minPrice === null) {
    throw new Error(
      "A extração ficou incompleta: não consegui confirmar o preço do produto. Nada foi salvo."
    );
  }

  return {
    productId,
    title,
    description:
      normalizeString(raw.description),

    currency:
      normalizeString(
        raw.currency
      ).toUpperCase() || "BRL",

    minPrice,
    maxPrice,

    images,

    variants:
      stringList(raw.variants),

    specifications:
      stringList(
        raw.specifications
      ),

    sellerName:
      normalizeString(
        raw.sellerName
      ),

    sellerId:
      normalizeString(
        raw.sellerId
      ),

    shippingInfo:
      normalizeString(
        raw.shippingInfo
      ),

    stockInfo:
      normalizeString(
        raw.stockInfo
      ),

    sourceUrl:
      canonicalUrl || sourceUrl,

    raw,
  };
}
