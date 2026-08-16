import type { OmkarProduct } from "./omkar";

const OXYLABS_TIMEOUT_MS = 90_000;

function oxylabsHeaders(): Record<string, string> {
  const username = process.env.OXYLABS_USERNAME?.trim();
  const password = process.env.OXYLABS_PASSWORD?.trim();

  if (!username || !password) {
    throw new Error("OXYLABS_USERNAME/OXYLABS_PASSWORD não configuradas.");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

export async function getAliExpressOxylabsProduct(
  productId: string,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<OmkarProduct> {
  const url = `https://www.aliexpress.us/item/${productId}.html`;
  const response = await fetch("https://realtime.oxylabs.io/v1/queries", {
    method: "POST",
    headers: oxylabsHeaders(),
    body: JSON.stringify({
      source: "universal",
      url,
      geo_location: "United States",
    }),
    signal: options?.signal,
    // Oxylabs may be slow; we rely on the caller timeout instead.
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Oxylabs falhou: HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  const results = data.results as Record<string, unknown>[] | undefined;
  const first = results?.[0];
  if (!first) {
    throw new Error("Oxylabs retornou resposta sem conteúdo.");
  }

  const content = first.content as string | undefined;
  if (!content) {
    throw new Error("Oxylabs retornou resposta sem HTML.");
  }

  // Minimal parsing: extract JSON-LD product data if present, otherwise fall back to meta tags.
  const jsonLdMatch = content.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
  );

  let parsedProduct: Record<string, unknown> | null = null;
  if (jsonLdMatch) {
    try {
      const parsed = JSON.parse(jsonLdMatch[1] ?? "");
      const array = Array.isArray(parsed) ? parsed : [parsed];
      const productEntry = array.find((item) => {
        if (!item || typeof item !== "object") return false;
        const record = item as Record<string, unknown>;
        return record["@type"] === "Product";
      });
      parsedProduct = (productEntry as Record<string, unknown>) || null;
    } catch {
      // ignore JSON parse errors and fall back to meta tags below
    }
  }

  if (!parsedProduct) {
    const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const ogTitleMatch = content.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    );
    const ogImageMatch = content.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    );
    const priceMatch = content.match(
      /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
    );

    parsedProduct = {
      name: ogTitleMatch?.[1] || titleMatch?.[1] || `AliExpress Product ${productId}`,
      image: ogImageMatch?.[1] || "",
      offers: priceMatch
        ? {
            price: priceMatch[1],
            priceCurrency: "USD",
          }
        : null,
    };
  }

  const title =
    (parsedProduct.name as string | undefined) ||
    `AliExpress Product ${productId}`;
  const image = (parsedProduct.image as string | undefined) || "";
  const images = image ? [image] : [];

  const offer = (parsedProduct.offers as Record<string, unknown> | undefined) || {};
  const priceRaw = offer.price ?? offer.lowPrice ?? offer.highPrice ?? null;
  const salePrice =
    typeof priceRaw === "number" ? priceRaw : typeof priceRaw === "string" ? Number(priceRaw) : null;
  const currency =
    (typeof offer.priceCurrency === "string" && offer.priceCurrency) ||
    (typeof offer.currency === "string" && offer.currency) ||
    "USD";

  const availability =
    typeof offer.availability === "string" ? offer.availability : "";

  return {
    id: productId,
    title: title.replace(/\s+/g, " ").trim(),
    category_id: null,
    listing_url: url,
    images,
    images_hd: images,
    video_url: null,
    package: null,
    currency: currency.toUpperCase(),
    base_currency: currency.toUpperCase(),
    variants: [],
    sku_pricing: salePrice != null && Number.isFinite(salePrice)
      ? [
          {
            sku_id: productId,
            variant_ids: "",
            list_price: salePrice,
            sale_price: salePrice,
            formatted_sale_price: null,
            discount_label: null,
            available_quantity: availability.toLowerCase().includes("instock")
              ? 99
              : 0,
          },
        ]
      : [],
    seller: {
      name: null,
      id: null,
      logo_url: null,
    },
    has_welcome_deal: null,
    operational_provider: "OXYLABS_UNIVERSAL",
    official_product_status: null,
    official_sku_attrs: {},
    official_response: {
      raw: content.slice(0, 2000),
      parsedProduct,
    },
  };
}
