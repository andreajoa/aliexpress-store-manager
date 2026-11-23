import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";

import { aliExpressProductIdAliases } from "@/lib/aliexpress-catalog-id";
import { verifySingleProductUsShipping } from "@/lib/aliexpress-us-finder";
import { summarizeProductWarehouses } from "@/lib/aliexpress-warehouse";
import { parseAmbBridgeConfig } from "@/lib/amb-bridge-contract";
import { prisma } from "@/lib/prisma";
import { mergeDeliveryPayloadFields } from "@/lib/supplier-delivery";

export const runtime = "nodejs";
export const maxDuration = 60;

const AUDIT_FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type StoredAuditMeta = {
  checkedAt?: string;
  checked?: boolean;
  hasUsWarehouse?: boolean;
  hasUsInStock?: boolean;
  usTotalStock?: number;
  dispatchCountry?: string;
  countries?: string[];
  deliveryMinDays?: number | null;
  deliveryMaxDays?: number | null;
  ambDisplayMinDays?: number | null;
  ambDisplayMaxDays?: number | null;
  error?: string | null;
};

function readStoredAudit(rawPayload: unknown): StoredAuditMeta | null {
  const raw = asRecord(rawPayload);
  const audit = asRecord(raw.usWarehouseAudit);
  if (typeof audit.checkedAt !== "string" || !audit.checkedAt) return null;
  return audit as StoredAuditMeta;
}

function isAuditFresh(audit: StoredAuditMeta | null, nowMs: number): boolean {
  if (!audit?.checkedAt) return false;
  const ts = Date.parse(audit.checkedAt);
  return Number.isFinite(ts) && nowMs - ts < AUDIT_FRESH_WINDOW_MS;
}

async function loadAmbLinkedProducts() {
  const store = await prisma.store.findUnique({
    where: { id: "amb-boutique-store" },
    select: { connectorCapabilities: true },
  });
  const bridge = parseAmbBridgeConfig(store?.connectorCapabilities);
  const rawSourceIds = bridge
    ? [...new Set(Object.values(bridge.products).map((b) => b.sourceProductId))]
    : [];

  const aliasSet = new Set<string>();
  const slugsByAlias = new Map<string, string[]>();
  if (bridge) {
    for (const [slug, binding] of Object.entries(bridge.products)) {
      for (const alias of aliExpressProductIdAliases(binding.sourceProductId)) {
        aliasSet.add(alias);
        const list = slugsByAlias.get(alias) || [];
        if (!list.includes(slug)) list.push(slug);
        slugsByAlias.set(alias, list);
      }
    }
  }

  const allLookupIds = [...new Set([...rawSourceIds, ...aliasSet])];
  const products = allLookupIds.length > 0
    ? await prisma.product.findMany({
      where: { sourceProvider: "ALIEXPRESS", sourceProductId: { in: allLookupIds } },
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
          take: 1,
          select: { id: true, rawPayload: true },
        },
      },
      orderBy: { id: "asc" },
    })
    : [];

  return { products, slugsByAlias };
}

