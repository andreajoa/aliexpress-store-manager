import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";

import { aliExpressProductIdAliases } from "@/lib/aliexpress-catalog-id";
import { verifySingleProductUsShipping } from "@/lib/aliexpress-us-finder";
import { extractSupplierWarehouseStatus } from "@/lib/aliexpress-warehouse";
import { parseAmbBridgeConfig } from "@/lib/amb-bridge-contract";
import { prisma } from "@/lib/prisma";
import { mergeDeliveryPayloadFields } from "@/lib/supplier-delivery";

export const runtime = "nodejs";
export const maxDuration = 60;

const AUDIT_FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
const PACE_DELAY_MS = 650;
const RATE_LIMIT_RETRY_DELAY_MS = 2_500;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(message: string | null | undefined): boolean {
  return Boolean(message && /AppApiCallLimit|frequency|rate\s*limit|too many requests/i.test(message));
}

function isAuditFresh(checked: boolean, checkedAt: string | null, nowMs: number): boolean {
  if (!checked || !checkedAt) return false;
  const ts = Date.parse(checkedAt);
  return Number.isFinite(ts) && nowMs - ts < AUDIT_FRESH_WINDOW_MS;
}

async function loadAllAliExpressProductsWithBridge() {
  const [store, products] = await Promise.all([
    prisma.store.findUnique({
      where: { id: "amb-boutique-store" },
      select: { connectorCapabilities: true },
    }),
    prisma.product.findMany({
      where: { sourceProvider: "ALIEXPRESS" },
      select: {
        id: true,
        sourceProductId: true,
        optimizedTitle: true,
        sourceTitle: true,
        variants: {
          select: { attributes: true, stock: true, available: true },
        },
        supplierProducts: {
          where: { provider: "ALIEXPRESS", status: "ACTIVE" },
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            rawPayload: true,
            variants: { select: { attributes: true, stock: true } },
          },
        },
      },
      orderBy: { id: "asc" },
    }),
  ]);

  const bridge = parseAmbBridgeConfig(store?.connectorCapabilities);
  const slugsByAlias = new Map<string, string[]>();
  if (bridge) {
    for (const [slug, binding] of Object.entries(bridge.products)) {
      for (const alias of aliExpressProductIdAliases(binding.sourceProductId)) {
        const list = slugsByAlias.get(alias) || [];
        if (!list.includes(slug)) list.push(slug);
        slugsByAlias.set(alias, list);
      }
    }
  }

  return { products, slugsByAlias };
}

function resolveProductWarehouse(product: Awaited<ReturnType<typeof loadAllAliExpressProductsWithBridge>>["products"][number]) {
  const supplier = product.supplierProducts[0] || null;
  const variants = supplier?.variants.length
    ? supplier.variants.map((v) => ({ attributes: v.attributes, stock: v.stock, available: v.stock > 0 }))
    : product.variants;

  return {
    supplier,
    status: extractSupplierWarehouseStatus({
      supplierRawPayload: supplier?.rawPayload,
      variants,
    }),
  };
}

