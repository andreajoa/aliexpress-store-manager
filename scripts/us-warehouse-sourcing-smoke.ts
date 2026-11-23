import assert from "node:assert/strict";

import {
  isUsWarehouseVariant,
  parseShipsFromCountryCode,
  prioritizedSendGoodsCountries,
  resolveSendGoodsCountryForSku,
  skuShipsFromCountryCode,
  summarizeProductWarehouses,
} from "../src/lib/aliexpress-warehouse.ts";
import { resolveAmbBoundVariant } from "../src/lib/amb-bound-variant.ts";

// 1. Parse Ships From labels cleanly
assert.equal(parseShipsFromCountryCode("United States"), "US");
assert.equal(parseShipsFromCountryCode("200007763:201336106:United States"), "US");
assert.equal(parseShipsFromCountryCode("China Mainland"), "CN");
assert.equal(parseShipsFromCountryCode("CN"), "CN");
assert.equal(parseShipsFromCountryCode("United Kingdom"), "UK");
assert.equal(parseShipsFromCountryCode(""), null);

// 2. SKU attribute & variant_ids resolution
assert.equal(skuShipsFromCountryCode({ Color: "Light blue", Size: "M", "Ships From": "United States" }), "US");
assert.equal(isUsWarehouseVariant({ "Ships From": "United States" }), true);
assert.equal(isUsWarehouseVariant({ "Ships From": "China Mainland" }), false);
assert.equal(
  skuShipsFromCountryCode(null, "Color:Ivory,Size:S,Ships From:United States"),
  "US",
);

// 3. resolveSendGoodsCountryForSku resolves via variantGroups option IDs too
const resolvedFromGroups = resolveSendGoodsCountryForSku({
  skuVariantIds: "color-1,size-m,ship-us",
  variantGroups: [
    {
      attribute_name: "Ships From",
      attribute_id: "200007763",
      options: [
        { value_id: "ship-cn", name: "China" },
        { value_id: "ship-us", name: "United States" },
      ],
    },
  ],
  defaultCountry: "CN",
});
assert.equal(resolvedFromGroups, "US");

// 4. prioritize US origin when product ships from US
const orderedDefault = prioritizedSendGoodsCountries({
  requested: undefined,
  destinationCountry: "US",
  shipsFromValues: ["200007763:201336100:China", "200007763:201336106:United States"],
});
assert.deepEqual(orderedDefault, ["US", "CN"]);

const orderedExplicitCnWithUsFallback = prioritizedSendGoodsCountries({
  requested: "CN",
  destinationCountry: "US",
  shipsFromValues: ["200007763:201336106:United States"],
});
assert.deepEqual(orderedExplicitCnWithUsFallback, ["CN", "US"]);

// 5. Summarize warehouse stock across mixed CN + US SKUs
const summary = summarizeProductWarehouses([
  { attributes: { Color: "Blue", Size: "S", "Ships From": "China Mainland" }, stock: 500, available: true },
  { attributes: { Color: "Blue", Size: "S", "Ships From": "United States" }, stock: 120, available: true },
  { attributes: { Color: "Blue", Size: "M", "Ships From": "United States" }, stock: 0, available: false },
]);
assert.equal(summary.hasUsWarehouse, true);
assert.equal(summary.hasUsInStock, true);
assert.equal(summary.usInStockSkuCount, 1);
assert.equal(summary.usTotalStock, 120);
assert.equal(summary.primaryDispatchCountry, "US");

// 6. resolveAmbBoundVariant prefers in-stock US warehouse SKU when CN + US coexist!
const binding = { sourceProductId: "3256805140797478", color: "Light blue" };
const cnSku = {
  sourceSkuId: "sku-cn-m",
  attributes: { Color: "Light blue", Size: "M", "Ships From": "China Mainland" },
  stock: 500,
  available: true,
};
const usSku = {
  sourceSkuId: "sku-us-m",
  attributes: { Color: "Light blue", Size: "M", "Ships From": "United States" },
  stock: 42,
  available: true,
};
const chosen = resolveAmbBoundVariant(binding, "M", [cnSku, usSku], 1);
assert.equal(chosen.sourceSkuId, "sku-us-m", "Deve priorizar automaticamente o SKU do armazém dos EUA");

// Falls back cleanly to CN when US warehouse SKU is out of stock
const usOos = { ...usSku, stock: 0, available: false };
const fallbackChosen = resolveAmbBoundVariant(binding, "M", [cnSku, usOos], 1);
assert.equal(fallbackChosen.sourceSkuId, "sku-cn-m", "Sem estoque nos EUA, deve cair com segurança no SKU CN em estoque");

// Still rejects genuinely ambiguous duplicates with no warehouse distinction
const dupA = { sourceSkuId: "sku-1", attributes: { Color: "Light blue", Size: "M" }, stock: 10, available: true };
const dupB = { sourceSkuId: "sku-2", attributes: { Color: "Light blue", Size: "M" }, stock: 10, available: true };
assert.throws(() => resolveAmbBoundVariant(binding, "M", [dupA, dupB], 1));

console.log("US WAREHOUSE SOURCING & ROUTING: PASS");
