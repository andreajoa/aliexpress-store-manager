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

  const response = await fetch(endpoint, {
    method: "GET",

    headers: {
      "API-Key": apiKey,
      Accept: "application/json",
    },

    cache: "no-store",

    signal: AbortSignal.timeout(60000),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Omkar respondeu HTTP ${response.status}: ${text.slice(
        0,
        300
      )}`
    );
  }

  let data: OmkarProduct;

  try {
    data = JSON.parse(text) as OmkarProduct;
  } catch {
    throw new Error(
      "A Omkar não retornou JSON válido."
    );
  }

  if (
    !data ||
    !data.id ||
    !data.title
  ) {
    throw new Error(
      "A Omkar respondeu, mas os dados essenciais do produto estão incompletos."
    );
  }

  return data;
}
