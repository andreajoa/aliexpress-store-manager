import { readFileSync } from "node:fs";

import { browserEnvelopeToProduct } from "../src/lib/aliexpress-browser-provider.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
assert(parsed.id === "3256811750293175", "browser deve preservar Product ID");
assert(parsed.currency === "USD", "browser deve preservar moeda");
assert(parsed.sku_pricing?.length === 2, "browser deve preservar todos os SKUs");
assert(parsed.sku_pricing?.[0].sku_id === "sku-blue-s", "SKU exato deve ser preservado");
assert(parsed.sku_pricing?.[0].available_quantity === 3, "estoque exato do SKU deve ser preservado");
assert(parsed.sku_pricing?.[1].sale_price === 19.5, "preço exato do SKU deve ser preservado");
assert(parsed.sku_pricing?.[0].variant_ids === "14:173,5:100014064", "caminho da variante deve ser normalizado");
assert(parsed.variants?.some((group) => group.attribute_name === "Color"), "cor deve existir");
assert(parsed.variants?.some((group) => group.attribute_name === "Size"), "tamanho deve existir");

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
const nextConfig = readFileSync("next.config.ts", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

const duplicateIndex = importRoute.indexOf("const existing = await prisma.product.findUnique");
const providerIndex = importRoute.indexOf("getAliExpressOperationalProduct(productId)");
assert(duplicateIndex >= 0 && providerIndex > duplicateIndex, "duplicata deve ser bloqueada antes de consumir fornecedor");
assert(importRoute.includes('role: "PRIMARY"'), "import deve criar fornecedor PRIMARY");
assert(importRoute.includes("supplierVariantMapping.create"), "import deve criar mappings 1:1");
assert(importRoute.includes("supplierReady: true"), "import deve confirmar prontidão do fornecedor");
assert(supplierRefresh.includes("getAliExpressOperationalProduct"), "refresh de estoque deve usar cadeia redundante");
assert(!supplierRefresh.includes("getOmkarProduct("), "refresh não pode depender diretamente do Omkar");
assert(provider.includes("OMKAR_CIRCUIT_MS"), "provider deve ter circuit breaker");
assert(provider.includes("getAliExpressBrowserProduct"), "provider deve ter fallback browser");
assert(nextConfig.includes('serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"]'), "Next deve externalizar browser serverless");
assert(packageJson.dependencies?.["@sparticuz/chromium-min"], "chromium-min precisa estar instalado");
assert(packageJson.dependencies?.["puppeteer-core"], "puppeteer-core precisa estar instalado");
assert(packageJson.scripts?.postinstall === "node scripts/postinstall.mjs", "postinstall do Chromium precisa estar ativo");

console.log("ALIEXPRESS OPERATIONAL PROVIDER FAILOVER: PASS");
