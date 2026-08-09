import { NextRequest, NextResponse } from "next/server";

import { scanAmbCatalog } from "@/lib/amb-catalog-scan";
import { syncAliExpressBatch } from "@/lib/aliexpress-fulfillment";
import { expireCheckoutReservations } from "@/lib/inventory-reservation";
import { prisma } from "@/lib/prisma";
import { refreshSupplier } from "@/lib/supplier-refresh-service";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const expiredReservations = await expireCheckoutReservations();
  const supplierResults: Array<{ id: string; ok: boolean; error?: string }> = [];
  const trackingResults: Array<{ id: string; ok: boolean; error?: string }> = [];
  let ambCatalog: Record<string, unknown> | null = null;

  const suppliers = await prisma.supplierProduct.findMany({
    where: { provider: "ALIEXPRESS", status: "ACTIVE" },
    select: { id: true, productId: true },
    orderBy: { lastCheckedAt: "asc" },
    take: 50,
  });

  for (const supplier of suppliers) {
    try {
      await refreshSupplier({ productId: supplier.productId, supplierId: supplier.id, syncAvailability: true });
      supplierResults.push({ id: supplier.id, ok: true });
    } catch (error) {
      supplierResults.push({ id: supplier.id, ok: false, error: error instanceof Error ? error.message : "refresh failed" });
    }
  }

  try {
    ambCatalog = await scanAmbCatalog({ storeId: "amb-boutique-store" }) as unknown as Record<string, unknown>;
  } catch (error) {
    ambCatalog = {
      ok: false,
      error: error instanceof Error ? error.message : "AMB catalog scan failed",
    };
  }

  const batches = await prisma.fulfillmentBatch.findMany({
    where: {
      provider: "ALIEXPRESS",
      status: { in: ["ORDERED", "SHIPPED"] },
      externalOrderId: { not: null },
    },
    select: { id: true, orderId: true },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });

  for (const batch of batches) {
    try {
      await syncAliExpressBatch(batch.orderId, batch.id);
      trackingResults.push({ id: batch.id, ok: true });
    } catch (error) {
      trackingResults.push({ id: batch.id, ok: false, error: error instanceof Error ? error.message : "sync failed" });
    }
  }

  return NextResponse.json({
    ok: true,
    reservations: expiredReservations,
    suppliers: {
      checked: supplierResults.length,
      failed: supplierResults.filter((item) => !item.ok).length,
      results: supplierResults,
    },
    ambCatalog,
    tracking: {
      checked: trackingResults.length,
      failed: trackingResults.filter((item) => !item.ok).length,
      results: trackingResults,
    },
    timestamp: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
