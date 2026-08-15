import type {
  OmkarProduct,
  OmkarSkuPricing,
  OmkarVariantGroup,
} from "./omkar";

let cachedExecutablePath: string | null = null;
let executablePathPromise: Promise<string> | null = null;

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

function parseEnvelope(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const body = trimmed.startsWith("mtopjsonp") && trimmed.endsWith(")")
    ? trimmed.slice(trimmed.indexOf("(") + 1, -1)
    : trimmed;
  const parsed = JSON.parse(body) as unknown;
  return record(parsed);
}

function priceFromInfo(value: unknown): number | null {
  const info = record(value);
  const candidates = [
    info.value,
    info.amount,
    info.formatedAmount,
    info.formattedAmount,
    info.salePriceString,
    info.salePriceLocal,
  ];
  for (const candidate of candidates) {
    const parsed = finiteNumber(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function salePrice(value: unknown): number | null {
  const info = record(value);
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

function listPrice(value: unknown): number | null {
  return priceFromInfo(record(value).originalPrice);
}

function buildVariants(result: Record<string, unknown>) {
  const sku = record(result.SKU);
  const rawProperties = array(sku.skuProperties || sku.productSKUPropertyList);
  const groups: OmkarVariantGroup[] = [];

  for (const rawProperty of rawProperties) {
    const property = record(rawProperty);
    const propertyId = text(property.skuPropertyId || property.propertyId);
    const attributeName = text(property.skuPropertyName || property.propertyName) || "Variant";
    const options = [];

    for (const rawOption of array(property.skuPropertyValues || property.propertyValues)) {
      const option = record(rawOption);
      const optionId = text(option.propertyValueIdLong || option.propertyValueId || option.id);
      if (!optionId) continue;
      const pathId = propertyId ? `${propertyId}:${optionId}` : optionId;
      const optionName = text(
        option.propertyValueDisplayName || option.propertyValueName || option.name || optionId,
      );
      const image = normalizeUrl(option.skuPropertyImagePath || option.imageUrl);
      options.push({
        value_id: pathId,
        name: optionName,
        image_url: image,
        thumbnail_url: image,
      });
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

  return groups;
}

export function browserEnvelopeToProduct(
  productId: string,
  envelope: Record<string, unknown>,
): OmkarProduct {
  const result = record(record(envelope.data).result);
  const globalData = record(record(result.GLOBAL_DATA).globalData);
  const title = text(record(result.PRODUCT_TITLE).text || globalData.subject);
  const canonicalId = text(globalData.productId) || productId;
  const currency = text(globalData.currencyCode).toUpperCase() || "USD";
  const imageModule = record(result.HEADER_IMAGE_PC);
  const images = array(imageModule.imagePathList || imageModule.imgList)
    .map(normalizeUrl)
    .filter((value): value is string => Boolean(value));

  const sku = record(result.SKU);
  const pathsRaw = sku.skuPaths;
  const paths = Array.isArray(pathsRaw) ? pathsRaw : Object.values(record(pathsRaw));
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
      throw new Error(`AliExpress browser não informou estoque exato para o SKU ${skuId}.`);
    }
    const priceInfo = priceMap[skuId] || priceMap[String(path.skuId)] || {};
    const sale = salePrice(priceInfo);
    if (sale === null || sale < 0) {
      throw new Error(`AliExpress browser não informou preço exato para o SKU ${skuId}.`);
    }
    const pathText = text(path.path)
      .split(/[;,]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(",");

    skuPricing.push({
      sku_id: skuId,
      variant_ids: pathText,
      list_price: listPrice(priceInfo),
      sale_price: sale,
      formatted_sale_price: null,
      discount_label: null,
      available_quantity: Math.floor(stock),
    });
  }

  if (skuPricing.length === 0) {
    const entries = Object.entries(priceMap);
    if (entries.length === 1 && totalInventory !== null && totalInventory >= 0) {
      const [skuId, priceInfo] = entries[0];
      const sale = salePrice(priceInfo);
      if (sale !== null && sale >= 0) {
        skuPricing.push({
          sku_id: skuId,
          variant_ids: "",
          list_price: listPrice(priceInfo),
          sale_price: sale,
          formatted_sale_price: null,
          discount_label: null,
          available_quantity: Math.floor(totalInventory),
        });
      }
    }
  }

  if (!title || !canonicalId) {
    throw new Error("AliExpress browser retornou produto sem título ou Product ID verificável.");
  }
  if (images.length === 0) {
    throw new Error("AliExpress browser retornou produto sem imagens verificáveis.");
  }
  if (skuPricing.length === 0) {
    throw new Error("AliExpress browser não retornou SKUs com preço e estoque verificáveis.");
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
    variants: buildVariants(result),
    sku_pricing: skuPricing,
    seller: {
      name: text(shop.storeName || globalData.storeName) || null,
      id: text(globalData.sellerId) || null,
      logo_url: normalizeUrl(shop.logo),
    },
    has_welcome_deal: null,
    operational_provider: "ALIEXPRESS_BROWSER",
    browser_mtop_payload: envelope,
  };
}

function currentChromiumPackUrl() {
  const configured = process.env.CHROMIUM_PACK_URL?.trim();
  if (configured) return configured;

  const currentHost = process.env.VERCEL_URL?.trim();
  if (currentHost) return `https://${currentHost}/chromium-pack.tar`;

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return `https://${productionHost}/chromium-pack.tar`;

  return null;
}

async function getVercelChromiumPath() {
  if (cachedExecutablePath) return cachedExecutablePath;
  if (!executablePathPromise) {
    executablePathPromise = (async () => {
      const chromium = (await import("@sparticuz/chromium-min")).default;
      const packUrl = currentChromiumPackUrl();
      if (!packUrl) throw new Error("Chromium pack URL não está disponível no runtime Vercel.");
      const executablePath = await chromium.executablePath(packUrl);
      cachedExecutablePath = executablePath;
      return executablePath;
    })().catch((error) => {
      executablePathPromise = null;
      throw error;
    });
  }
  return executablePathPromise;
}

async function launchBrowser() {
  if (process.env.VERCEL_ENV) {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    const puppeteer = await import("puppeteer-core");
    return puppeteer.launch({
      headless: true,
      executablePath: await getVercelChromiumPath(),
      args: chromium.args,
    });
  }

  const puppeteer = await import("puppeteer");
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

function looksLikeChallenge(url: string, title: string, body: string) {
  const haystack = `${url}\n${title}\n${body}`.toLowerCase();
  return (
    haystack.includes("_____tmd_____") ||
    haystack.includes("captcha") ||
    haystack.includes("verify you are human") ||
    haystack.includes("security verification") ||
    haystack.includes("robot check") ||
    haystack.includes("slide to verify")
  );
}

export async function getAliExpressBrowserProduct(productId: string): Promise<OmkarProduct> {
  if (!/^\d{10,}$/.test(productId)) {
    throw new Error("Product ID inválido para consulta via browser AliExpress.");
  }

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    let captured: Record<string, unknown> | null = null;
    page.on("response", async (response) => {
      if (captured) return;
      const url = response.url();
      if (!url.includes("mtop.aliexpress") || !url.includes("pdp")) return;
      try {
        const raw = await response.text();
        const envelope = parseEnvelope(raw);
        const result = record(record(envelope.data).result);
        if (Object.keys(record(result.SKU)).length > 0 && Object.keys(record(result.PRICE)).length > 0) {
          captured = envelope;
        }
      } catch {
        // Not every MTOP response on the page is the product-detail payload.
      }
    });

    const productUrl = `https://www.aliexpress.com/item/${productId}.html`;
    await page.goto(productUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    for (let tick = 0; tick < 20 && !captured; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!captured) {
      const [pageUrl, title, body] = await Promise.all([
        Promise.resolve(page.url()),
        page.title().catch(() => ""),
        page.content().then((html) => html.slice(0, 5000)).catch(() => ""),
      ]);
      if (looksLikeChallenge(pageUrl, title, body)) {
        throw new Error("AliExpress exigiu verificação humana no browser. Nenhum dado operacional foi salvo.");
      }
      throw new Error("O browser abriu o AliExpress, mas não recebeu o payload operacional do produto.");
    }

    const errorRet = Array.isArray(captured.ret)
      ? captured.ret.find((entry) => typeof entry === "string" && entry.includes("::"))
      : null;
    if (errorRet) {
      throw new Error(
        `AliExpress bloqueou a extração no browser: ${errorRet}. Nenhum dado operacional foi salvo.`
      );
    }

    return browserEnvelopeToProduct(productId, captured);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
