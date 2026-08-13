import { readFileSync } from "node:fs";

import {
  browserEnvelopeToProduct,
  waitForCaptureAfterNavigation,
} from "../src/lib/aliexpress-browser-provider.ts";
import { globalAliExpressProductId } from "../src/lib/aliexpress-catalog-id.ts";
import {
  buildScrapingBeeEndpoint,
  getAliExpressScrapingBeeProduct,
  scrapingBeeAttemptTimeouts,
  scrapingBeeResponseToProduct,
} from "../src/lib/aliexpress-scrapingbee-provider.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// O mesmo payload PDP precisa funcionar vindo do browser local ou do browser
// gerenciado pelo ScrapingBee, sem login na conta AliExpress do usuário.
const fixture = {
  data: {
    result: {
      GLOBAL_DATA: {
        globalData: {
          productId: "3256811750293175",
          subject: "Fixture Dress",
          currencyCode: "USD",
          sellerId: "seller-1",
          storeName: "Fixture Store",
        },
      },
      PRODUCT_TITLE: { text: "Fixture Dress" },
      HEADER_IMAGE_PC: {
        imagePathList: ["https://example.test/one.jpg", "https://example.test/two.jpg"],
      },
      QUANTITY_PC: { totalAvailableInventory: 7 },
      SKU: {
        skuProperties: [
          {
            skuPropertyId: 14,
            skuPropertyName: "Color",
            skuPropertyValues: [
              {
                propertyValueIdLong: 173,
                propertyValueName: "Blue",
                skuPropertyImagePath: "https://example.test/blue.jpg",
              },
            ],
          },
          {
            skuPropertyId: 5,
            skuPropertyName: "Size",
            skuPropertyValues: [
              { propertyValueIdLong: 100014064, propertyValueName: "S" },
              { propertyValueIdLong: 361386, propertyValueName: "M" },
            ],
          },
        ],
        skuPaths: {
          a: { skuIdStr: "sku-blue-s", path: "14:173;5:100014064", skuStock: 3 },
          b: { skuIdStr: "sku-blue-m", path: "14:173;5:361386", skuStock: 4 },
        },
      },
      PRICE: {
        skuIdStrPriceInfoMap: {
          "sku-blue-s": {
            salePrice: { value: 18.25, currency: "USD" },
            originalPrice: { value: 24, currency: "USD" },
          },
          "sku-blue-m": {
            salePrice: { value: 19.5, currency: "USD" },
            originalPrice: { value: 25, currency: "USD" },
          },
        },
      },
      SHOP_CARD_PC: { storeName: "Fixture Store" },
    },
  },
};

const parsed = browserEnvelopeToProduct("3256811750293175", fixture);
assert(parsed.id === "3256811750293175", "browser parser deve preservar Product ID");
assert(parsed.sku_pricing?.length === 2, "browser parser deve preservar SKUs verificáveis");
assert(parsed.sku_pricing?.[0].available_quantity === 3, "browser parser deve preservar estoque exato");

const scrapingBeeParsed = scrapingBeeResponseToProduct("3256811750293175", {
  xhr: [{
    url: "https://acs.aliexpress.com/h5/mtop.aliexpress.pdp.pc.query/1.0/",
    status_code: 200,
    body: `mtopjsonp1(${JSON.stringify(fixture)})`,
  }],
});
assert(scrapingBeeParsed.sku_pricing?.length === 2, "ScrapingBee deve reutilizar o payload PDP operacional");

const configuredEndpoint = buildScrapingBeeEndpoint("3256811750293175");
assert(configuredEndpoint.searchParams.get("stealth_proxy") === "true", "ScrapingBee deve usar stealth proxy para AliExpress");
assert(configuredEndpoint.searchParams.get("premium_proxy") === null, "ScrapingBee não deve usar o proxy comum no AliExpress");
assert(configuredEndpoint.searchParams.get("country_code") === "us", "ScrapingBee deve consultar preço operacional dos EUA");
assert(configuredEndpoint.searchParams.get("wait_browser") === "domcontentloaded", "ScrapingBee não deve esperar o carregamento total da página");
assert(configuredEndpoint.searchParams.get("block_resources") === "true", "ScrapingBee deve bloquear recursos visuais desnecessários");
const managedTimeouts = scrapingBeeAttemptTimeouts(82_000, 2);
assert(managedTimeouts[0] >= 45_000, "tentativa desktop do ScrapingBee precisa de orçamento realista");
assert(managedTimeouts[1] >= 30_000, "tentativa mobile do ScrapingBee precisa preservar tempo útil");

