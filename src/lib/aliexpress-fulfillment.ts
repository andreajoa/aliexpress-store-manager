import { randomUUID } from "node:crypto";

import { prisma } from "./prisma";
import { requireAliExpressSession } from "./aliexpress-connection";
import { markFulfillmentBatchOrdered, updateFulfillmentBatchTracking } from "./order-fulfillment-lifecycle";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];
  return [value as T];
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function normalizeAliExpressCountryCode(countryCode: string) {
  const normalized = countryCode.trim().toUpperCase();
  return normalized === "GB" ? "UK" : normalized;
}

const PHONE_COUNTRY: Record<string, string> = {
  US: "+1",
  CA: "+1",
  UK: "+44",
  AU: "+61",
  NZ: "+64",
};

function cleanPhone(value: string | null) {
  if (!value) return "";
  return value.replace(/[^0-9+]/g, "");
}

function logisticsAddress(input: {
  customerPhone: string | null;
  recipient: string;
  line1: string;
  line2: string | null;
  number: string | null;
  district: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
}) {
  const country = normalizeAliExpressCountryCode(input.countryCode);
  const phone = cleanPhone(input.customerPhone);
  if (!input.recipient.trim()) throw new Error("Nome do destinatário ausente.");
  if (!input.line1.trim() || !input.city.trim() || !input.state.trim() || !input.postalCode.trim()) {
    throw new Error("Endereço de entrega incompleto.");
  }
  if (!phone) throw new Error("Telefone do comprador é obrigatório para criar o pedido AliExpress.");

  const firstLine = [input.line1.trim(), input.number?.trim()].filter(Boolean).join(", ");
  const secondLine = [input.line2?.trim(), input.district?.trim()].filter(Boolean).join(", ");
  return {
    address: firstLine,
    ...(secondLine ? { address2: secondLine } : {}),
    city: input.city.trim(),
    contact_person: input.recipient.trim(),
    full_name: input.recipient.trim(),
    country,
    province: input.state.trim(),
    zip: input.postalCode.trim(),
    mobile_no: phone,
    ...(PHONE_COUNTRY[country] ? { phone_country: PHONE_COUNTRY[country] } : {}),
    locale: "en_US",
  };
}

async function loadBatch(orderId: string, batchId: string) {
  const batch = await prisma.fulfillmentBatch.findFirst({
    where: { id: batchId, orderId },
    include: {
      order: { include: { shippingAddress: true } },
      items: {
        include: {
          fulfillmentSupplierVariant: {
            select: { id: true, sourceSkuId: true, orderSkuAttr: true },
          },
        },
      },
    },
  });
  if (!batch) throw new Error("Lote de fulfillment não encontrado.");
  if (batch.provider !== "ALIEXPRESS") throw new Error("Este lote não pertence ao AliExpress.");
  return batch;
}

export async function quoteAliExpressBatch(orderId: string, batchId: string) {
  const batch = await loadBatch(orderId, batchId);
  if (batch.status !== "PROCESSING" || batch.externalOrderId) {
    throw new Error("Frete só pode ser escolhido antes da criação do pedido AliExpress.");
  }
  const address = batch.order.shippingAddress;
  if (!address) throw new Error("Pedido sem endereço de entrega.");
  const quantity = batch.items.reduce((sum, item) => sum + item.quantity, 0);
  if (quantity <= 0) throw new Error("Lote sem quantidade válida.");

  const { session, client } = await requireAliExpressSession();
  const quotes = await client.calculateFreight({
    session,
    productId: batch.sourceProductId,
    quantity,
    countryCode: normalizeAliExpressCountryCode(address.countryCode),
    sendGoodsCountryCode: process.env.ALIEXPRESS_SEND_GOODS_COUNTRY?.trim() || "CN",
    priceCurrency: batch.currency || undefined,
  });
  if (quotes.length === 0) throw new Error("AliExpress não retornou método de envio disponível para este destino.");
  return { batchId: batch.id, countryCode: normalizeAliExpressCountryCode(address.countryCode), quotes };
}

