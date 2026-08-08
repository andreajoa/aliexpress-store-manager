import { NextResponse } from "next/server";

import {
  centsToCurrencyUnits,
  minimizedIntegrationPayload,
  paidOrderEventSchema,
} from "@/lib/order-paid-contract";
import { resolvePaidOrderItems } from "@/lib/order-item-resolver";
import { prisma } from "@/lib/prisma";
import {
  bearerToken,
  verifyStoreWebhookToken,
} from "@/lib/store-webhook-auth";

export const runtime = "nodejs";

function compactError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Erro desconhecido");
  return message.slice(0, 2000);
}

async function markEventFailed(storeId: string, externalEventId: string, error: unknown) {
  await prisma.integrationEvent.updateMany({
    where: { storeId, externalEventId },
    data: {
      status: "FAILED",
      errorMessage: compactError(error),
      processedAt: new Date(),
    },
  }).catch(() => undefined);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: storeId } = await context.params;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      status: true,
      webhookEnabled: true,
      webhookTokenHash: true,
    },
  });

  if (!store || store.status !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "Loja não disponível para webhook." }, { status: 404 });
  }

  const token = bearerToken(request);
  if (
    !store.webhookEnabled ||
    !token ||
    !verifyStoreWebhookToken(token, store.webhookTokenHash)
  ) {
    return NextResponse.json({ ok: false, error: "Credencial de webhook inválida." }, { status: 401 });
  }

  await prisma.store.update({
    where: { id: storeId },
    data: { webhookLastSeenAt: new Date() },
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido." }, { status: 400 });
  }

  const parsed = paidOrderEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Evento order.paid inválido.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const event = parsed.data;
  const integrationPayload = minimizedIntegrationPayload(event);

  const previous = await prisma.integrationEvent.findUnique({
    where: {
      storeId_externalEventId: {
        storeId,
        externalEventId: event.eventId,
      },
    },
  });

  if (previous?.status === "PROCESSED") {
    const order = await prisma.order.findUnique({
      where: {
        storeId_externalOrderId: {
          storeId,
          externalOrderId: event.order.id,
        },
      },
      select: { id: true },
    });

    return NextResponse.json({
      ok: true,
      duplicate: true,
      eventId: event.eventId,
      orderId: order?.id || null,
    });
  }

  if (previous) {
    await prisma.integrationEvent.update({
      where: { id: previous.id },
      data: {
        eventType: event.eventType,
        status: "RECEIVED",
        payload: integrationPayload,
        errorMessage: null,
        processedAt: null,
      },
    });
  } else {
    try {
      await prisma.integrationEvent.create({
        data: {
          storeId,
          externalEventId: event.eventId,
          eventType: event.eventType,
          status: "RECEIVED",
          payload: integrationPayload,
        },
      });
    } catch {
      const raced = await prisma.integrationEvent.findUnique({
        where: {
          storeId_externalEventId: {
            storeId,
            externalEventId: event.eventId,
          },
        },
      });
      if (raced?.status === "PROCESSED") {
        const order = await prisma.order.findUnique({
          where: {
            storeId_externalOrderId: {
              storeId,
              externalOrderId: event.order.id,
            },
          },
          select: { id: true },
        });
        return NextResponse.json({ ok: true, duplicate: true, eventId: event.eventId, orderId: order?.id || null });
      }
      if (!raced) {
        return NextResponse.json({ ok: false, error: "Não foi possível registrar o evento." }, { status: 500 });
      }
    }
  }

  try {
    const externalProductIds = Array.from(
      new Set(event.order.items.map((item) => item.externalProductId)),
    );

    const publications = await prisma.publication.findMany({
      where: {
        storeId,
        status: "PUBLISHED",
        externalProductId: { in: externalProductIds },
      },
      select: {
        externalProductId: true,
        product: {
          select: {
            id: true,
            sourceUrl: true,
            variants: {
              select: {
                id: true,
                sourceSkuId: true,
                attributes: true,
              },
            },
          },
        },
      },
    });

    const counts = new Map<string, number>();
    for (const publication of publications) {
      if (!publication.externalProductId) continue;
      counts.set(
        publication.externalProductId,
        (counts.get(publication.externalProductId) || 0) + 1,
      );
    }
    const ambiguousPublication = [...counts.entries()].find(([, count]) => count > 1);
    if (ambiguousPublication) {
      throw new Error(`externalProductId ambíguo na loja: ${ambiguousPublication[0]}`);
    }

    const resolution = resolvePaidOrderItems({
      items: event.order.items,
      publishedProducts: publications.flatMap((publication) =>
        publication.externalProductId
          ? [{
              externalProductId: publication.externalProductId,
              productId: publication.product.id,
              sourceUrl: publication.product.sourceUrl,
              variants: publication.product.variants,
            }]
          : [],
      ),
    });

    if (!resolution.ready) {
      const detail = resolution.blockers
        .map((blocker) => `${blocker.code}:${blocker.externalProductId}:${blocker.externalVariantId || "-"}`)
        .join(" | ");
      await markEventFailed(storeId, event.eventId, detail);
      return NextResponse.json(
        { ok: false, error: "Pedido não pôde ser resolvido com segurança.", blockers: resolution.blockers },
        { status: 422 },
      );
    }

    const existingOrder = await prisma.order.findUnique({
      where: {
        storeId_externalOrderId: {
          storeId,
          externalOrderId: event.order.id,
        },
      },
      select: { id: true },
    });

    if (existingOrder) {
      await prisma.integrationEvent.updateMany({
        where: { storeId, externalEventId: event.eventId },
        data: {
          status: "PROCESSED",
          errorMessage: null,
          processedAt: new Date(),
        },
      });
      return NextResponse.json({
        ok: true,
        duplicate: true,
        eventId: event.eventId,
        orderId: existingOrder.id,
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          storeId,
          externalOrderId: event.order.id,
          status: "PAID",
          paymentStatus: "PAID",
          fulfillmentStatus: "UNFULFILLED",
          currency: event.order.currency,
          subtotal: centsToCurrencyUnits(event.order.subtotalCents),
          shippingAmount: centsToCurrencyUnits(event.order.shippingAmountCents),
          discountAmount: centsToCurrencyUnits(event.order.discountAmountCents),
          total: centsToCurrencyUnits(event.order.totalCents),
          customerName: event.order.customer.name,
          customerEmail: event.order.customer.email || null,
          customerPhone: event.order.customer.phone || null,
          orderedAt: new Date(event.occurredAt),
          shippingAddress: {
            create: {
              recipient: event.order.shippingAddress.recipient,
              line1: event.order.shippingAddress.line1,
              line2: event.order.shippingAddress.line2 || null,
              number: event.order.shippingAddress.number || null,
              district: event.order.shippingAddress.district || null,
              city: event.order.shippingAddress.city,
              state: event.order.shippingAddress.state,
              postalCode: event.order.shippingAddress.postalCode,
              countryCode: event.order.shippingAddress.countryCode.toUpperCase(),
              instructions: event.order.shippingAddress.instructions || null,
            },
          },
          items: {
            create: resolution.items.map((item) => ({
              productId: item.productId,
              variantId: item.variantId,
              titleSnapshot: item.title,
              variantSnapshot: item.variantSnapshot === null
                ? undefined
                : JSON.parse(JSON.stringify(item.variantSnapshot)),
              sourceSkuIdSnapshot: item.sourceSkuId,
              sourceUrlSnapshot: item.sourceUrl,
              quantity: item.quantity,
              unitPrice: centsToCurrencyUnits(item.unitPriceCents),
              totalPrice: centsToCurrencyUnits(item.totalPriceCents),
            })),
          },
        },
        select: { id: true },
      });

      await tx.integrationEvent.updateMany({
        where: { storeId, externalEventId: event.eventId },
        data: {
          status: "PROCESSED",
          errorMessage: null,
          processedAt: new Date(),
        },
      });

      return order;
    });

    return NextResponse.json(
      {
        ok: true,
        duplicate: false,
        eventId: event.eventId,
        orderId: created.id,
        fulfillmentStatus: "UNFULFILLED",
      },
      { status: 201 },
    );
  } catch (error) {
    await markEventFailed(storeId, event.eventId, error);
    console.error("Paid order ingestion failed:", error);
    return NextResponse.json(
      { ok: false, error: compactError(error) },
      { status: 500 },
    );
  }
}
