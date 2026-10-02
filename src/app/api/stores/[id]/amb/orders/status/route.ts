import { createPublicKey, verify as verifySignature } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { syncAliExpressBatch } from "@/lib/aliexpress-fulfillment";
import { prisma } from "@/lib/prisma";
import { bearerToken, verifySharedWebhookToken } from "@/lib/store-webhook-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

function sessionIdFrom(request: NextRequest) {
  return request.nextUrl.searchParams.get("session_id")?.trim() || "";
}

async function ambBootstrapHash() {
  const baseUrl =
    process.env.AMB_BOUTIQUE_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://www.ambboutique.online";
  const response = await fetch(`${baseUrl}/api/store-manager/bootstrap`, { cache: "no-store" });
  const body = await response.json().catch(() => null) as { tokenHash?: string } | null;
  return response.ok ? body?.tokenHash?.trim() || "" : "";
}

async function verifyAmbSignedRequest(request: NextRequest, sessionId: string) {
  const timestamp = request.headers.get("x-amb-timestamp")?.trim() || "";
  const signature = request.headers.get("x-amb-signature")?.trim() || "";
  const keyId = request.headers.get("x-amb-key-id")?.trim() || "";
  const timestampNumber = Number(timestamp);
  const timestampFresh = Boolean(
    timestamp &&
    Number.isFinite(timestampNumber) &&
    Math.abs(Date.now() - timestampNumber) <= 5 * 60 * 1000
  );

  const diagnostic = {
    headersPresent: Boolean(timestamp && signature && keyId),
    timestampFresh,
    keyFetched: false,
    keyIdMatch: false,
    signatureValid: false,
  };

  if (!diagnostic.headersPresent || !timestampFresh) {
    return { valid: false, diagnostic };
  }

  const baseUrl =
    process.env.AMB_BOUTIQUE_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://www.ambboutique.online";
  const response = await fetch(`${baseUrl}/api/fulfillment/public-key`, { cache: "no-store" });
  const body = await response.json().catch(() => null) as {
    algorithm?: string;
    keyId?: string;
    publicKeyPem?: string;
  } | null;
  diagnostic.keyFetched = Boolean(response.ok && body?.publicKeyPem);
  diagnostic.keyIdMatch = Boolean(body?.keyId && body.keyId === keyId);
  if (
    !response.ok ||
    body?.algorithm !== "Ed25519" ||
    !body.publicKeyPem ||
    body.keyId !== keyId
  ) {
    return { valid: false, diagnostic };
  }

  const canonical = [
    "GET",
    request.nextUrl.pathname,
    sessionId,
    timestamp,
  ].join("\n");

  try {
    diagnostic.signatureValid = verifySignature(
      null,
      Buffer.from(canonical, "utf8"),
      createPublicKey(body.publicKeyPem),
      Buffer.from(signature, "base64"),
    );
    return { valid: diagnostic.signatureValid, diagnostic };
  } catch {
    return { valid: false, diagnostic };
  }
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
  if (storeId !== "amb-boutique-store" || !store || store.status !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let tokenValid = Boolean(
    token &&
    store.webhookEnabled &&
    verifySharedWebhookToken(token, store.webhookTokenHash),
  );
  if (!tokenValid && token) {
    const bootstrapHash = await ambBootstrapHash().catch(() => "");
    if (bootstrapHash && verifySharedWebhookToken(token, bootstrapHash)) {
      tokenValid = true;
      await prisma.store.update({
        where: { id: storeId },
        data: {
          baseUrl: "https://www.ambboutique.online",
          webhookEnabled: true,
          webhookTokenHash: bootstrapHash,
          webhookTokenCreatedAt: new Date(),
        },
      });
    }
  }

  const signed = tokenValid
    ? { valid: true, diagnostic: { tokenValid: true } }
    : await verifyAmbSignedRequest(request, sessionId);

  if (!signed.valid) {
    return NextResponse.json({
      ok: false,
      error: "Unauthorized",
      authDiagnostic: signed.diagnostic,
    }, { status: 401 });
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