const capturedAfterTimeout = await waitForCaptureAfterNavigation(
  Promise.reject(new Error("Navigation timeout of 18000 ms exceeded")),
  new Promise<string>((resolve) => setTimeout(() => resolve("PDP_CAPTURED"), 5)),
  100,
);
assert(capturedAfterTimeout.value === "PDP_CAPTURED", "browser deve aceitar o payload que chega após timeout de navegação");
assert(capturedAfterTimeout.navigationError?.includes("Navigation timeout"), "browser deve preservar o diagnóstico de navegação");

let requestedScrapingBeeUrl = "";
let scrapingBeeFetchAttempts = 0;
const fetchedThroughScrapingBee = await getAliExpressScrapingBeeProduct("3256811750293175", {
  apiKey: "test-key",
  timeoutMs: 20_000,
  fetchImpl: async (input) => {
    scrapingBeeFetchAttempts += 1;
    requestedScrapingBeeUrl = String(input);
    if (scrapingBeeFetchAttempts === 1) {
      return new Response(JSON.stringify({
        body: "<html><body>product shell without PDP XHR</body></html>",
        "initial-status-code": 200,
        "resolved-url": "https://www.aliexpress.com/item/3256811750293175.html",
        xhr: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      xhr: [{
        url: "https://acs.aliexpress.com/h5/mtop.aliexpress.pdp.pc.query/1.0/",
        status_code: 200,
        body: fixture,
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
});
assert(fetchedThroughScrapingBee.id === "3256811750293175", "ScrapingBee deve retornar o produto consultado");
assert(scrapingBeeFetchAttempts === 2, "ScrapingBee deve tentar a página mobile quando o desktop não entrega PDP");
assert(requestedScrapingBeeUrl.includes("m.aliexpress.com"), "segunda tentativa do ScrapingBee deve usar o domínio mobile");
assert(requestedScrapingBeeUrl.includes("json_response=true"), "ScrapingBee deve capturar XHRs da página");
assert(requestedScrapingBeeUrl.includes("stealth_proxy=true"), "ScrapingBee deve usar proxy anti-bloqueio");

let rejectedCredentialAttempts = 0;
try {
  await getAliExpressScrapingBeeProduct("3256811750293175", {
    apiKey: "rejected-key",
    maxAttempts: 2,
    fetchImpl: async () => {
      rejectedCredentialAttempts += 1;
      return new Response("invalid api key", { status: 401 });
    },
  });
} catch {
  // A credencial recusada deve falhar imediatamente, sem gastar nova tentativa.
}
assert(rejectedCredentialAttempts === 1, "ScrapingBee não deve repetir erro de credencial");

let missingStockBlocked = false;
try {
  browserEnvelopeToProduct("3256811750293175", {
    ...fixture,
    data: {
      result: {
        ...fixture.data.result,
        SKU: {
          ...fixture.data.result.SKU,
          skuPaths: {
            broken: { skuIdStr: "broken", path: "14:173;5:100014064" },
          },
        },
        PRICE: {
          skuIdStrPriceInfoMap: {
            broken: { salePrice: { value: 18.25 } },
          },
        },
      },
    },
  });
} catch {
  missingStockBlocked = true;
}
assert(missingStockBlocked, "SKU sem estoque verificável deve ser bloqueado");
assert(
  globalAliExpressProductId("3256807571372169") === "1005007757686921",
  "ID regional aliexpress.us deve resolver para o catálogo global",
);
assert(
  globalAliExpressProductId("3256802810470585") === "1005002996785337",
  "produto relatado deve resolver para o ID global correto",
);

const importRoute = readFileSync("src/app/api/import/aliexpress/route.ts", "utf8");
const supplierRefresh = readFileSync("src/lib/supplier-refresh-service.ts", "utf8");
const provider = readFileSync("src/lib/aliexpress-operational-provider.ts", "utf8");
const form = readFileSync("src/app/products/import-form.tsx", "utf8");

const duplicateIndex = importRoute.indexOf("const existing = await prisma.product.findUnique");
const providerIndex = importRoute.indexOf("getAliExpressOperationalProduct(productId)");
assert(duplicateIndex >= 0 && providerIndex > duplicateIndex, "duplicata deve ser bloqueada antes de consumir fornecedor");
assert(importRoute.includes('role: "PRIMARY"'), "import deve criar fornecedor PRIMARY");
assert(importRoute.includes("supplierVariantMapping.create"), "import deve criar mappings 1:1");
assert(importRoute.includes("supplierReady: true"), "import deve confirmar prontidão do fornecedor");
assert(importRoute.includes("orderSkuAttr: officialSkuAttrs"), "import oficial deve guardar orderSkuAttr para fulfillment");
assert(supplierRefresh.includes("getAliExpressOperationalProduct"), "refresh de estoque deve usar cadeia operacional compartilhada");
assert(!supplierRefresh.includes("getOmkarProduct("), "refresh não pode depender diretamente do Omkar");

assert(provider.includes("requireAliExpressSession"), "provider deve usar sessão OAuth oficial do AliExpress");
assert(provider.includes("getDropshipProduct"), "provider deve consultar aliexpress.ds.product.get");
assert(provider.includes('provider: "ALIEXPRESS_OPEN_PLATFORM"'), "API oficial deve ser o caminho primário");
assert(!provider.includes("OMKAR_CIRCUIT_MS"), "falha anterior do Omkar não pode bloquear uma nova tentativa do usuário");
assert(provider.includes("OMKAR_FAST_TIMEOUT_MS = 4000"), "fallback Omkar deve falhar rápido");
assert(provider.includes("OMKAR_FAST_MAX_ATTEMPTS = 2"), "fallback Omkar não deve consumir o orçamento dos browsers");
assert(provider.includes("getOmkarProductFast"), "Omkar deve existir apenas como fallback rápido");
assert(provider.includes("getAliExpressScrapingBeeProduct"), "ScrapingBee deve contornar bloqueio do browser sem login AliExpress");
const scrapingBeeIndex = provider.indexOf("getAliExpressScrapingBeeProduct(automaticProductId,");
const browserIndex = provider.indexOf("getAliExpressBrowserProduct(automaticProductId,");
assert(scrapingBeeIndex >= 0, "provider deve chamar ScrapingBee com o ID operacional");
assert(browserIndex > scrapingBeeIndex, "provider deve iniciar os dois browsers automáticos");
assert(provider.includes("Promise.any([scrapingBeeAttempt, browserAttempt])"), "browsers lentos devem disputar o mesmo orçamento em paralelo");
assert(provider.includes("aliExpressConnectionStatus"), "API oficial deve ser ignorada quando não existe sessão ativa");
assert(provider.includes("getOmkarProductFast(automaticProductId)"), "Omkar deve começar pelo ID global conhecido");
assert(provider.includes("resolvedProductId"), "provider deve informar o ID canônico realmente consultado");
assert(importRoute.includes("existingResolved"), "import deve impedir duplicata após converter ID regional");
assert(importRoute.includes("sourceProductId: resolvedProductId"), "import deve persistir o ID canônico do fornecedor");
assert(!importRoute.includes("actionUrl"), "falha automática não pode obrigar autorização AliExpress");
assert(!form.includes("Conectar AliExpress"), "formulário de importação não pode exigir login AliExpress");

const browserProvider = readFileSync("src/lib/aliexpress-browser-provider.ts", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");
assert(browserProvider.includes('import("@sparticuz/chromium")'), "browser Vercel deve usar Chromium empacotado");
assert(browserProvider.includes('import("puppeteer-extra-plugin-stealth")'), "browser deve aplicar proteção antirrobô");
assert(browserProvider.includes("www.aliexpress.com/item/"), "browser deve consultar a página global que dispara o PDP PC");
assert(!browserProvider.includes("chromium-min"), "browser Vercel não pode baixar pack remoto durante a importação");
assert(packageJson.includes('\"@sparticuz/chromium\": \"^141.0.0\"'), "Chromium deve ser dependência de produção");
assert(packageJson.includes('\"puppeteer-extra-plugin-stealth\"'), "plugin stealth deve ser dependência de produção");
assert(!packageJson.includes('\"@sparticuz/chromium-min\"'), "chromium-min remoto não deve permanecer instalado");
assert(nextConfig.includes("outputFileTracingIncludes"), "build deve incluir os binários Chromium nas rotas operacionais");

console.log("ALIEXPRESS OPERATIONAL PROVIDER FAILOVER: PASS");
