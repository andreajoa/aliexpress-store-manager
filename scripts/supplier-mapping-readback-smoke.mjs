import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = "src/app/api/products/[id]/suppliers/[supplierId]/mapping/route.ts";
const variants = [{
  id: "canonical", sourceSkuId: "1200001", attributes: { Color: "Black", Size: "7" },
  available: true, stock: 4,
}];
const supplier = {
  id: "supplier",
  variants: [{ ...variants[0], id: "supplier-variant", name: "Black", sourcePrice: 10 }],
};
const product = { id: "product", sourceProductId: "1005000000001", variants };
let existing = 1;
let owned = true;
let writes = [];
const prisma = {
  supplierProduct: {
    findFirst: async ({ where }) => {
      assert.deepEqual(where, { id: "supplier", productId: "product" });
      return owned ? supplier : null;
    },
  },
  product: { findUnique: async ({ where }) => {
    assert.deepEqual(where, { id: "product" });
    return product;
  } },
  $transaction: async (callback, options) => {
    writes.push(["transaction", options?.isolationLevel]);
    return callback({
      supplierVariantMapping: {
        count: async () => existing,
        deleteMany: async () => { writes.push(["delete"]); },
        createMany: async ({ data }) => { writes.push(["create", data]); },
      },
    });
  },
};
const imports = {
  "@/lib/prisma": { prisma },
  "@/lib/supplier-catalog": { canonicalVariantsForMapping: (rows) => rows },
  "@/lib/supplier-variant-mapper": { validateManualVariantMapping: () => ({ valid: true }) },
};
const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function("require", "exports", compiled)((name) => imports[name] ?? require(name), mod.exports);
const context = { params: Promise.resolve({ id: "product", supplierId: "supplier" }) };
const url = "https://manager.example/api/products/product/suppliers/supplier/mapping";

let response = await mod.exports.GET(new Request(url), context);
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "private, no-store");
assert.deepEqual(await response.json(), { ok: true, product });
assert.deepEqual(writes, []);
owned = false;
response = await mod.exports.GET(new Request(url), context);
assert.equal(response.status, 404);
owned = true;

const payload = { mappings: [{ canonicalVariantId: "canonical", supplierVariantId: "supplier-variant" }] };
const put = (options) => mod.exports.PUT(new Request(url, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...payload, ...options }),
}), context);
assert.equal((await put({ ifUnmapped: true })).status, 409);
assert.deepEqual(writes, [["transaction", "Serializable"]]);
existing = 0;
writes = [];
assert.equal((await put({ ifUnmapped: true })).status, 200);
assert.deepEqual(writes.map((entry) => entry[0]), ["transaction", "create"]);
assert.equal(writes[1][1][0].evidence.supplierSourceSkuId, "1200001");
writes = [];
assert.equal((await put({})).status, 200);
assert.deepEqual(writes.map((entry) => entry[0]), ["transaction", "delete", "create"]);
console.log("PASS: owned canonical SKU read, write-free GET, guarded first mapping and existing replacement path");