export async function placeAliExpressBatchOrder(input: {
  orderId: string;
  batchId: string;
  logisticsServiceName: string;
}) {
  const serviceName = input.logisticsServiceName.trim();
  if (!serviceName) throw new Error("Escolha um método de envio antes de criar o pedido.");

  const batch = await loadBatch(input.orderId, input.batchId);
  if (batch.externalOrderId) {
    return { idempotent: true, externalOrderId: batch.externalOrderId, paymentRequired: true };
  }
  if (batch.status !== "PROCESSING") throw new Error("Lote não está disponível para criação de pedido.");
  if (batch.placementStatus === "PLACING" || batch.placementStatus === "UNKNOWN") {
    throw new Error("Este lote possui uma tentativa de compra sem resultado conclusivo. Verifique no AliExpress antes de qualquer nova tentativa.");
  }
  if (!batch.order.shippingAddress) throw new Error("Pedido sem endereço de entrega.");
  if (batch.items.length === 0) throw new Error("Lote sem itens.");

  for (const item of batch.items) {
    if (!item.fulfillmentSupplierVariant?.orderSkuAttr) {
      throw new Error(`SKU ${item.fulfillmentSourceSkuId || item.id} ainda não possui sku_attr oficial. Sincronize as variantes primeiro.`);
    }
  }

  const attemptId = randomUUID();
  const lock = await prisma.fulfillmentBatch.updateMany({
    where: {
      id: batch.id,
      orderId: input.orderId,
      status: "PROCESSING",
      externalOrderId: null,
      OR: [{ placementStatus: null }, { placementStatus: "ERROR" }],
    },
    data: {
      placementStatus: "PLACING",
      placementAttemptId: attemptId,
      placementStartedAt: new Date(),
      placementLastError: null,
      logisticsServiceName: serviceName,
    },
  });
  if (lock.count !== 1) throw new Error("Outro processo já iniciou a criação deste pedido.");

  try {
    const { session, client } = await requireAliExpressSession();
    const address = logisticsAddress({
      customerPhone: batch.order.customerPhone,
      ...batch.order.shippingAddress,
    });
    const result = await client.placeOrder({
      session,
      logisticsAddress: address,
      productItems: batch.items.map((item) => ({
        productId: batch.sourceProductId,
        quantity: item.quantity,
        skuAttr: item.fulfillmentSupplierVariant!.orderSkuAttr!,
        logisticsServiceName: serviceName,
        orderMemo: `Store Manager ${batch.order.externalOrderId}`,
      })),
    });
    const externalOrderId = result.orderIds[0];
    await markFulfillmentBatchOrdered({
      orderId: input.orderId,
      batchId: batch.id,
      externalOrderId,
    });
    await prisma.fulfillmentBatch.update({
      where: { id: batch.id },
      data: {
        placementStatus: "COMPLETE",
        placementLastError: null,
        logisticsServiceName: serviceName,
      },
    });
    return {
      idempotent: false,
      externalOrderId,
      allExternalOrderIds: result.orderIds,
      paymentRequired: true,
      paymentUrl: process.env.ALIEXPRESS_PAYMENT_URL?.trim() || "https://www.aliexpress.com/p/order/index.html",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida ao criar pedido AliExpress.";
    await prisma.fulfillmentBatch.updateMany({
      where: { id: batch.id, placementAttemptId: attemptId, externalOrderId: null },
      data: { placementStatus: "UNKNOWN", placementLastError: message },
    });
    throw new Error(`${message} A tentativa ficou bloqueada como UNKNOWN para evitar pedido duplicado.`);
  }
}

export async function clearUnknownAliExpressPlacement(input: {
  orderId: string;
  batchId: string;
  confirmedNoOrderExists: boolean;
}) {
  if (!input.confirmedNoOrderExists) throw new Error("Confirmação explícita obrigatória.");
  const updated = await prisma.fulfillmentBatch.updateMany({
    where: {
      id: input.batchId,
      orderId: input.orderId,
      status: "PROCESSING",
      externalOrderId: null,
      placementStatus: "UNKNOWN",
    },
    data: {
      placementStatus: "ERROR",
      placementAttemptId: null,
      placementStartedAt: null,
      placementLastError: "Operador confirmou que nenhum pedido foi criado no AliExpress.",
    },
  });
  if (updated.count !== 1) throw new Error("Lote não possui tentativa UNKNOWN liberável.");
  return { cleared: true };
}

export async function syncAliExpressBatch(orderId: string, batchId: string) {
  const batch = await loadBatch(orderId, batchId);
  if (!batch.externalOrderId) throw new Error("Lote ainda não possui pedido AliExpress.");
  const { session, client } = await requireAliExpressSession();
  const envelope = await client.getOrder({ session, orderId: batch.externalOrderId });
  const result = record(envelope.result);
  const logisticsContainer = record(result.logistics_info_list);
  const logisticsRows = array<Record<string, unknown>>(logisticsContainer.aeop_order_logistics_info);
  const logistics = logisticsRows[0] || null;
  const logisticsNo = logistics ? text(logistics.logistics_no) : "";
  const serviceName = logistics ? text(logistics.logistics_service) : "";
  const logisticsStatus = text(result.logistics_status);
  const orderStatus = text(result.order_status);

  if (logisticsNo) {
    let trackingUrl: string | null = null;
    try {
      const tracking = await client.trackingInfo({
        session,
        logisticsNo,
        orderId: batch.externalOrderId,
        serviceName: serviceName || batch.logisticsServiceName || "OTHER",
        countryCode: normalizeAliExpressCountryCode(batch.order.shippingAddress?.countryCode || ""),
      });
      trackingUrl = text(tracking.official_website) || null;
    } catch (error) {
      console.warn("AliExpress tracking detail query failed:", error);
    }

    if (["SELLER_SEND_GOODS", "WAIT_BUYER_ACCEPT_GOODS"].includes(logisticsStatus)) {
      await updateFulfillmentBatchTracking({
        orderId,
        batchId,
        status: "SHIPPED",
        trackingCode: logisticsNo,
        trackingUrl,
        carrier: serviceName || batch.logisticsServiceName,
      });
    }
  }

  return {
    batchId,
    externalOrderId: batch.externalOrderId,
    orderStatus,
    logisticsStatus,
    logisticsNo: logisticsNo || null,
    serviceName: serviceName || batch.logisticsServiceName || null,
  };
}
