import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";

import { verifySingleProductUsShipping } from "@/lib/aliexpress-us-finder";
import { summarizeProductWarehouses } from "@/lib/aliexpress-warehouse";
import { parseAmbBridgeConfig } from "@/lib/amb-bridge-contract";
import { prisma } from "@/lib/prisma";
import { mergeDeliveryPayloadFields } from "@/lib/supplier-delivery";

export const runtime = "nodejs";
export const maxDuration = 60;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET() {
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
      },
      orderBy: { importedAt: "desc" },
    }),
  ]);

  const bridge = parseAmbBridgeConfig(store?.connectorCapabilities);
  const slugsBySourceId = new Map<string, string[]>();
  if (bridge) {
    for (const [slug, binding] of Object.entries(bridge.products)) {
      const list = slugsBySourceId.get(binding.sourceProductId) || [];
      list.push(slug);
      slugsBySourceId.set(binding.sourceProductId, list);
    }
  }

  const usWarehouseProducts: Array<{
    productId: string;
    sourceProductId: string;
    title: string;
    ambSlugs: string[];
    usTotalStock: number;
    countries: string[];
  }> = [];

  for (const product of products) {
    const summary = summarizeProductWarehouses(product.variants);
    if (summary.hasUsWarehouse) {
      usWarehouseProducts.push({
        productId: product.id,
        sourceProductId: product.sourceProductId,
        title: product.optimizedTitle || product.sourceTitle,
        ambSlugs: slugsBySourceId.get(product.sourceProductId) || [],
        usTotalStock: summary.usTotalStock,
        countries: summary.countries,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    totalProducts: products.length,
    ambLinkedProducts: slugsBySourceId.size,
    usWarehouseCount: usWarehouseProducts.length,
    usWarehouseProducts,
  });
}

/**
 * Live-audits a batch of AMB-linked products against AliExpress Open Platform to detect
 * US warehouse availability and update their real US delivery windows in the database.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      offset?: number;
      limit?: number;
    };
    const offset = Math.max(0, Math.trunc(Number(body.offset || 0)) || 0);
    const limit = Math.min(20, Math.max(1, Math.trunc(Number(body.limit || 12)) || 12));

    const store = await prisma.store.findUnique({
      where: { id: "amb-boutique-store" },
      select: { connectorCapabilities: true },
    });
    const bridge = parseAmbBridgeConfig(store?.connectorCapabilities);
    const sourceIds = bridge
      ? [...new Set(Object.values(bridge.products).map((b) => b.sourceProductId))]
      : [];

    const batchIds = sourceIds.slice(offset, offset + limit);
    if (batchIds.length === 0) {
      return NextResponse.json({
        ok: true,
        done: true,
        totalLinkedProducts: sourceIds.length,
        checked: 0,
        usFound: 0,
        updatedDeliveryCount: 0,
        results: [],
      });
    }

    const dbProducts = await prisma.product.findMany({
      where: { sourceProvider: "ALIEXPRESS", sourceProductId: { in: batchIds } },
      select: {
        id: true,
        sourceProductId: true,
        optimizedTitle: true,
        sourceTitle: true,
        supplierProducts: {
          where: { provider: "ALIEXPRESS", status: "ACTIVE" },
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
          take: 1,
          select: { id: true, rawPayload: true },
        },
      },
    });

    const results: Array<{
      productId: string;
      sourceProductId: string;
      title: string;
      hasUsWarehouse: boolean;
      hasUsInStock: boolean;
      dispatchCountry: string;
      deliveryMinDays: number | null;
      deliveryMaxDays: number | null;
      ambDisplayMinDays: number | null;
      ambDisplayMaxDays: number | null;
      updated: boolean;
      error: string | null;
    }> = [];

    const concurrency = 4;
    for (let i = 0; i < dbProducts.length; i += concurrency) {
      const chunk = dbProducts.slice(i, i + concurrency);
      const checkedChunk = await Promise.all(
        chunk.map(async (product) => {
          const check = await verifySingleProductUsShipping(product.sourceProductId);
          let updated = false;
          const supplier = product.supplierProducts[0];

          if (supplier && check.checked && check.deliveryMinDays != null && check.deliveryMaxDays != null) {
            const estimatedDeliveryTime =
              check.deliveryMinDays === check.deliveryMaxDays
                ? `${check.deliveryMinDays}days`
                : `${check.deliveryMinDays}-${check.deliveryMaxDays}days`;
            const currentRaw = asRecord(supplier.rawPayload);
            const syntheticSnapshot = {
              countryCode: "US",
              sendGoodsCountryCode: check.dispatchCountry,
              calculatedAt: new Date().toISOString(),
              freight: { estimatedDeliveryTime },
            };
            const mergedDelivery = mergeDeliveryPayloadFields(currentRaw, syntheticSnapshot);
            await prisma.supplierProduct.update({
              where: { id: supplier.id },
              data: {
                rawPayload: JSON.parse(JSON.stringify({
                  ...currentRaw,
                  ...mergedDelivery,
                  usWarehouseAudit: {
                    hasUsWarehouse: check.hasUsWarehouse,
                    hasUsInStock: check.hasUsInStock,
                    usTotalStock: check.usTotalStock,
                    dispatchCountry: check.dispatchCountry,
                    countries: check.countries,
                    checkedAt: new Date().toISOString(),
                  },
                })) as Prisma.InputJsonValue,
              },
            });
            updated = true;
          }

          return {
            productId: product.id,
            sourceProductId: product.sourceProductId,
            title: product.optimizedTitle || product.sourceTitle,
            hasUsWarehouse: check.hasUsWarehouse,
            hasUsInStock: check.hasUsInStock,
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
      results.push(...checkedChunk);
    }

    return NextResponse.json({
      ok: true,
      done: offset + limit >= sourceIds.length,
      nextOffset: offset + limit < sourceIds.length ? offset + limit : null,
      totalLinkedProducts: sourceIds.length,
      checked: results.length,
      usFound: results.filter((r) => r.hasUsInStock).length,
      updatedDeliveryCount: results.filter((r) => r.updated).length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Falha na auditoria de armazém EUA." },
      { status: 500 },
    );
  }
}
