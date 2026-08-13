import { readFileSync } from "node:fs";

import { browserEnvelopeToProduct } from "../src/lib/aliexpress-browser-provider.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Keep the parser regression: browser payload parsing remains available for diagnostics,
// but it is no longer allowed in the synchronous operational import path.
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

const importRoute = readFileSync("src/app/api/import/aliexpress/route.ts", "utf8");
const supplierRefresh = readFileSync("src/lib/supplier-refresh-service.ts", "utf8");
const provider = readFileSync("src/lib/aliexpress-operational-provider.ts", "utf8");

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
assert(provider.includes("OMKAR_CIRCUIT_MS"), "fallback Omkar deve manter circuit breaker");
assert(provider.includes("OMKAR_FAST_TIMEOUT_MS = 5000"), "fallback Omkar deve falhar rápido");
assert(provider.includes("getOmkarProductFast"), "Omkar deve existir apenas como fallback rápido");
assert(provider.includes("getAliExpressBrowserProduct"), "browser deve ser o terceiro fallback operacional quando Official e Omkar falham");
assert(provider.includes("BROWSER_CIRCUIT_MS"), "fallback browser deve manter circuit breaker");
assert(provider.includes('"ALIEXPRESS_BROWSER"'), "browser deve reportar provider correto");

console.log("ALIEXPRESS OPERATIONAL PROVIDER FAILOVER: PASS");
