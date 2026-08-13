import { readFileSync } from "node:fs";

import {
  chooseAliExpressFreight,
  parseAmbBridgeConfig,
} from "../src/lib/amb-bridge-contract.ts";
import {
  inferAmbBinding,
  parseAmbGeneratedProductsSource,
} from "../src/lib/amb-catalog-detector.ts";
import { buildAmbExportLineageEntry } from "../src/lib/amb-export-lineage-core.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const catalogSource = `import type { Product } from "./data";
export const generatedProducts: Product[] = [
  {
    "slug": "maris-belted-romper",
    "name": "Maris Belted Romper",
    "colorNames": ["Blue"],
    "sizes": ["XS", "S", "M", "L", "XL"],
    "stock": 2940,
    "unitCostUsd": 18.13
  }
];`;

const parsedCatalog = parseAmbGeneratedProductsSource(catalogSource);
assert(parsedCatalog.length === 1, "scanner deve ler generated-products.ts");
assert(parsedCatalog[0].slug === "maris-belted-romper", "scanner deve preservar slug AMB");
assert(parsedCatalog[0].color === "Blue", "scanner deve preservar cor comercial");

const lineage = buildAmbExportLineageEntry({
  productId: "manager-product-1",
  sourceProductId: "3256812501283942",
  sourceUrl: "https://www.aliexpress.com/item/3256812501283942.html",
  now: new Date("2026-08-09T12:00:00Z"),
  variants: [
    { sourceSkuId: "sku-blue-xs", attributes: { Color: "Blue", Size: "XS" }, stock: 588, costPrice: { toString: () => "18.13" } },
    { sourceSkuId: "sku-blue-s", attributes: { Color: "Blue", Size: "S" }, stock: 588, costPrice: { toString: () => "18.13" } },
    { sourceSkuId: "sku-blue-m", attributes: { Color: "Blue", Size: "M" }, stock: 588, costPrice: { toString: () => "18.13" } },
    { sourceSkuId: "sku-blue-l", attributes: { Color: "Blue", Size: "L" }, stock: 588, costPrice: { toString: () => "18.13" } },
    { sourceSkuId: "sku-blue-xl", attributes: { Color: "Blue", Size: "XL" }, stock: 588, costPrice: { toString: () => "18.13" } },
  ],
});
assert(lineage.colors.length === 1, "linhagem deve agrupar variantes por cor");
assert(lineage.colors[0].stock === 2940, "linhagem deve somar estoque da cor");
assert(lineage.colors[0].sourceSkuIds.length === 5, "linhagem deve preservar SKUs de tamanho");

const inferred = inferAmbBinding(parsedCatalog[0], [
  { sourceProductId: "3256812501283942", color: "Blue", size: "XS", stock: 588, cost: 18.13 },
  { sourceProductId: "3256812501283942", color: "Blue", size: "S", stock: 588, cost: 18.13 },
  { sourceProductId: "3256812501283942", color: "Blue", size: "M", stock: 588, cost: 18.13 },
  { sourceProductId: "3256812501283942", color: "Blue", size: "L", stock: 588, cost: 18.13 },
  { sourceProductId: "3256812501283942", color: "Blue", size: "XL", stock: 588, cost: 18.13 },
  { sourceProductId: "other", color: "Blue", size: "S", stock: 1, cost: 99 },
]);
assert(inferred.safe, "assinatura exata deve permitir vínculo automático");
assert(inferred.binding?.sourceProductId === "3256812501283942", "vínculo deve escolher o produto-fonte correto");

const bridge = parseAmbBridgeConfig({
  ambBridge: {
    version: 1,
    mode: "backend-only",
    products: {
      "maris-belted-romper": { sourceProductId: "3256812501283942", color: "Blue" },
    },
  },
});
assert(bridge?.products["maris-belted-romper"].color === "Blue", "bridge deve ler vínculo slug → cor");

const freight = chooseAliExpressFreight([
  { serviceName: "Cainiao Super Economy", amount: 2.2, estimatedDeliveryTime: "20-30" },
  { serviceName: "AliExpress Standard Shipping", amount: 4.5, estimatedDeliveryTime: "8-15" },
]);
assert(freight?.serviceName === "AliExpress Standard Shipping", "frete padrão AliExpress deve ter prioridade operacional");

const exportRoute = readFileSync("src/app/api/exports/product/route.ts", "utf8");
const maintenanceRoute = readFileSync("src/app/api/cron/maintenance/route.ts", "utf8");
const webhookRoute = readFileSync("src/app/api/stores/[id]/amb/orders/webhook/route.ts", "utf8");
const tokenRoute = readFileSync("src/app/api/stores/[id]/webhook-token/route.ts", "utf8");
const managerAuth = readFileSync("src/lib/manager-admin-auth.ts", "utf8");
const skuSync = readFileSync("src/lib/aliexpress-sku-sync.ts", "utf8");
const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: Array<{ path?: string }> };

assert(exportRoute.includes("recordAmbProductExport"), "download do ZIP AMB deve registrar linhagem no Manager");
assert(maintenanceRoute.includes("scanAmbCatalog"), "maintenance deve varrer catálogo AMB");
assert(webhookRoute.includes("ingestAmbPaidStripeSession"), "webhook AMB deve ingerir Stripe Session paga");
assert(webhookRoute.includes("scanAmbCatalog"), "venda deve disparar scan imediato antes do fulfillment");
assert(tokenRoute.includes("/amb/orders/webhook"), "token da AMB deve entregar endpoint compatível");
assert(managerAuth.includes("amb\\/orders\\/webhook"), "proxy deve liberar webhook AMB para autenticação por token da loja");
assert(skuSync.includes("exactBySourceSku") && skuSync.includes("exactReady"), "AliExpress deve priorizar SKU exato antes de fuzzy mapping");
assert(vercelConfig.crons?.some((cron) => cron.path === "/api/cron/maintenance"), "Vercel deve agendar maintenance do Manager");

console.log("AMB BACKEND BRIDGE: PASS");
