import { Prisma } from "@prisma/client";

import {
  inferAmbBinding,
  normalizeAmbColor,
  normalizeAmbValue,
  parseAmbGeneratedProductsSource,
  type AmbCatalogProduct,
  type AmbSupplierVariantSnapshot,
} from "./amb-catalog-detector";
import { parseAmbBridgeConfig } from "./amb-backend-bridge";
import { ambExportLineageFromCapabilities } from "./amb-export-lineage";
import { prisma } from "./prisma";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function base64Decode(value: string) {
  return Buffer.from(value.replace(/\n/g, ""), "base64").toString("utf8");
}

async function fetchGitHubFile(input: {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}) {
  const token = process.env.GITHUB_READ_TOKEN?.trim() || process.env.GITHUB_PUBLISH_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_READ_TOKEN ou GITHUB_PUBLISH_TOKEN é necessário para ler o catálogo privado da AMB.");
  const url = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${input.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(input.branch)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "aliexpress-store-manager",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = text(record(body).message);
    throw new Error(message || `GitHub HTTP ${response.status}.`);
  }
  const payload = record(body);
  const content = text(payload.content);
  if (!content || text(payload.encoding) !== "base64") {
    throw new Error(`GitHub não retornou ${input.path} em base64.`);
  }
  return { source: base64Decode(content), blobSha: text(payload.sha) };
}

function catalogSnapshot(products: AmbCatalogProduct[]) {
  return Object.fromEntries(products.map((product) => [product.slug, {
    name: product.name,
    color: product.color,
    sizes: product.sizes,
    stock: product.stock,
    unitCostUsd: product.unitCostUsd,
  }]));
}

function supplierRowsFromProducts(products: Array<{
  sourceProductId: string;
  variants: Array<{
    attributes: unknown;
    stock: number;
    costPrice: { toString(): string } | null;
  }>;
}>): AmbSupplierVariantSnapshot[] {
  return products.flatMap((product) => product.variants.flatMap((variant) => {
    const attributes = record(variant.attributes);
    const color = text(attributes.Color);
    const size = text(attributes.Size);
    if (!color || !size) return [];
    const rawCost = variant.costPrice ? Number(variant.costPrice.toString()) : null;
    return [{
      sourceProductId: product.sourceProductId,
      color,
      size,
      stock: Math.max(0, variant.stock),
      cost: rawCost != null && Number.isFinite(rawCost) ? rawCost : null,
    }];
  }));
}

