import { createHash } from "node:crypto";

import type {
  OmkarProduct,
  OmkarSkuPricing,
  OmkarVariantGroup,
} from "./omkar";

const MTOP_BASE = "https://acs.aliexpress.com";
const MTOP_APP_KEY = "12574478";
const PRODUCT_API = "mtop.aliexpress.pdp.pc.query";
const PRODUCT_API_VERSION = "1.0";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

export class AliExpressMtopBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AliExpressMtopBlockedError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9,.-]/g, "").trim();
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") && !cleaned.includes(".")
    ? cleaned.replace(",", ".")
    : cleaned.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const normalized = candidate.startsWith("//") ? `https:${candidate}` : candidate;
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function md5(value: string) {
  return createHash("md5").update(value).digest("hex");
}

function signMtop(token: string, timestamp: string, data: string) {
  return md5(`${token}&${timestamp}&${MTOP_APP_KEY}&${data}`);
}

function responseCookies(headers: Headers) {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const rows = extended.getSetCookie?.() || [];
  if (rows.length > 0) return rows;
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function mergeCookies(jar: Map<string, string>, headers: Headers) {
  for (const row of responseCookies(headers)) {
    // set-cookie may be coalesced by runtimes; cookie values we need contain no commas.
    const matches = row.matchAll(/(?:^|,\s*)([A-Za-z0-9_]+)=([^;,]+)/g);
    for (const match of matches) {
      if (match[1] && match[2]) jar.set(match[1], match[2]);
    }
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function tokenFromJar(jar: Map<string, string>) {
  const raw = jar.get("_m_h5_tk") || "";
  return raw.split("_", 1)[0] || "";
}

function parseJsonEnvelope(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const body = trimmed.startsWith("mtopjsonp") && trimmed.endsWith(")")
    ? trimmed.slice(trimmed.indexOf("(") + 1, -1)
    : trimmed;
  const parsed = JSON.parse(body) as unknown;
  return record(parsed);
}

function retText(envelope: Record<string, unknown>) {
  const ret = envelope.ret;
  if (Array.isArray(ret)) return ret.map(text).filter(Boolean).join(" | ");
  return text(ret);
}

function isSuccess(envelope: Record<string, unknown>) {
  const ret = retText(envelope).toUpperCase();
  if (ret.includes("SUCCESS")) return true;
  const data = record(envelope.data);
  return Object.keys(record(data.result)).length > 0;
}

function isTokenError(envelope: Record<string, unknown>) {
  const ret = retText(envelope).toUpperCase();
  return ret.includes("TOKEN_EMPTY") || ret.includes("TOKEN_EXPIRED") || ret.includes("TOKEN_EXOIRED");
}

function isHumanValidation(envelope: Record<string, unknown>) {
  const ret = retText(envelope).toUpperCase();
  const data = record(envelope.data);
  const challengeUrl = text(data.url).toLowerCase();
  return (
    ret.includes("USER_VALIDATE") ||
    ret.includes("RGV587") ||
    challengeUrl.includes("_____tmd_____") ||
    challengeUrl.includes("captcha")
  );
}

async function rawMtopRequest(input: {
  api: string;
  version: string;
  payload: Record<string, unknown>;
  jar: Map<string, string>;
  token: string;
  referer: string;
}) {
  const data = JSON.stringify(input.payload);
  const timestamp = String(Date.now());
  const endpoint = new URL(`${MTOP_BASE}/h5/${input.api}/${input.version}/`);
  endpoint.searchParams.set("jsv", "2.6.2");
  endpoint.searchParams.set("appKey", MTOP_APP_KEY);
  endpoint.searchParams.set("t", timestamp);
  endpoint.searchParams.set("sign", signMtop(input.token || "undefined", timestamp, data));
  endpoint.searchParams.set("api", input.api);
  endpoint.searchParams.set("v", input.version);
  endpoint.searchParams.set("type", "originaljson");
  endpoint.searchParams.set("dataType", "json");
  endpoint.searchParams.set("timeout", "20000");
  endpoint.searchParams.set("AntiCreep", "true");
  endpoint.searchParams.set("AntiFlood", "true");
  endpoint.searchParams.set("data", data);

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: input.referer,
      Origin: "https://www.aliexpress.com",
      ...(input.jar.size > 0 ? { Cookie: cookieHeader(input.jar) } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });

  mergeCookies(input.jar, response.headers);
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`AliExpress MTOP respondeu HTTP ${response.status}.`);
  }

  try {
    return parseJsonEnvelope(raw);
  } catch {
    throw new Error(`AliExpress MTOP retornou uma resposta inválida (${raw.slice(0, 120)}).`);
  }
}

