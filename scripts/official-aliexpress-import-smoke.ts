import { readFileSync } from "node:fs";
import { officialDropshipProductToOperationalProduct } from "../src/lib/aliexpress-official-product-provider.ts";

// Final regression gate for the official AliExpress import path.
function assert(v: unknown, m: string): asserts v { if (!v) throw new Error(m); }

const envelope = {
  result: {
    ae_item_base_info_dto: { product_id: "3256811750293175", subject: "Official Test Dress", currency_code: "USD", category_id: "200003482", product_status_type: "onSelling" },
    ae_item_sku_info_dtos: {
      ae_item_sku_info_d_t_o: [
        { id: "14:193;5:100014064", sku_code: "SKU-BLACK-S", sku_available_stock: 7, offer_sale_price: "12.50", ae_sku_property_dtos: { ae_sku_property_d_t_o: [ { sku_property_id: 14, sku_property_name: "Color", property_value_definition_name: "Black" }, { sku_property_id: 5, sku_property_name: "Size", property_value_definition_name: "S" } ] } },
        { id: "14:193;5:361386", sku_code: "SKU-BLACK-M", sku_available_stock: 3, offer_sale_price: "12.50", ae_sku_property_dtos: { ae_sku_property_d_t_o: [ { sku_property_id: 14, sku_property_name: "Color", property_value_definition_name: "Black" }, { sku_property_id: 5, sku_property_name: "Size", property_value_definition_name: "M" } ] } },
      ],
    },
    ae_multimedia_info_dto: { image_urls: "https://ae01.alicdn.com/a.jpg;https://ae01.alicdn.com/b.jpg" },
    ae_store_info: { store_id: "123", store_name: "Official Store" },
    package_info_dto: { package_length: 20, package_width: 10, package_height: 5, gross_weight: 0.4 },
  },
};

const product = officialDropshipProductToOperationalProduct(envelope, "3256811750293175");
assert(product.id === "3256811750293175", "wrong product id");
assert(product.sku_pricing?.length === 2, "official SKUs were not converted");
assert(product.sku_pricing?.[0]?.available_quantity === 7, "exact stock was not preserved");
assert(product.sku_pricing?.[0]?.sale_price === 12.5, "exact price was not preserved");
const attrs = product.official_sku_attrs as Record<string,string>;
assert(attrs["SKU-BLACK-S"] === "14:193;5:100014064", "order sku attr was not preserved");

const provider = readFileSync("src/lib/aliexpress-operational-provider.ts", "utf8");
const route = readFileSync("src/app/api/import/aliexpress/route.ts", "utf8");
const form = readFileSync("src/app/products/import-form.tsx", "utf8");
const officialIndex = provider.indexOf("getOfficialProduct(candidate)");
const omkarIndex = provider.indexOf("getOmkarProductFast(automaticProductId)");
assert(officialIndex >= 0, "official provider call is missing");
assert(omkarIndex > officialIndex, "official provider must be first path");
assert(provider.includes("ALIEXPRESS_OPEN_PLATFORM"), "official provider label missing");
assert(provider.includes("getAliExpressScrapingBeeProduct"), "automatic managed-browser fallback missing");
const scrapingBeeIndex = provider.indexOf("getAliExpressScrapingBeeProduct(automaticProductId,");
const browserIndex = provider.indexOf("getAliExpressBrowserProduct(automaticProductId,");
assert(scrapingBeeIndex >= 0, "managed browser must receive the operational ID");
assert(browserIndex > scrapingBeeIndex, "local browser must remain an automatic fallback");
assert(provider.includes("Promise.any([scrapingBeeAttempt, browserAttempt])"), "automatic browsers must run concurrently");
assert(provider.includes("OMKAR_FAST_TIMEOUT_MS = 4000"), "Omkar fallback must fail fast");
assert(!route.includes("scrapeAliExpressProduct"), "editorial ScrapingBee cannot block import");
assert(route.includes("orderSkuAttr: officialSkuAttrs"), "supplier variant must persist official orderSkuAttr");
assert(!form.includes("await response.json()"), "client cannot blindly parse gateway errors as JSON");
assert(form.includes("response.status === 504"), "client must handle 504 explicitly");
assert(!form.includes("Conectar AliExpress"), "official account connection must remain optional");
console.log("OFFICIAL ALIEXPRESS IMPORT: PASS");
