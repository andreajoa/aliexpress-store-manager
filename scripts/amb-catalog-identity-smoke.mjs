import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Run the real scan with in-memory persistence. No credentials or network.
const modules = new Map();
let stored;
let written;
let catalog;
const variants = ["S", "M"].map(size => ({ attributes: { Color: "Black", Size: size }, sourceSkuId: `sku-${size}`, available: true, stock: 10, costPrice: { toString: () => "12" } }));
const supplier = { sourceProductId: "supplier-a", variants };
const prisma = {
  store: {
    findUnique: async () => stored,
    update: async ({ data }) => { written = data.connectorCapabilities; },
  },
  product: { findMany: async () => [supplier] },
};
function load(relative) {
  if (modules.has(relative)) return modules.get(relative);
  const filename = new URL(`../src/lib/${relative.replace(/\.ts$/, "")}.ts`, import.meta.url);
  const exports = {};
  modules.set(relative, exports);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = (name) => {
    if (name === "./prisma") return { prisma };
    if (name === "./amb-catalog-github.ts") return { loadAmbGitHubCatalog: async () => ({ products: catalog, catalogBlobSha: "fixture" }) };
    if (name === "./amb-export-lineage") return { ambExportLineageFromCapabilities: () => [] };
    if (name.startsWith("./")) return load(name.slice(2));
    throw new Error(`Unexpected dependency ${name}`);
  };
  vm.runInNewContext(code, { exports, require, console, process: { env: {} } }, { filename: filename.pathname });
  return exports;
}
const { scanAmbCatalog } = load("amb-catalog-scan");
function reset() {
  written = null;
  stored = { id: "fixture-store", status: "ACTIVE", githubOwner: "fixture", githubRepo: "fixture", connectorCapabilities: {} };
  catalog = [{ slug: "unrelated-black-dress", name: "Unrelated Dress", color: "Black", sizes: ["S", "M"], stock: 20, unitCostUsd: 12, sourceProductId: null, sourceColor: null }];
}
reset();
let result = await scanAmbCatalog({ force: true });
assert.equal(result.autoMapped, 0, "Identical inventory signature must never create product identity");
assert.equal(Object.keys(written.ambBridge.products).length, 0);
assert.equal(result.pending, 1);
assert.equal(written.ambCatalogScan.pending[0].reason, "PRODUCT_IDENTITY_REQUIRES_REVIEW");
reset();
catalog[0].sourceProductId = "supplier-a";
catalog[0].sourceColor = "Black";
stored.connectorCapabilities = { ambBridge: { version: 1, products: { [catalog[0].slug]: { sourceProductId: "supplier-a", color: "Black", sourceSkuIdsBySize: { S: "sku-S", M: "sku-M" } } } } };
result = await scanAmbCatalog({ force: true });
assert.equal(result.autoMapped, 1);
assert.equal(result.pending, 0);
assert.equal(written.ambBridge.products[catalog[0].slug].sourceSkuIdsBySize.M, "sku-M", "A scan must preserve reviewed exact SKUs");
supplier.variants.push({ ...variants[0], sourceSkuId: "sku-S-alternate" });
result = await scanAmbCatalog({ force: true });
assert.equal(result.pending, 0, "Reviewed exact SKU disambiguates duplicate attributes");
stored.connectorCapabilities = {};
result = await scanAmbCatalog({ force: true });
assert.equal(result.pending, 1, "Explicit product identity alone cannot disambiguate duplicate SKUs");
assert.equal(result.autoMapped, 0);
assert.equal(written.ambCatalogScan.pending[0].missingSizes[0], "S");
console.log("AMB CATALOG IDENTITY: PASS (no inventory-based auto-binding; explicit SKU preservation; ambiguity blocks readiness; zero external actions)");
