const puppeteer = await import("puppeteer");

const productId = process.env.ALIEXPRESS_MTOP_TEST_PRODUCT_ID || "3256811750293175";
const url = `https://www.aliexpress.com/item/${productId}.html`;

function parseEnvelope(raw) {
  const trimmed = raw.trim();
  const body = trimmed.startsWith("mtopjsonp") && trimmed.endsWith(")")
    ? trimmed.slice(trimmed.indexOf("(") + 1, -1)
    : trimmed;
  return JSON.parse(body);
}

function priceValue(info) {
  if (!info || typeof info !== "object") return null;
  const candidates = [
    info.warmUpPrice,
    info.salePrice,
    info.activityAmount,
    info.skuActivityAmount,
    info.salePriceString,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      const raw = candidate.value ?? candidate.amount ?? candidate.formatedAmount ?? candidate.formattedAmount;
      const parsed = Number(String(raw ?? "").replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    } else if (candidate !== null && candidate !== undefined) {
      const parsed = Number(String(candidate).replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

const browser = await puppeteer.default.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

  let captured = null;
  page.on("response", async (response) => {
    if (captured) return;
    const responseUrl = response.url();
    if (!responseUrl.includes("mtop.aliexpress") || !responseUrl.includes("pdp")) return;
    try {
      const raw = await response.text();
      const envelope = parseEnvelope(raw);
      const result = envelope?.data?.result;
      if (result?.SKU && result?.PRICE) captured = envelope;
    } catch {
      // Ignore unrelated MTOP responses.
    }
  });

  const navigation = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const status = navigation?.status() || 0;

  for (let i = 0; i < 30 && !captured; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!captured) {
    const pageUrl = page.url();
    const title = await page.title().catch(() => "");
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 800) || "").catch(() => "");
    throw new Error(`Nenhum PDP MTOP capturado. HTTP=${status} URL=${pageUrl} TITLE=${title} BODY=${body}`);
  }

  const result = captured.data.result;
  const pathsRaw = result.SKU?.skuPaths || {};
  const paths = Array.isArray(pathsRaw) ? pathsRaw : Object.values(pathsRaw);
  const priceMap = result.PRICE?.skuIdStrPriceInfoMap || result.PRICE?.skuPriceInfoMap || {};

  if (!paths.length) throw new Error("Browser capturou PDP, mas nenhum skuPath foi retornado.");

  let valid = 0;
  let stock = 0;
  for (const path of paths) {
    const skuId = String(path?.skuIdStr || path?.skuId || "");
    const skuStock = Number(path?.skuStock);
    const price = priceValue(priceMap[skuId] || priceMap[String(path?.skuId)]);
    if (!skuId || !Number.isFinite(skuStock) || skuStock < 0 || price === null) continue;
    valid += 1;
    stock += skuStock;
  }

  if (!valid) throw new Error("Browser capturou PDP, mas não encontrou SKU com preço e estoque verificáveis.");

  console.log(JSON.stringify({
    ok: true,
    productId,
    title: result.PRODUCT_TITLE?.text || result.GLOBAL_DATA?.globalData?.subject || null,
    skuPaths: paths.length,
    validSkus: valid,
    totalStock: stock,
    images: result.HEADER_IMAGE_PC?.imagePathList?.length || 0,
  }, null, 2));
} finally {
  await browser.close();
}
