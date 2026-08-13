import { browserEnvelopeToProduct } from "./aliexpress-browser-provider.ts";
import type { OmkarProduct } from "./omkar";

type ScrapingBeeXhr = {
  url?: unknown;
  status_code?: unknown;
  body?: unknown;
};

type ScrapingBeeJsonResponse = {
  xhr?: unknown;
};

export type ScrapingBeeRequestOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseEnvelope(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    throw new Error("Payload XHR do AliExpress não é JSON.");
  }

  const trimmed = value.trim();
  const body = trimmed.startsWith("mtopjsonp") && trimmed.endsWith(")")
    ? trimmed.slice(trimmed.indexOf("(") + 1, -1)
    : trimmed;
  return record(JSON.parse(body) as unknown);
}

function isProductDetailXhr(value: ScrapingBeeXhr) {
  const url = typeof value.url === "string" ? value.url.toLowerCase() : "";
  return url.includes("mtop.aliexpress") && url.includes("pdp");
}

export function scrapingBeeResponseToProduct(
  productId: string,
  response: ScrapingBeeJsonResponse,
): OmkarProduct {
  const xhr = Array.isArray(response.xhr) ? response.xhr as ScrapingBeeXhr[] : [];
  let lastError: unknown = null;

  for (const request of [...xhr].reverse()) {
    if (!isProductDetailXhr(request)) continue;
    if (typeof request.status_code === "number" && request.status_code >= 400) continue;

    try {
      return browserEnvelopeToProduct(productId, parseEnvelope(request.body));
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw new Error(`ScrapingBee recebeu o produto, mas o payload ficou incompleto: ${lastError.message}`);
  }
  throw new Error("ScrapingBee não recebeu o payload operacional do produto.");
}

export async function getAliExpressScrapingBeeProduct(
  productId: string,
  options: ScrapingBeeRequestOptions = {},
): Promise<OmkarProduct> {
  if (!/^\d{10,}$/.test(productId)) {
    throw new Error("Product ID inválido para consulta via ScrapingBee.");
  }

  const apiKey = options.apiKey?.trim() || process.env.SCRAPINGBEE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("SCRAPINGBEE_API_KEY não configurada.");
  }

  const endpoint = new URL("https://app.scrapingbee.com/api/v1");
  endpoint.searchParams.set("url", `https://www.aliexpress.com/item/${productId}.html`);
  endpoint.searchParams.set("render_js", "true");
  endpoint.searchParams.set("json_response", "true");
  endpoint.searchParams.set("country_code", "br");
  endpoint.searchParams.set("premium_proxy", "true");
  endpoint.searchParams.set("block_ads", "true");
  endpoint.searchParams.set("wait", "5000");
  endpoint.searchParams.set("forward_headers", "true");

  const response = await (options.fetchImpl ?? fetch)(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Spb-Accept-Language": "en-US,en;q=0.9",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(Math.max(5_000, options.timeoutMs ?? 55_000)),
  });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`ScrapingBee HTTP ${response.status}: ${raw.slice(0, 180)}`);
  }

  let parsed: ScrapingBeeJsonResponse;
  try {
    parsed = JSON.parse(raw) as ScrapingBeeJsonResponse;
  } catch {
    throw new Error("ScrapingBee retornou JSON inválido.");
  }

  return scrapingBeeResponseToProduct(productId, parsed);
}
