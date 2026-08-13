import type {
  OmkarProduct,
  OmkarSkuPricing,
  OmkarVariantGroup,
} from "./omkar";

type BrowserResponse = {
  text(): Promise<string>;
  url(): string;
};

type BrowserResponsePage = {
  off(event: "response", handler: (response: BrowserResponse) => void): unknown;
  on(event: "response", handler: (response: BrowserResponse) => void): unknown;
};

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

async function puppeteerWithStealth(base: unknown) {
  const [{ addExtra }, stealthModule] = await Promise.all([
    import("puppeteer-extra"),
    import("puppeteer-extra-plugin-stealth"),
  ]);
  const puppeteer = addExtra(
    base as Parameters<typeof addExtra>[0],
  );
  puppeteer.use(stealthModule.default());
  return puppeteer;
}

async function launchBrowser() {
  if (process.env.VERCEL_ENV) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const core = (await import("puppeteer-core")).default;
    const puppeteer = await puppeteerWithStealth(core);
    return puppeteer.launch({
      headless: true,
      executablePath: await chromium.executablePath(),
      args: [...chromium.args, "--disable-dev-shm-usage"],
    });
  }

  const local = (await import("puppeteer")).default;
  const puppeteer = await puppeteerWithStealth(local);
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

export type AliExpressBrowserOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

type CaptureAfterNavigationResult<T> = {
  value: T | null;
  navigationError: string | null;
};

function compactError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function waitForValue<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal) {
  return new Promise<T | null>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new Error("Browser AliExpress cancelado.")));
    const timer = setTimeout(() => finish(() => resolve(null)), timeoutMs);

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export async function waitForCaptureAfterNavigation<T>(
  navigation: Promise<unknown>,
  capture: Promise<T>,
  waitAfterNavigationMs: number,
  signal?: AbortSignal,
): Promise<CaptureAfterNavigationResult<T>> {
  const first = await Promise.race([
    capture.then((value) => ({ kind: "capture" as const, value })),
    navigation.then(
      () => ({ kind: "navigation" as const, error: null }),
      (error) => ({ kind: "navigation" as const, error: compactError(error) }),
    ),
  ]);

  if (first.kind === "capture") {
    return { value: first.value, navigationError: null };
  }

  // Um timeout de navegação não significa que a resposta XHR parou. O
  // AliExpress pode continuar enviando o payload PDP depois desse timeout.
  const value = await waitForValue(capture, waitAfterNavigationMs, signal);
  return { value, navigationError: first.error };
}

function operationalEnvelope(raw: string) {
  const envelope = parseEnvelope(raw);
  const result = record(record(envelope.data).result);
  return Object.keys(record(result.SKU)).length > 0 &&
    Object.keys(record(result.PRICE)).length > 0
    ? envelope
    : null;
}

function createEnvelopeCapture(page: BrowserResponsePage) {
  let captured: Record<string, unknown> | null = null;
  let resolveCapture: (value: Record<string, unknown>) => void = () => undefined;
  const promise = new Promise<Record<string, unknown>>((resolve) => {
    resolveCapture = resolve;
  });

  const onResponse = async (response: BrowserResponse) => {
    if (captured) return;
    const url = response.url().toLowerCase();
    if (!url.includes("mtop.aliexpress") || !url.includes("pdp")) return;
    try {
      const envelope = operationalEnvelope(await response.text());
      if (envelope && !captured) {
        captured = envelope;
        resolveCapture(envelope);
      }
    } catch {
      // Nem toda resposta MTOP da página contém os módulos de SKU e preço.
    }
  };

  page.on("response", onResponse);
  return {
    current: () => captured,
    promise,
    dispose: () => page.off("response", onResponse),
  };
}

export async function getAliExpressBrowserProduct(
  productId: string,
  options: AliExpressBrowserOptions = {},
): Promise<OmkarProduct> {
  if (!/^\d{10,}$/.test(productId)) {
    throw new Error("Product ID inválido para consulta via browser AliExpress.");
  }

  if (options.signal?.aborted) {
    throw new Error("Browser AliExpress cancelado.");
  }

  const totalTimeoutMs = Math.max(30_000, options.timeoutMs ?? 72_000);
  const deadline = Date.now() + totalTimeoutMs;
  const browser = await launchBrowser();
  const closeOnAbort = () => {
    void browser.close().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", closeOnAbort, { once: true });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.setCookie({
      name: "aep_usuc_f",
      value: "site=glo&c_tp=USD&region=US&b_locale=en_US",
      domain: ".aliexpress.com",
      path: "/",
      secure: true,
    });

    const capture = createEnvelopeCapture(page as unknown as BrowserResponsePage);

    // A página global desktop é a fonte do endpoint pdp.pc.query. O domínio
    // russo permanece como rota alternativa caso a página global seja bloqueada.
    const productUrls = [
      `https://www.aliexpress.com/item/${productId}.html?gatewayAdapt=glo2usa4itemAdapt`,
      `https://aliexpress.ru/item/${productId}.html`,
    ];
    let challengeCount = 0;
    let attemptedUrls = 0;
    const navigationErrors: string[] = [];

    for (const productUrl of productUrls) {
      if (capture.current()) break;
      if (options.signal?.aborted) throw new Error("Browser AliExpress cancelado.");

      const remainingMs = deadline - Date.now();
      if (remainingMs < 8_000) break;
      attemptedUrls += 1;
      const navigationTimeoutMs = Math.min(28_000, Math.max(10_000, remainingMs - 14_000));
      const waitAfterNavigationMs = Math.min(
        14_000,
        Math.max(5_000, remainingMs - navigationTimeoutMs),
      );
      const result = await waitForCaptureAfterNavigation(
        page.goto(productUrl, {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeoutMs,
        }),
        capture.promise,
        waitAfterNavigationMs,
        options.signal,
      );
      if (result.value) break;
      if (result.navigationError) {
        navigationErrors.push(
          `${new URL(productUrl).hostname}: ${result.navigationError}`,
        );
      }

      const [pageUrl, title, body] = await Promise.all([
        Promise.resolve(page.url()),
        page.title().catch(() => ""),
        page.content().then((html) => html.slice(0, 5000)).catch(() => ""),
      ]);
      if (looksLikeChallenge(pageUrl, title, body)) {
        challengeCount += 1;
      } else {
        navigationErrors.push(`Nenhum payload PDP recebido em ${new URL(productUrl).hostname}.`);
      }
    }

    const captured = capture.current();
    capture.dispose();
    if (!captured) {
      if (attemptedUrls > 0 && challengeCount === attemptedUrls) {
        throw new Error("AliExpress exigiu verificação humana nos browsers automáticos.");
      }
      throw new Error(
        "O browser abriu o AliExpress, mas não recebeu o payload operacional do produto. " +
        (navigationErrors.at(-1) || ""),
      );
    }

    return browserEnvelopeToProduct(productId, captured);
  } finally {
    options.signal?.removeEventListener("abort", closeOnAbort);
    await browser.close().catch(() => undefined);
  }
}