function sameSizes(left: string[], right: string[]) {
  const a = [...new Set(left.map(normalizeAmbValue).filter(Boolean))].sort();
  const b = [...new Set(right.map(normalizeAmbValue).filter(Boolean))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function validateBinding(input: {
  product: AmbCatalogProduct;
  binding: { sourceProductId: string; color: string };
  supplierRows: AmbSupplierVariantSnapshot[];
}) {
  const rows = input.supplierRows.filter((row) =>
    row.sourceProductId === input.binding.sourceProductId &&
    normalizeAmbColor(row.color) === normalizeAmbColor(input.binding.color),
  );
  const supplierSizes = rows.map((row) => row.size);
  const missingSizes = input.product.sizes.filter((size) =>
    !supplierSizes.some((candidate) => normalizeAmbValue(candidate) === normalizeAmbValue(size)),
  );
  return { valid: rows.length > 0 && missingSizes.length === 0, missingSizes };
}

function lineageCandidates(input: {
  product: AmbCatalogProduct;
  capabilities: unknown;
}) {
  return ambExportLineageFromCapabilities(input.capabilities)
    .flatMap((entry) => entry.colors.map((group) => {
      const colorMatch = normalizeAmbColor(group.color) === normalizeAmbColor(input.product.color);
      const sizesMatch = sameSizes(group.sizes, input.product.sizes);
      const stockMatch = input.product.stock != null && group.stock === Math.trunc(input.product.stock);
      const costMatch = input.product.unitCostUsd != null && group.costs.some((cost) => Math.abs(cost - input.product.unitCostUsd!) <= 0.03);
      const score = (colorMatch ? 8 : 0) + (sizesMatch ? 6 : 0) + (stockMatch ? 4 : 0) + (costMatch ? 4 : 0);
      return {
        sourceProductId: entry.sourceProductId,
        color: group.color,
        exportedAt: entry.exportedAt,
        score,
        evidence: { colorMatch, sizesMatch, stockMatch, costMatch },
      };
    }))
    .filter((candidate) => candidate.score >= 14)
    .sort((a, b) => b.score - a.score || b.exportedAt.localeCompare(a.exportedAt));
}

function inferFromLineage(product: AmbCatalogProduct, capabilities: unknown) {
  const candidates = lineageCandidates({ product, capabilities });
  const best = candidates[0] || null;
  const runnerUp = candidates[1] || null;
  const unique = Boolean(best && (!runnerUp || best.sourceProductId !== runnerUp.sourceProductId || normalizeAmbColor(best.color) !== normalizeAmbColor(runnerUp.color)));
  const safe = Boolean(best && unique && best.evidence.colorMatch && best.evidence.sizesMatch && best.score >= 14);
  return {
    safe,
    binding: safe && best ? { sourceProductId: best.sourceProductId, color: best.color } : null,
    candidates: candidates.slice(0, 5),
  };
}

export async function scanAmbCatalog(input: { storeId?: string; force?: boolean } = {}) {
  const storeId = input.storeId || "amb-boutique-store";
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new Error("Loja AMB não encontrada no Store Manager.");
  if (store.status !== "ACTIVE") throw new Error("Loja AMB não está ativa no Store Manager.");
  if (!store.githubOwner || !store.githubRepo) throw new Error("Loja AMB não possui GitHub configurado.");

  const capabilities = record(store.connectorCapabilities);
  const previousScan = record(capabilities.ambCatalogScan);
  const github = await fetchGitHubFile({
    owner: store.githubOwner,
    repo: store.githubRepo,
    branch: store.githubBranch || "main",
    path: "app/generated-products.ts",
  });

  if (!input.force && github.blobSha && github.blobSha === text(previousScan.catalogBlobSha)) {
    return {
      ok: true,
      changed: false,
      storeId,
      catalogBlobSha: github.blobSha,
      totalProducts: Number(previousScan.totalProducts) || 0,
      newProducts: 0,
      autoMapped: 0,
      pending: Array.isArray(previousScan.pending) ? previousScan.pending.length : 0,
      changedVariants: 0,
      removedProducts: Array.isArray(previousScan.removedProducts) ? previousScan.removedProducts.length : 0,
    };
  }

  const catalog = parseAmbGeneratedProductsSource(github.source);
  const bridge = parseAmbBridgeConfig(capabilities) || { version: 1, mode: "backend-only", products: {} };
  const managerProducts = await prisma.product.findMany({
    where: { sourceProvider: "ALIEXPRESS" },
    select: {
      sourceProductId: true,
      variants: { select: { attributes: true, stock: true, costPrice: true } },
    },
  });
  const supplierRows = supplierRowsFromProducts(managerProducts);
  const oldSnapshot = record(previousScan.catalog);
  const currentSlugs = new Set(catalog.map((product) => product.slug));
  const newProducts = catalog.filter((product) => !Object.prototype.hasOwnProperty.call(oldSnapshot, product.slug));
  const nextBindings = { ...bridge.products };
  const pending: Array<Record<string, unknown>> = [];
  let autoMapped = 0;
  let changedVariants = 0;

  for (const product of catalog) {
    const existing = nextBindings[product.slug];
    if (existing) {
      const validation = validateBinding({ product, binding: existing, supplierRows });
      if (!validation.valid) {
        changedVariants += 1;
        pending.push({
          slug: product.slug,
          reason: "EXISTING_BINDING_VARIANTS_CHANGED",
          binding: existing,
          missingSizes: validation.missingSizes,
        });
      }
      continue;
    }

    const fromLineage = inferFromLineage(product, capabilities);
    if (fromLineage.safe && fromLineage.binding) {
      nextBindings[product.slug] = fromLineage.binding;
      autoMapped += 1;
      continue;
    }

    const fallback = inferAmbBinding(product, supplierRows);
    if (fallback.safe && fallback.binding) {
      nextBindings[product.slug] = fallback.binding;
      autoMapped += 1;
      continue;
    }

    pending.push({
      slug: product.slug,
      name: product.name,
      color: product.color,
      sizes: product.sizes,
      stock: product.stock,
      unitCostUsd: product.unitCostUsd,
      reason: "NEW_PRODUCT_BINDING_AMBIGUOUS",
      lineageCandidates: fromLineage.candidates,
      fallbackCandidates: fallback.candidates,
    });
  }

  const removedProducts = Object.keys(nextBindings).filter((slug) => !currentSlugs.has(slug));
  const now = new Date().toISOString();
  const nextCapabilities = {
    ...capabilities,
    ambBridge: { version: 1, mode: "backend-only", products: nextBindings },
    ambCatalogScan: {
      version: 1,
      lastScannedAt: now,
      catalogBlobSha: github.blobSha,
      totalProducts: catalog.length,
      newProducts: newProducts.map((product) => product.slug),
      autoMapped,
      pending,
      removedProducts,
      changedVariants,
      catalog: catalogSnapshot(catalog),
    },
  };

  await prisma.store.update({
    where: { id: storeId },
    data: { connectorCapabilities: nextCapabilities as Prisma.InputJsonValue },
  });

  return {
    ok: true,
    changed: true,
    storeId,
    catalogBlobSha: github.blobSha,
    totalProducts: catalog.length,
    newProducts: newProducts.length,
    autoMapped,
    pending: pending.length,
    changedVariants,
    removedProducts: removedProducts.length,
    pendingItems: pending,
  };
}
