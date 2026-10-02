import { NextRequest, NextResponse } from "next/server";

import { syncAliExpressBatch } from "@/lib/aliexpress-fulfillment";
import { prisma } from "@/lib/prisma";
import { bearerToken, verifySharedWebhookToken } from "@/lib/store-webhook-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

function sessionIdFrom(request: NextRequest) {
  return request.nextUrl.searchParams.get("session_id")?.trim() || "";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: storeId } = await context.params;
  const sessionId = sessionIdFrom(request);
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return NextResponse.json({ ok: false, error: "Invalid order reference." }, { status: 400 });
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { status: true, webhookEnabled: true, webhookTokenHash: true },
  });
  const token = bearerToken(request);
  if (
    storeId !== "amb-boutique-store" ||
    !store ||
    store.status !== "ACTIVE" ||
    !store.webhookEnabled ||
    !token ||
    !verifySharedWebhookToken(token, store.webhookTokenHash)
  ) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const order = await prisma.order.findUnique({
    where: { storeId_externalOrderId: { storeId, externalOrderId: sessionId } },
    include: {
      fulfillmentBatches: {
        where: { provider: "ALIEXPRESS" },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  const syncResults: Array<{
    batchId: string;
    status: string;
    trackingCode: string | null;
    trackingUrl: string | null;
    events: Array<{ eventDesc: string; status: string; address: string | null; eventDate: string | null }>;
    error?: string;
  }> = [];

  for (const batch of order.fulfillmentBatches) {
    if (!batch.externalOrderId || !["ORDERED", "SHIPPED"].includes(batch.status)) {
      syncResults.push({
        batchId: batch.id,
        status: batch.status,
        trackingCode: batch.trackingCode,
        trackingUrl: null,
        events: [],
      });
      continue;
    }

    try {
      const result = await syncAliExpressBatch(order.id, batch.id);
      syncResults.push({
        batchId: batch.id,
        status: batch.status,
        trackingCode: result.logisticsNo || batch.trackingCode,
        trackingUrl: result.trackingUrl || null,
        events: result.trackingEvents || [],
      });
    } catch (error) {
      syncResults.push({
        batchId: batch.id,
        status: batch.status,
        trackingCode: batch.trackingCode,
        trackingUrl: null,
        events: [],
        error: error instanceof Error ? error.message : "Tracking sync failed",
      });
    }
  }

  const refreshed = await prisma.order.findUnique({
    where: { id: order.id },
    include: {
      fulfillmentBatches: {
        where: { provider: "ALIEXPRESS" },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!refreshed) {
    return NextResponse.json({ ok: false, error: "Order unavailable after sync." }, { status: 404 });
  }

  const byBatch = new Map(syncResults.map((item) => [item.batchId, item]));
  const batches = refreshed.fulfillmentBatches.map((batch) => {
    const sync = byBatch.get(batch.id);
    return {
      id: batch.id,
      status: batch.status,
      trackingCode: batch.trackingCode || sync?.trackingCode || null,
      customerCarrier: "AMB Boutique Delivery",
      events: sync?.events || [],
      syncError: sync?.error || null,
    };
  });

  return NextResponse.json({
    ok: true,
    sessionId,
    status: refreshed.status,
    fulfillmentStatus: refreshed.fulfillmentStatus,
    trackingCode: refreshed.trackingCode || batches.find((item) => item.trackingCode)?.trackingCode || null,
    shippedAt: refreshed.shippedAt?.toISOString() || null,
    deliveredAt: refreshed.deliveredAt?.toISOString() || null,
    batches,
    checkedAt: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
