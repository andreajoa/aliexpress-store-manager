import { prisma } from "./prisma";
import { syncCanonicalAvailability } from "./supplier-refresh-service";

function aggregateStatus(statuses: string[]) {
  if (statuses.length === 0) {
    return { orderStatus: "PAID" as const, fulfillmentStatus: "UNFULFILLED" as const };
  }

  if (statuses.every((status) => status === "DELIVERED")) {
    return { orderStatus: "DELIVERED" as const, fulfillmentStatus: "DELIVERED" as const };
  }

  if (statuses.every((status) => status === "SHIPPED" || status === "DELIVERED")) {
    return { orderStatus: "SHIPPED" as const, fulfillmentStatus: "SHIPPED" as const };
  }

  if (statuses.every((status) => ["ORDERED", "SHIPPED", "DELIVERED"].includes(status))) {
    return { orderStatus: "ORDERED_ALIEXPRESS" as const, fulfillmentStatus: "ORDERED" as const };
  }

  return { orderStatus: "PROCESSING" as const, fulfillmentStatus: "PROCESSING" as const };
}

async function updateAggregateOrder(orderId: string) {
  const batches = await prisma.fulfillmentBatch.findMany({
    where: { orderId },
    select: {
      id: true,
      status: true,
      externalOrderId: true,
      trackingCode: true,
      trackingUrl: true,
      carrier: true,
      orderedAt: true,
      shippedAt: true,
      deliveredAt: true,
    },
  });

  const aggregate = aggregateStatus(batches.map((batch) => batch.status));
  const single = batches.length === 1 ? batches[0] : null;
  const orderedDates = batches.flatMap((batch) => batch.orderedAt ? [batch.orderedAt] : []);
  const shippedDates = batches.flatMap((batch) => batch.shippedAt ? [batch.shippedAt] : []);
  const deliveredDates = batches.flatMap((batch) => batch.deliveredAt ? [batch.deliveredAt] : []);

  return prisma.order.update({
    where: { id: orderId },
    data: {
      status: aggregate.orderStatus,
      fulfillmentStatus: aggregate.fulfillmentStatus,
      aliexpressOrderId: single?.externalOrderId || null,
      trackingCode: single?.trackingCode || null,
      trackingUrl: single?.trackingUrl || null,
      carrier: single?.carrier || null,
      orderedAliAt: orderedDates.length ? new Date(Math.max(...orderedDates.map((date) => date.getTime()))) : null,
      shippedAt: shippedDates.length && aggregate.fulfillmentStatus !== "PROCESSING"
        ? new Date(Math.max(...shippedDates.map((date) => date.getTime())))
        : null,
      deliveredAt: deliveredDates.length && aggregate.fulfillmentStatus === "DELIVERED"
        ? new Date(Math.max(...deliveredDates.map((date) => date.getTime())))
        : null,
    },
    select: { id: true, status: true, fulfillmentStatus: true },
  });
}

export async function markFulfillmentBatchOrdered(input: {
  orderId: string;
  batchId: string;
  externalOrderId: string;
}) {
  const batch = await prisma.fulfillmentBatch.findFirst({
    where: { id: input.batchId, orderId: input.orderId },
    include: { items: { select: { productId: true } } },
  });

  if (!batch) throw new Error("Lote de fulfillment não encontrado.");
  if (batch.status === "CANCELLED") throw new Error("Lote cancelado não pode receber pedido externo.");
  if (batch.externalOrderId && batch.externalOrderId !== input.externalOrderId) {
    throw new Error("Este lote já possui outro número de pedido externo.");
  }

  if (batch.status === "PROCESSING") {
    await prisma.fulfillmentBatch.update({
      where: { id: batch.id },
      data: {
        status: "ORDERED",
        externalOrderId: input.externalOrderId,
        orderedAt: new Date(),
      },
    });
  }

  const order = await updateAggregateOrder(input.orderId);
  return {
    idempotent: batch.status !== "PROCESSING",
    batchId: batch.id,
    externalOrderId: input.externalOrderId,
    order,
  };
}

export async function updateFulfillmentBatchTracking(input: {
  orderId: string;
  batchId: string;
  status: "SHIPPED" | "DELIVERED";
  trackingCode?: string | null;
  trackingUrl?: string | null;
  carrier?: string | null;
}) {
  const batch = await prisma.fulfillmentBatch.findFirst({
    where: { id: input.batchId, orderId: input.orderId },
    include: { items: { select: { productId: true } } },
  });

  if (!batch) throw new Error("Lote de fulfillment não encontrado.");
  if (!["ORDERED", "SHIPPED", "DELIVERED"].includes(batch.status)) {
    throw new Error("Registre primeiro o pedido externo deste lote.");
  }

  const trackingCode = input.trackingCode?.trim() || batch.trackingCode;
  if (!trackingCode) throw new Error("Código de rastreamento é obrigatório.");

  if (input.status === "SHIPPED" && batch.status !== "DELIVERED") {
    await prisma.fulfillmentBatch.update({
      where: { id: batch.id },
      data: {
        status: "SHIPPED",
        trackingCode,
        trackingUrl: input.trackingUrl?.trim() || batch.trackingUrl,
        carrier: input.carrier?.trim() || batch.carrier,
        shippedAt: batch.shippedAt || new Date(),
      },
    });
  }

  if (input.status === "DELIVERED") {
    await prisma.fulfillmentBatch.update({
      where: { id: batch.id },
      data: {
        status: "DELIVERED",
        trackingCode,
        trackingUrl: input.trackingUrl?.trim() || batch.trackingUrl,
        carrier: input.carrier?.trim() || batch.carrier,
        shippedAt: batch.shippedAt || new Date(),
        deliveredAt: batch.deliveredAt || new Date(),
      },
    });
  }

  const order = await updateAggregateOrder(input.orderId);
  const productIds = Array.from(new Set(batch.items.flatMap((item) => item.productId ? [item.productId] : [])));
  const syncWarnings: string[] = [];

  for (const productId of productIds) {
    try {
      await syncCanonicalAvailability(productId);
    } catch (error) {
      syncWarnings.push(error instanceof Error ? error.message : `Falha ao sincronizar ${productId}.`);
    }
  }

  return {
    batchId: batch.id,
    status: input.status,
    trackingCode,
    order,
    syncWarnings,
  };
}
