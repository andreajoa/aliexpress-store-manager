import { browserEnvelopeToProduct } from "./aliexpress-browser-provider.ts";
import type { OmkarProduct } from "./omkar";

type ScrapingBeeXhr = {
  url?: unknown;
  status_code?: unknown;
  body?: unknown;
};

type ScrapingBeeJsonResponse = {
  body?: unknown;
  "initial-status-code"?: unknown;
  "resolved-url"?: unknown;
  xhr?: unknown;
};

export type ScrapingBeeRequestOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  timeoutMs?: number;
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function retryableFailure(error: unknown) {
  if (!(error instanceof Error)) return true;
  const status = error.message.match(/^ScrapingBee HTTP (\d{3}):/)?.[1];
  return status ? RETRYABLE_STATUS.has(Number(status)) : true;
}

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

function publicResponseContext(response: ScrapingBeeJsonResponse) {
  const resolvedUrl = typeof response["resolved-url"] === "string"
    ? response["resolved-url"]
    : "";
  const status = typeof response["initial-status-code"] === "number"
    ? response["initial-status-code"]
    : null;
  const body = typeof response.body === "string"
    ? response.body.slice(0, 8_000).toLowerCase()
    : "";
  const challenged = [
    "captcha",
    "verify you are human",
    "security verification",
    "slide to verify",
    "_____tmd_____",
  ].some((marker) => body.includes(marker));

  return [
    status ? `status de origem ${status}` : "",
    resolvedUrl ? `URL final ${resolvedUrl}` : "",
    challenged ? "verificação humana detectada" : "",
  ].filter(Boolean).join(", ");
}

export function buildScrapingBeeEndpoint(productId: string, mobile = false) {
  const target = mobile
    ? `https://m.aliexpress.com/item/${productId}.html`
    : `https://www.aliexpress.com/item/${productId}.html`;
  const endpoint = new URL("https://app.scrapingbee.com/api/v1");
  endpoint.searchParams.set("url", target);
  endpoint.searchParams.set("render_js", "true");
  endpoint.searchParams.set("json_response", "true");
  endpoint.searchParams.set("country_code", "us");
  endpoint.searchParams.set("stealth_proxy", "true");
  endpoint.searchParams.set("block_ads", "true");
  endpoint.searchParams.set("wait", mobile ? "7000" : "6000");
  endpoint.searchParams.set("forward_headers", "true");
  endpoint.searchParams.set("window_width", mobile ? "430" : "1440");
  endpoint.searchParams.set("window_height", mobile ? "932" : "1000");
  return endpoint;
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
  const context = publicResponseContext(response);
  throw new Error(
    "ScrapingBee não recebeu o payload operacional do produto" +
    (context ? ` (${context})` : "") +
    ".",
  );
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

  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, Math.min(2, Math.floor(options.maxAttempts ?? 2)));
  const totalTimeoutMs = Math.max(10_000, options.timeoutMs ?? 50_000);
  const attemptTimeoutMs = Math.max(8_000, Math.floor(totalTimeoutMs / maxAttempts));
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const endpoint = buildScrapingBeeEndpoint(productId, attempt > 0);

    try {
      const response = await fetchImpl(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Spb-Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(attemptTimeoutMs),
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

      try {
        return scrapingBeeResponseToProduct(productId, parsed);
      } catch (error) {
        lastError = error;
        if (attempt + 1 < maxAttempts) continue;
        throw error;
      }
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= maxAttempts || !retryableFailure(error)) break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("ScrapingBee não respondeu após novas tentativas.");
}