async function bootstrapMtopToken(jar: Map<string, string>) {
  const envelope = await rawMtopRequest({
    api: PRODUCT_API,
    version: PRODUCT_API_VERSION,
    payload: {},
    jar,
    token: "undefined",
    referer: "https://www.aliexpress.com/",
  });

  if (isHumanValidation(envelope)) {
    throw new AliExpressMtopBlockedError("AliExpress solicitou verificação humana durante o bootstrap MTOP.");
  }

  const token = tokenFromJar(jar);
  if (!token) {
    throw new Error(`AliExpress não forneceu o token MTOP esperado (${retText(envelope) || "sem código"}).`);
  }
  return token;
}

async function fetchProductEnvelope(productId: string) {
  const jar = new Map<string, string>();
  let token = await bootstrapMtopToken(jar);
  const referer = `https://www.aliexpress.com/item/${productId}.html`;
  const payload = {
    productId,
    _currency: "USD",
    _lang: "en_US",
    country: "US",
    channel: "",
    sourceType: "pc",
    pdp_ext_f: "",
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const envelope = await rawMtopRequest({
      api: PRODUCT_API,
      version: PRODUCT_API_VERSION,
      payload,
      jar,
      token,
      referer,
    });

    if (isHumanValidation(envelope)) {
      throw new AliExpressMtopBlockedError(
        `AliExpress solicitou verificação humana para o produto ${productId}.`,
      );
    }
    if (isSuccess(envelope)) return envelope;

    if (isTokenError(envelope) && attempt === 1) {
      token = tokenFromJar(jar) || await bootstrapMtopToken(jar);
      continue;
    }

    throw new Error(`AliExpress MTOP não retornou o produto (${retText(envelope) || "sem código"}).`);
  }

  throw new Error("AliExpress MTOP não retornou dados após renovar a sessão.");
}

