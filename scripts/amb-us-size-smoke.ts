import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ambVariantSize, matchesAmbVariantSelection } from "../src/lib/amb-variant-attributes.ts";
import { buildAmbExportLineageEntry } from "../src/lib/amb-export-lineage-core.ts";

assert.equal(ambVariantSize({ Size: " M ", "US Size": "6" }), "M");
assert.equal(ambVariantSize({ Size: " ", "US Size": "18 W" }), "18 W");
assert.equal(ambVariantSize({ "US Size": "6" }), "6");
assert.equal(ambVariantSize({}), "");
assert.equal(matchesAmbVariantSelection({ Color: "Gold", "US Size": "6" }, "gold", "6"), true);
assert.equal(matchesAmbVariantSelection({ Color: "Gold", "US Size": "6" }, "gold", "8"), false);
assert.equal(matchesAmbVariantSelection({ Color: "Gold", "US Size": "18 W" }, "gold", "18 W"), true);
assert.equal(matchesAmbVariantSelection({ Color: "Red", "US Size": "6" }, "gold", "6"), false);
const variants = [
  { sourceSkuId: "gold-6", attributes: { Color: "Gold", "US Size": "6" }, stock: 12, costPrice: { toString: () => "75.91" } },
  { sourceSkuId: "gold-8", attributes: { Color: "Gold", "US Size": "8" }, stock: 11, costPrice: { toString: () => "75.91" } },
];
const lineage = buildAmbExportLineageEntry({ productId: "fixture", sourceProductId: "fixture-source", sourceUrl: "https://www.aliexpress.com/item/fixture.html", now: new Date("2026-10-05T00:00:00Z"), variants });
assert.deepEqual(lineage.colors[0].sizes, ["6", "8"]);
assert.deepEqual(lineage.colors[0].sourceSkuIds, ["gold-6", "gold-8"]);
assert.equal(lineage.colors[0].stock, 23);
assert.equal(variants.filter((v) => matchesAmbVariantSelection(v.attributes, "Gold", "6"))[0].sourceSkuId, "gold-6");
assert.equal([...variants, variants[0]].filter((v) => matchesAmbVariantSelection(v.attributes, "Gold", "6")).length, 2, "Ambiguous matches must stay ambiguous for the existing fulfillment guard");

// Optional real, non-secret source snapshot: verify every concrete colour/size
// still resolves exactly one original source SKU without making any order.
if (process.argv[2]) {
  const snapshot = JSON.parse(readFileSync(process.argv[2], "utf8"));
  let count = 0;
  for (const product of snapshot.products) {
    for (const variant of product.variants) {
      const matches = product.variants.filter((candidate: typeof variant) => matchesAmbVariantSelection(candidate.attributes, product.sourceColour, variant.size));
      assert.equal(matches.length, 1);
      assert.equal(matches[0].sourceSkuId, variant.sourceSkuId);
      count++;
    }
  }
  assert.equal(count, 226);
  console.log(JSON.stringify({ concreteSourceSkuSelections: count, exactIdentities: "passed", externalOrders: 0 }));
}
console.log("AMB US Size fallback, canonical Size precedence, lineage and ambiguity preservation: PASS");