export async function GET() {
  const nowMs = Date.now();
  const { products, slugsByAlias } = await loadAllAliExpressProductsWithBridge();

  let totalLinkedProducts = 0;
  let auditedCount = 0;
  let failedCount = 0;
  let updatedWithDaysCount = 0;

  const usWarehouseProducts: Array<{
    productId: string;
    sourceProductId: string;
    title: string;
    ambSlugs: string[];
    isLinkedToAmb: boolean;
    hasUsWarehouse: boolean;
    hasUsInStock: boolean;
    usTotalStock: number;
    dispatchCountry: string;
    deliveryMinDays: number | null;
    deliveryMaxDays: number | null;
    ambDisplayMinDays: number | null;
    ambDisplayMaxDays: number | null;
    checkedAt: string | null;
    error: string | null;
  }> = [];

  for (const product of products) {
    const ambSlugs = slugsByAlias.get(product.sourceProductId) || [];
    const isLinkedToAmb = ambSlugs.length > 0;
    if (isLinkedToAmb) totalLinkedProducts++;

    const { status } = resolveProductWarehouse(product);
    if (isAuditFresh(status.checked, status.checkedAt, nowMs)) {
      auditedCount++;
    } else if (status.error) {
      failedCount++;
    }
    if (status.deliveryMinDays != null) updatedWithDaysCount++;

    if (status.hasUsWarehouse || status.hasUsInStock) {
      usWarehouseProducts.push({
        productId: product.id,
        sourceProductId: product.sourceProductId,
        title: product.optimizedTitle || product.sourceTitle,
        ambSlugs,
        isLinkedToAmb,
        hasUsWarehouse: status.hasUsWarehouse,
        hasUsInStock: status.hasUsInStock,
        usTotalStock: status.usTotalStock,
        dispatchCountry: status.dispatchCountry,
        deliveryMinDays: status.deliveryMinDays,
        deliveryMaxDays: status.deliveryMaxDays,
        ambDisplayMinDays: status.ambDisplayMinDays,
        ambDisplayMaxDays: status.ambDisplayMaxDays,
        checkedAt: status.checkedAt,
        error: status.error,
      });
    }
  }

  usWarehouseProducts.sort((a, b) => {
    if (a.hasUsInStock !== b.hasUsInStock) return a.hasUsInStock ? -1 : 1;
    if (b.usTotalStock !== a.usTotalStock) return b.usTotalStock - a.usTotalStock;
    if (a.isLinkedToAmb !== b.isLinkedToAmb) return a.isLinkedToAmb ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  const totalProducts = products.length;
  const usInStockCount = usWarehouseProducts.filter((item) => item.hasUsInStock).length;
  const usOutOfStockCount = usWarehouseProducts.length - usInStockCount;

  return NextResponse.json({
    ok: true,
    totalProducts,
    totalLinkedProducts,
    auditedCount,
    failedCount,
    pendingCount: Math.max(0, totalProducts - auditedCount),
    updatedWithDaysCount,
    usWarehouseCount: usWarehouseProducts.length,
    usInStockCount,
    usOutOfStockCount,
    usWarehouseProducts,
  });
}

/**
 * Resumable, rate-limit-safe sequential audit of ALL AliExpress products in Store Manager.
 * Only marks an item as fresh when `checked === true`; rate-limited items remain pending
 * and are automatically retried with backoff instead of silently skipped.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      limit?: number;
      reset?: boolean;
      retryFailedOnly?: boolean;
    };
    const limit = Math.min(5, Math.max(1, Math.trunc(Number(body.limit || 3)) || 3));
    const reset = body.reset === true;
    const retryFailedOnly = body.retryFailedOnly === true;
    const nowMs = Date.now();

    const { products, slugsByAlias } = await loadAllAliExpressProductsWithBridge();
    const totalLinkedProducts = products.filter(
      (product) => (slugsByAlias.get(product.sourceProductId)?.length || 0) > 0,
    ).length;

    if (reset) {
      for (const product of products) {
        const supplier = product.supplierProducts[0];
        if (!supplier) continue;
        const currentRaw = { ...asRecord(supplier.rawPayload) };
        if ("usWarehouseAudit" in currentRaw) {
          delete currentRaw.usWarehouseAudit;
          await prisma.supplierProduct.update({
            where: { id: supplier.id },
            data: { rawPayload: JSON.parse(JSON.stringify(currentRaw)) as Prisma.InputJsonValue },
          });
        }
      }
      return NextResponse.json({
        ok: true,
        reset: true,
        totalProducts: products.length,
        totalLinkedProducts,
        auditedCount: 0,
        failedCount: 0,
        pendingCount: products.length,
        done: products.length === 0,
        checked: 0,
        usFound: 0,
        updatedDeliveryCount: 0,
        rateLimited: false,
        results: [],
      });
    }

    // Prioritize AMB-linked products first, then imported-only products
    const orderedProducts = [...products].sort((a, b) => {
      const aLinked = (slugsByAlias.get(a.sourceProductId)?.length || 0) > 0 ? 0 : 1;
      const bLinked = (slugsByAlias.get(b.sourceProductId)?.length || 0) > 0 ? 0 : 1;
      if (aLinked !== bLinked) return aLinked - bLinked;
      return a.id.localeCompare(b.id);
    });

    const pending = orderedProducts.filter((product) => {
      const { supplier, status } = resolveProductWarehouse(product);
      if (!supplier) return false;
      if (retryFailedOnly) return !status.checked && Boolean(status.error);
      return !isAuditFresh(status.checked, status.checkedAt, nowMs);
    });

    const batch = pending.slice(0, limit);
    const alreadyAudited = products.length - pending.length;

    if (batch.length === 0) {
      return NextResponse.json({
        ok: true,
        done: true,
        totalProducts: products.length,
        totalLinkedProducts,
        auditedCount: products.length,
        failedCount: 0,
        pendingCount: 0,
        checked: 0,
        usFound: 0,
        updatedDeliveryCount: 0,
        rateLimited: false,
        results: [],
      });
    }

    const checkedResults: Array<{
      productId: string;
      sourceProductId: string;
      title: string;
      ambSlugs: string[];
      isLinkedToAmb: boolean;
      checked: boolean;
      hasUsWarehouse: boolean;
      hasUsInStock: boolean;
      usTotalStock: number;
      dispatchCountry: string;
      deliveryMinDays: number | null;
      deliveryMaxDays: number | null;
      ambDisplayMinDays: number | null;
      ambDisplayMaxDays: number | null;
      updated: boolean;
      error: string | null;
    }> = [];

    let hitRateLimit = false;

    for (let idx = 0; idx < batch.length; idx++) {
      if (idx > 0) await sleep(PACE_DELAY_MS);
      const product = batch[idx];
      const supplier = product.supplierProducts[0];
      const ambSlugs = slugsByAlias.get(product.sourceProductId) || [];

      let check = await verifySingleProductUsShipping(product.sourceProductId, {
        fastDirectFreight: true,
        callTimeoutMs: 7_500,
      });

      if (!check.checked && isRateLimitError(check.error)) {
        await sleep(RATE_LIMIT_RETRY_DELAY_MS);
        check = await verifySingleProductUsShipping(product.sourceProductId, {
          fastDirectFreight: true,
          callTimeoutMs: 7_500,
        });
      }

      if (!check.checked && isRateLimitError(check.error)) {
        hitRateLimit = true;
      }

      let updated = false;
      if (supplier) {
        const currentRaw = asRecord(supplier.rawPayload);
        const nowIso = new Date().toISOString();
        let mergedDelivery: Record<string, unknown> = {};

        if (check.checked && check.deliveryMinDays != null && check.deliveryMaxDays != null) {
          const estimatedDeliveryTime =
            check.deliveryMinDays === check.deliveryMaxDays
              ? `${check.deliveryMinDays}days`
              : `${check.deliveryMinDays}-${check.deliveryMaxDays}days`;
          const syntheticSnapshot = {
            countryCode: "US",
            sendGoodsCountryCode: check.dispatchCountry,
            calculatedAt: nowIso,
            freight: { estimatedDeliveryTime },
          };
          mergedDelivery = mergeDeliveryPayloadFields(currentRaw, syntheticSnapshot);
          updated = true;
        }

        await prisma.supplierProduct.update({
          where: { id: supplier.id },
          data: {
            rawPayload: JSON.parse(JSON.stringify({
              ...currentRaw,
              ...mergedDelivery,
              usWarehouseAudit: {
                checkedAt: nowIso,
                checked: check.checked,
                hasUsWarehouse: check.hasUsWarehouse,
                hasUsInStock: check.hasUsInStock,
                usTotalStock: check.usTotalStock,
                dispatchCountry: check.dispatchCountry,
                countries: check.countries,
                deliveryMinDays: check.deliveryMinDays,
                deliveryMaxDays: check.deliveryMaxDays,
                ambDisplayMinDays: check.ambDisplayMinDays,
                ambDisplayMaxDays: check.ambDisplayMaxDays,
                error: check.error,
              },
            })) as Prisma.InputJsonValue,
          },
        });
      }

      checkedResults.push({
        productId: product.id,
        sourceProductId: product.sourceProductId,
        title: product.optimizedTitle || product.sourceTitle,
        ambSlugs,
        isLinkedToAmb: ambSlugs.length > 0,
        checked: check.checked,
        hasUsWarehouse: check.hasUsWarehouse,
        hasUsInStock: check.hasUsInStock,
        usTotalStock: check.usTotalStock,
        dispatchCountry: check.dispatchCountry,
        deliveryMinDays: check.deliveryMinDays,
        deliveryMaxDays: check.deliveryMaxDays,
        ambDisplayMinDays: check.ambDisplayMinDays,
        ambDisplayMaxDays: check.ambDisplayMaxDays,
        updated,
        error: check.error,
      });

      if (hitRateLimit) break;
    }

    const succeededInBatch = checkedResults.filter((r) => r.checked).length;
    const failedInBatch = checkedResults.length - succeededInBatch;
    const newAuditedCount = Math.min(products.length, alreadyAudited + succeededInBatch);
    const remainingPending = Math.max(0, pending.length - succeededInBatch);

    return NextResponse.json({
      ok: true,
      done: remainingPending === 0,
      totalProducts: products.length,
      totalLinkedProducts,
      auditedCount: newAuditedCount,
      failedCount: failedInBatch,
      pendingCount: remainingPending,
      checked: checkedResults.length,
      succeededCount: succeededInBatch,
      usFound: checkedResults.filter((r) => r.hasUsInStock).length,
      updatedDeliveryCount: checkedResults.filter((r) => r.updated).length,
      rateLimited: hitRateLimit,
      results: checkedResults,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Falha na auditoria de armazém EUA." },
      { status: 500 },
    );
  }
}