function priceFromInfo(value: unknown): number | null {
  const info = record(value);
  const directCandidates = [
    info.value,
    info.amount,
    info.salePriceString,
    info.salePriceLocal,
    info.formatedAmount,
    info.formattedAmount,
  ];
  for (const candidate of directCandidates) {
    const parsed = finiteNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function salePrice(priceInfo: unknown): number | null {
  const info = record(priceInfo);
  const candidates = [
    info.warmUpPrice,
    info.salePrice,
    info.activityAmount,
    info.skuActivityAmount,
    info.salePriceString,
    info.salePriceLocal,
    info.originalPrice,
  ];
  for (const candidate of candidates) {
    const nested = priceFromInfo(candidate);
    if (nested !== null) return nested;
    const scalar = finiteNumber(candidate);
    if (scalar !== null) return scalar;
  }
  return null;
}

function originalPrice(priceInfo: unknown): number | null {
  return priceFromInfo(record(priceInfo).originalPrice);
}

function propertyGroups(result: Record<string, unknown>) {
  const sku = record(result.SKU);
  const properties = array(sku.skuProperties || sku.productSKUPropertyList);
  const groups: OmkarVariantGroup[] = [];
  const optionByPath = new Map<string, {
    attributeName: string;
    optionName: string;
    imageUrl: string | null;
  }>();

  for (const rawProperty of properties) {
    const property = record(rawProperty);
    const propertyId = text(property.skuPropertyId || property.propertyId);
    const attributeName = text(property.skuPropertyName || property.propertyName) || "Variant";
    const options = [];

    for (const rawValue of array(property.skuPropertyValues || property.propertyValues)) {
      const value = record(rawValue);
      const valueId = text(value.propertyValueIdLong || value.propertyValueId || value.id);
      if (!valueId) continue;
      const pathId = propertyId ? `${propertyId}:${valueId}` : valueId;
      const optionName = text(
        value.propertyValueDisplayName || value.propertyValueName || value.name || valueId,
      );
      const imageUrl = normalizeUrl(value.skuPropertyImagePath || value.imageUrl);
      options.push({
        value_id: pathId,
        name: optionName,
        image_url: imageUrl,
        thumbnail_url: imageUrl,
      });
      optionByPath.set(pathId, { attributeName, optionName, imageUrl });
    }

    if (options.length > 0) {
      groups.push({
        attribute_name: attributeName,
        attribute_id: propertyId || attributeName,
        has_color: /color|colour/i.test(attributeName),
        is_size: /size|tamanho/i.test(attributeName),
        options,
      });
    }
  }

  return { groups, optionByPath };
}

function parseMtopProduct(productId: string, envelope: Record<string, unknown>): OmkarProduct {
  const result = record(record(envelope.data).result);
  const globalData = record(record(result.GLOBAL_DATA).globalData);
  const title = text(record(result.PRODUCT_TITLE).text || globalData.subject);
  const canonicalId = text(globalData.productId) || productId;
  const currency = text(globalData.currencyCode).toUpperCase() || "USD";
  const imageModule = record(result.HEADER_IMAGE_PC);
  const images = array(imageModule.imagePathList || imageModule.imgList)
    .map(normalizeUrl)
    .filter((value): value is string => Boolean(value));
  const { groups } = propertyGroups(result);

  const skuModule = record(result.SKU);
  const pathsRaw = skuModule.skuPaths;
  const paths = Array.isArray(pathsRaw)
    ? pathsRaw
    : Object.values(record(pathsRaw));
  const priceModule = record(result.PRICE);
  const priceMap = record(priceModule.skuIdStrPriceInfoMap || priceModule.skuPriceInfoMap);
  const totalInventory = finiteNumber(record(result.QUANTITY_PC).totalAvailableInventory);
  const skuPricing: OmkarSkuPricing[] = [];

  for (const rawPath of paths) {
    const path = record(rawPath);
    const skuId = text(path.skuIdStr || path.skuId);
    if (!skuId) continue;
    const stock = finiteNumber(path.skuStock);
    if (stock === null || stock < 0) {
      throw new Error(`AliExpress MTOP não informou estoque exato para o SKU ${skuId}.`);
    }
    const priceInfo = priceMap[skuId] || priceMap[String(path.skuId)] || {};
    const sale = salePrice(priceInfo);
    if (sale === null || sale < 0) {
      throw new Error(`AliExpress MTOP não informou preço exato para o SKU ${skuId}.`);
    }
    const variantPath = text(path.path)
      .split(/[;,]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(",");

    skuPricing.push({
      sku_id: skuId,
      variant_ids: variantPath,
      list_price: originalPrice(priceInfo),
      sale_price: sale,
      formatted_sale_price: null,
      discount_label: null,
      available_quantity: Math.floor(stock),
    });
  }

  // Some no-variant listings expose only one price-map SKU.
  if (skuPricing.length === 0) {
    const entries = Object.entries(priceMap);
    if (entries.length === 1 && totalInventory !== null && totalInventory >= 0) {
      const [skuId, info] = entries[0];
      const sale = salePrice(info);
      if (sale !== null && sale >= 0) {
        skuPricing.push({
          sku_id: skuId,
          variant_ids: "",
          list_price: originalPrice(info),
          sale_price: sale,
          formatted_sale_price: null,
          discount_label: null,
          available_quantity: Math.floor(totalInventory),
        });
      }
    }
  }

  if (!title || !canonicalId) {
    throw new Error("AliExpress MTOP retornou o produto sem título ou Product ID verificável.");
  }
  if (images.length === 0) {
    throw new Error("AliExpress MTOP retornou o produto sem imagens verificáveis.");
  }
  if (skuPricing.length === 0) {
    throw new Error("AliExpress MTOP não retornou SKUs com preço e estoque verificáveis.");
  }

  const shop = record(result.SHOP_CARD_PC);
  return {
    id: canonicalId,
    title,
    category_id: globalData.categoryId ? text(globalData.categoryId) : null,
    listing_url: `https://www.aliexpress.com/item/${canonicalId}.html`,
    images,
    images_hd: images,
    video_url: null,
    package: null,
    currency,
    base_currency: currency,
    variants: groups,
    sku_pricing: skuPricing,
    seller: {
      name: text(shop.storeName || globalData.storeName) || null,
      id: text(globalData.sellerId) || null,
      logo_url: normalizeUrl(shop.logo),
    },
    has_welcome_deal: null,
    operational_provider: "ALIEXPRESS_MTOP",
    mtop_payload: envelope,
  };
}

export async function getAliExpressMtopProduct(productId: string): Promise<OmkarProduct> {
  if (!/^\d{10,}$/.test(productId)) {
    throw new Error("Product ID inválido para consulta direta no AliExpress.");
  }
  const envelope = await fetchProductEnvelope(productId);
  return parseMtopProduct(productId, envelope);
}