export async function GET() {
  const nowMs = Date.now();
  const [totalProducts, linked] = await Promise.all([
    prisma.product.count({ where: { sourceProvider: "ALIEXPRESS" } }),
    loadAmbLinkedProducts(),
  ]);

  let auditedCount = 0;
  let updatedWithDaysCount = 0;
  const usWarehouseProducts: Array<{
    productId: string;
    sourceProductId: string;
    title: string;
    ambSlugs: string[];
    usTotalStock: number;
    dispatchCountry: string;
    deliveryMinDays: number | null;
    deliveryMaxDays: number | null;
    ambDisplayMinDays: number | null;
    ambDisplayMaxDays: number | null;
    checkedAt: string | null;
  }> = [];

  for (const product of linked.products) {
    const supplier = product.supplierProducts[0];
    const audit = readStoredAudit(supplier?.rawPayload);
    const fresh = isAuditFresh(audit, nowMs);
    if (fresh) auditedCount++;
    if (audit?.deliveryMinDays != null) updatedWithDaysCount++;

    const variantSummary = summarizeProductWarehouses(product.variants);
    const hasUs = Boolean(audit?.hasUsInStock || audit?.hasUsWarehouse || variantSummary.hasUsWarehouse);
    if (hasUs) {
      usWarehouseProducts.push({
        productId: product.id,
        sourceProductId: product.sourceProductId,
        title: product.optimizedTitle || product.sourceTitle,
        ambSlugs: linked.slugsByAlias.get(product.sourceProductId) || [],
        usTotalStock: audit?.usTotalStock ?? variantSummary.usTotalStock,
        dispatchCountry: audit?.dispatchCountry || "US",
        deliveryMinDays: audit?.deliveryMinDays ?? null,
        deliveryMaxDays: audit?.deliveryMaxDays ?? null,
        ambDisplayMinDays: audit?.ambDisplayMinDays ?? null,
        ambDisplayMaxDays: audit?.ambDisplayMaxDays ?? null,
        checkedAt: audit?.checkedAt ?? null,
      });
    }
  }

  const totalLinkedProducts = linked.products.length;
  return NextResponse.json({
    ok: true,
    totalProducts,
    totalLinkedProducts,
    auditedCount,
    pendingCount: Math.max(0, totalLinkedProducts - auditedCount),
    updatedWithDaysCount,
    usWarehouseCount: usWarehouseProducts.length,
    usWarehouseProducts,
  });
}

/**
 * Resumable, timeout-safe audit of AMB-linked products against AliExpress Open Platform.
 * Always processes small batches of pending items (default limit=5) and records checkedAt
 * on every inspected supplier so re-clicking resumes seamlessly from where it stopped.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      limit?: number;
      reset?: boolean;
    };
    const limit = Math.min(8, Math.max(1, Math.trunc(Number(body.limit || 5)) || 5));
    const reset = body.reset === true;
    const nowMs = Date.now();

    const linked = await loadAmbLinkedProducts();
    const allLinked = linked.products;

    if (reset) {
      for (const product of allLinked) {
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
        totalLinkedProducts: allLinked.length,
        auditedCount: 0,
        pendingCount: allLinked.length,
        done: allLinked.length === 0,
        checked: 0,
        usFound: 0,
        updatedDeliveryCount: 0,
        results: [],
      });
    }

    const pending = allLinked.filter((product) => {
      const supplier = product.supplierProducts[0];
      if (!supplier) return false;
      return !isAuditFresh(readStoredAudit(supplier.rawPayload), nowMs);
    });

    const batch = pending.slice(0, limit);
    const alreadyAudited = allLinked.length - pending.length;

    if (batch.length === 0) {
      return NextResponse.json({
        ok: true,
        done: true,
        totalLinkedProducts: allLinked.length,
        auditedCount: allLinked.length,
        pendingCount: 0,
        checked: 0,
        usFound: 0,
        updatedDeliveryCount: 0,
        results: [],
      });
    }

    const checkedResults = await Promise.all(
      batch.map(async (product) => {
        const check = await verifySingleProductUsShipping(product.sourceProductId);
        let updated = false;
        const supplier = product.supplierProducts[0];

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

          // Always record usWarehouseAudit.checkedAt so this product does not stall resume
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

        return {
          productId: product.id,
          sourceProductId: product.sourceProductId,
          title: product.optimizedTitle || product.sourceTitle,
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
        };
      }),
    );

    const newAuditedCount = Math.min(allLinked.length, alreadyAudited + checkedResults.length);
    const remainingPending = Math.max(0, pending.length - batch.length);

    return NextResponse.json({
      ok: true,
      done: remainingPending === 0,
      totalLinkedProducts: allLinked.length,
      auditedCount: newAuditedCount,
      pendingCount: remainingPending,
      checked: checkedResults.length,
      usFound: checkedResults.filter((r) => r.hasUsInStock).length,
      updatedDeliveryCount: checkedResults.filter((r) => r.updated).length,
      results: checkedResults,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Falha na auditoria de armazém EUA." },
      { status: 500 },
    );
  }
}
