import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadAmbRepositoryCatalog, ambCatalogRepositoryPaths } from "../src/lib/amb-catalog-repository.ts";
import { loadAmbGitHubCatalog } from "../src/lib/amb-catalog-github.ts";
import { inferAmbBinding, parseAmbGeneratedProductsSource, type AmbCatalogProduct } from "../src/lib/amb-catalog-detector.ts";

// Committed non-secret source snapshots make the test independent of a sibling
// checkout. An optional checkout argument verifies the next reviewed release.
const root = process.argv[2] ? resolve(process.argv[2]) : null;
const fixture = new URL("./fixtures/amb-catalog/", import.meta.url);
const read = async (path: string) => {
  const source = await readFile(root ? resolve(root, path) : new URL(path.replace(/^app\//, ""), fixture), "utf8");
  return { source, blobSha: createHash("sha1").update(source).digest("hex") };
};
const release = JSON.parse(await readFile(root ? resolve(root, "imports/products-20261004-release.json") : new URL("release.json", fixture), "utf8"));
const baseline: AmbCatalogProduct[] = JSON.parse(await readFile(new URL("baseline.json", fixture), "utf8"));
const catalog = await loadAmbRepositoryCatalog(read);
const direct = parseAmbGeneratedProductsSource((await read("app/generated-products.ts")).source);
const expected = [...baseline, ...direct.filter((row) => release.approvedSlugs.includes(row.slug))];
const sorted = (rows: AmbCatalogProduct[]) => [...rows].sort((a, b) => a.slug.localeCompare(b.slug));
assert.equal(baseline.length, release.baseProducts);
assert.equal(catalog.products.length, release.baseProducts + release.approvedSlugs.length);
assert.equal(new Set(catalog.products.map((row) => row.slug)).size, catalog.products.length);
assert.deepEqual(sorted(catalog.products), sorted(expected), "Every actual row, size, colour, stock, cost and source identity must match");
assert.equal(catalog.products.filter((row) => release.approvedSlugs.includes(row.slug)).every((row) => row.sourceProductId && row.sourceColor), true);

// Future rows follow the publication allowlist; catalog size is never capped at
// today's release count. An unapproved addition must remain excluded.
const future = { ...direct.find((row) => release.approvedSlugs.includes(row.slug))!, slug: "future-approved-catalog-fixture" };
const futureSource = JSON.stringify({ ...future, colorNames: [future.color] });
const withFuture = (approved: boolean) => loadAmbRepositoryCatalog(async (path) => {
  const value = await read(path);
  if (path !== "app/generated-products.ts") return value;
  // Append after the established literal rows without shifting their index.
  let source = value.source.replace("\n];", `,\n${futureSource}\n];`);
  if (approved) source = source.replace("export const approvedNewProductSlugs = new Set<string>([", `export const approvedNewProductSlugs = new Set<string>(["${future.slug}",`);
  assert.notEqual(source, value.source);
  return { ...value, source };
});
assert.deepEqual((await withFuture(false)).products, catalog.products);
assert.deepEqual(sorted((await withFuture(true)).products), sorted([...catalog.products, future]));

// A family blob edit must invalidate the scan even if generated-products.ts is unchanged.
const changed = await loadAmbRepositoryCatalog(async (path) => {
  const result = await read(path);
  return path === "app/generated-august-2026-products.ts" ? { ...result, blobSha: "changed-import-blob" } : result;
});
assert.notEqual(catalog.catalogBlobSha, changed.catalogBlobSha);
assert.deepEqual(catalog.products, changed.products);
assert.equal(ambCatalogRepositoryPaths.length, 9);

for (const mutation of [
  "octoberColorProducts.splice(0, 1);",
  "const silentlyRemoved = octoberColorProducts.pop();",
  "export const ignored = (() => { octoberColorProducts.length = 0; })();",
  'import "./unreviewed-side-effects";',
]) {
  await assert.rejects(() => loadAmbRepositoryCatalog(async (path) => {
    const value = await read(path);
    return path === "app/october-color-products.ts" ? { ...value, source: `${value.source}\n${mutation}` } : value;
  }), /Catálogo AMB não suportado/);
}
// Executable values in fields outside the Manager snapshot must also block.
await assert.rejects(() => loadAmbRepositoryCatalog(async (path) => {
  const value = await read(path);
  return path === "app/october-color-products.ts"
    ? { ...value, source: value.source.replace('"images": [', '"ignoredField": doNotExecute(), "images": [') }
    : value;
}), /Catálogo AMB não suportado/);

for (const [path, before, after] of [
  ["app/generated-products.ts", "...august2026Products,", "...untrustedProducts,"],
  ["app/generated-products.ts", '"./generated-august-2026-products"', '"../../outside"'],
  ["app/generated-august-2026-products.ts", 'stock: 3996', 'stock: doNotExecute()'],
  ["app/data.ts", "...octoberColorProducts,", "...unknownProducts,"],
  ["app/data.ts", "new Set(catalogueProducts.map((product) => product.slug))", "new Set([])"],
  ["app/generated-august-2026-products.ts", "august2026Products.map((product) => product.slug)", 'august2026Products.map((product) => "wrong-slug")'],
  ["app/shoe-products.ts", 'fixed("solene', 'unsafe("solene'],
  ["app/shoe-products.ts", 'slug, name, price, badge:', 'slug, name: "Changed", price, badge:'],
] as const) {
  await assert.rejects(() => loadAmbRepositoryCatalog(async (candidate) => {
    const value = await read(candidate);
    if (candidate !== path) return value;
    assert.ok(value.source.includes(before));
    return { ...value, source: value.source.replace(before, after) };
  }), /Catálogo AMB não suportado/);
}
// Mock GitHub transport: resolve a moving branch once, then read every file
// against the same immutable commit. No production token or network is used.
const commitSha = "a".repeat(40);
let reads = 0;
const fromGitHub = await loadAmbGitHubCatalog({ owner: "fixture", repo: "catalog", branch: "main", fetcher: async (url, options) => {
  assert.equal(options?.cache, "no-store");
  const request = new URL(String(url));
  assert.equal(request.hostname, "api.github.com");
  if (request.pathname.endsWith("/commits/main")) return Response.json({ sha: commitSha });
  assert.equal(request.searchParams.get("ref"), commitSha);
  const path = request.pathname.split("/contents/")[1];
  assert.ok(ambCatalogRepositoryPaths.includes(path as (typeof ambCatalogRepositoryPaths)[number]));
  reads++;
  const content = await read(path);
  return Response.json({ content: Buffer.from(content.source).toString("base64"), encoding: "base64", sha: content.blobSha });
} });
assert.equal(reads, ambCatalogRepositoryPaths.length);
assert.deepEqual(fromGitHub.products, catalog.products);
await assert.rejects(() => loadAmbGitHubCatalog({ owner: "fixture", repo: "catalog", branch: "main", fetcher: async () => Response.json({ sha: "not-a-commit" }) }), /commit válido/);
// Imported records with identical source signatures keep the existing ambiguity guard.
const example = catalog.products.find((row) => row.slug === "alessa-milky-halter-midi-dress")!;
assert.equal(example.sourceProductId, null);
const suppliers = ["supplier-a", "supplier-b"].flatMap((sourceProductId) => example.sizes.map((size) => ({
  sourceProductId, color: example.color, size, stock: example.stock! / example.sizes.length, cost: null,
})));
assert.equal(inferAmbBinding(example, suppliers).safe, false);
console.log(JSON.stringify({ products: catalog.products.length, baseline: baseline.length, approved: release.approvedSlugs.length, exactRows: "passed", futureApprovedAddition: "passed", draftExcluded: "passed", importedDigest: "passed", unsupportedSyntax: "rejected", ambiguity: "preserved", externalWrites: 0 }));
