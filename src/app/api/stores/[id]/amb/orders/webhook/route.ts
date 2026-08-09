import { NextResponse } from "next/server";

import { ingestAmbPaidStripeSession } from "@/lib/amb-backend-bridge";
import { scanAmbCatalog } from "@/lib/amb-catalog-scan";
import { prisma } from "@/lib/prisma";
import { bearerToken, verifyStoreWebhookToken } from "@/lib/store-webhook-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

function compactError(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Erro desconhecido")).slice(0, 2000);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: storeId } = await context.params;
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, status: true, webhookEnabled: true, webhookTokenHash: true },
  });

  if (!store || store.status !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "Loja não disponível para fulfillment." }, { status: 404 });
  }

  const token = bearerToken(request);
  if (!store.webhookEnabled || !token || !verifyStoreWebhookToken(token, store.webhookTokenHash)) {
    return NextResponse.json({ ok: false, error: "Credencial de webhook inválida." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido." }, { status: 400 });
  }

  const payload = record(body);
  const sessionId = text(payload.sessionId);
  const eventType = text(payload.eventType) || "amb.stripe.paid";
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return NextResponse.json({ ok: false, error: "sessionId Stripe inválida." }, { status: 400 });
  }

  const externalEventId = `amb:${sessionId}`;
  const previous = await prisma.integrationEvent.findUnique({
    where: { storeId_externalEventId: { storeId, externalEventId } },
  });

  if (previous?.status === "PROCESSED") {
    const existingOrder = await prisma.order.findUnique({
      where: { storeId_externalOrderId: { storeId, externalOrderId: sessionId } },
      select: { id: true, fulfillmentStatus: true, status: true },
    });
    return NextResponse.json({
      ok: true,
      duplicate: true,
      sessionId,
      orderId: existingOrder?.id || null,
      status: existingOrder?.status || null,
      fulfillmentStatus: existingOrder?.fulfillmentStatus || null,
    });
  }

  const eventPayload = {
    source: "AMB_BOUTIQUE_STRIPE_FORWARDER",
    eventType,
    sessionId,
    paymentIntentId: text(payload.paymentIntentId) || null,
    currency: text(payload.currency) || null,
    amountTotal: Number(payload.amountTotal) || 0,
    receivedAt: new Date().toISOString(),
  };

  if (previous) {
    await prisma.integrationEvent.update({
      where: { id: previous.id },
      data: { eventType, status: "RECEIVED", payload: eventPayload, errorMessage: null, processedAt: null },
    });
  } else {
    await prisma.integrationEvent.create({
      data: { storeId, externalEventId, eventType, status: "RECEIVED", payload: eventPayload },
    }).catch(() => undefined);
  }

  await prisma.store.update({
    where: { id: storeId },
    data: { webhookLastSeenAt: new Date() },
  });

  let catalogScanWarning: string | null = null;
  try {
    await scanAmbCatalog({ storeId });
  } catch (error) {
    catalogScanWarning = compactError(error);
  }

  try {
    const result = await ingestAmbPaidStripeSession({ storeId, sessionId });
    await prisma.integrationEvent.updateMany({
      where: { storeId, externalEventId },
      data: { status: "PROCESSED", processedAt: new Date(), errorMessage: null },
    });
    return NextResponse.json({
      ...result,
      catalogScanWarning,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = compactError(error);
    await prisma.integrationEvent.updateMany({
      where: { storeId, externalEventId },
      data: { status: "FAILED", processedAt: new Date(), errorMessage: message },
    });
    return NextResponse.json({
      ok: false,
      error: message,
      sessionId,
      catalogScanWarning,
    }, {
      status: 422,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
