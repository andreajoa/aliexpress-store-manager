import { synchronizeOfficialAliExpressSkus } from "./aliexpress-sku-sync";
import { placeAliExpressBatchOrder, quoteAliExpressBatch } from "./aliexpress-fulfillment";
import { prepareOrderFulfillment } from "./order-fulfillment-service";
import { prisma } from "./prisma";
import { refreshSupplier, syncCanonicalAvailability } from "./supplier-refresh-service";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function normalized(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type AmbProductBinding = {
  sourceProductId: string;
  color: string;
};

export type AmbBridgeConfig = {
  version: number;
  mode: string;
  products: Record<string, AmbProductBinding>;
};

export function parseAmbBridgeConfig(value: unknown): AmbBridgeConfig | null {
  const root = record(value);
  const bridge = record(root.ambBridge);
  const products = record(bridge.products);
  if (Number(bridge.version) !== 1 || Object.keys(products).length === 0) return null;

  const parsed: Record<string, AmbProductBinding> = {};
  for (const [slug, raw] of Object.entries(products)) {
    const binding = record(raw);
    const sourceProductId = text(binding.sourceProductId);
    const color = text(binding.color);
    if (!slug.trim() || !sourceProductId || !color) continue;
    parsed[slug] = { sourceProductId, color };
  }
  if (Object.keys(parsed).length === 0) return null;
  return {
    version: 1,
    mode: text(bridge.mode) || "backend-only",
    products: parsed,
  };
}

export type AmbStripeProduct = {
  id: string;
  name: string;
  metadata: Record<string, string>;
};

export type AmbStripeLine = {
  id: string;
  quantity: number;
  amountSubtotal: number;
  amountTotal: number;
  product: AmbStripeProduct;
};

export type AmbStripeSession = {
  id: string;
  paymentStatus: string;
  currency: string;
  amountSubtotal: number;
  amountTotal: number;
  amountShipping: number;
  amountDiscount: number;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  shipping: {
    recipient: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    countryCode: string;
  };
  metadata: Record<string, string>;
  lines: AmbStripeLine[];
};

async function stripeRequest(path: string) {
  const secret = process.env.AMB_STRIPE_SECRET_KEY?.trim() || process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("AMB_STRIPE_SECRET_KEY não está configurada no Store Manager.");
  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const error = record(record(body).error);
    throw new Error(text(error.message) || `Stripe HTTP ${response.status}.`);
  }
  return record(body);
}

function stringMetadata(value: unknown) {
  const source = record(value);
  return Object.fromEntries(
    Object.entries(source).flatMap(([key, raw]) => {
      const valueText = text(raw);
      return valueText ? [[key, valueText]] : [];
    }),
  );
}

export async function loadAmbStripeSession(sessionId: string): Promise<AmbStripeSession> {
  const safeId = sessionId.trim();
  if (!/^cs_[A-Za-z0-9_]+$/.test(safeId)) throw new Error("Stripe Checkout Session inválida.");

  const session = await stripeRequest(`/v1/checkout/sessions/${encodeURIComponent(safeId)}`);
  const linesEnvelope = await stripeRequest(
    `/v1/checkout/sessions/${encodeURIComponent(safeId)}/line_items?limit=100&expand[]=data.price.product`,
  );
  const customer = record(session.customer_details);
  const collected = record(session.collected_information);
  const shipping = record(collected.shipping_details);
  const address = record(shipping.address);
  const totals = record(session.total_details);
  const rawLines = Array.isArray(linesEnvelope.data) ? linesEnvelope.data : [];

  const lines: AmbStripeLine[] = rawLines.map((raw, index) => {
    const line = record(raw);
    const price = record(line.price);
    const product = record(price.product);
    const productId = text(product.id);
    if (!productId) throw new Error(`Stripe line ${index + 1} não retornou Product expandido.`);
    return {
      id: text(line.id) || `line-${index + 1}`,
      quantity: Math.max(1, integer(line.quantity)),
      amountSubtotal: Math.max(0, integer(line.amount_subtotal)),
      amountTotal: Math.max(0, integer(line.amount_total)),
      product: {
        id: productId,
        name: text(product.name) || "AMB BOUTIQUE product",
        metadata: stringMetadata(product.metadata),
      },
    };
  });

  if (lines.length === 0) throw new Error("Stripe Session não possui itens de compra.");
  const recipient = text(shipping.name) || text(customer.name);
  const city = text(address.city);
  const state = text(address.state) || city;
  if (!recipient || !text(address.line1) || !city || !state || !text(address.postal_code) || !text(address.country)) {
    throw new Error("Stripe Session não possui endereço de entrega completo para fulfillment.");
  }

  return {
    id: text(session.id) || safeId,
    paymentStatus: text(session.payment_status),
    currency: text(session.currency).toUpperCase(),
    amountSubtotal: Math.max(0, integer(session.amount_subtotal)),
    amountTotal: Math.max(0, integer(session.amount_total)),
    amountShipping: Math.max(0, integer(totals.amount_shipping)),
    amountDiscount: Math.max(0, integer(totals.amount_discount)),
    customerName: text(customer.name) || recipient,
    customerEmail: text(customer.email) || null,
    customerPhone: text(customer.phone) || null,
    shipping: {
      recipient,
      line1: text(address.line1),
      line2: text(address.line2) || null,
      city,
      state,
      postalCode: text(address.postal_code),
      countryCode: text(address.country).toUpperCase(),
    },
    metadata: stringMetadata(session.metadata),
    lines,
  };
}

export type AliExpressFreightChoice = {
  serviceName: string;
  amount: number | null;
  estimatedDeliveryTime: string | null;
};

export function chooseAliExpressFreight<T extends AliExpressFreightChoice>(
  quotes: T[],
  preferred = process.env.ALIEXPRESS_PREFERRED_LOGISTICS?.trim() || "AliExpress Standard Shipping",
): T | null {
  if (quotes.length === 0) return null;
  const exact = quotes.find((quote) => normalized(quote.serviceName) === normalized(preferred));
  if (exact) return exact;
  const standard = quotes.find((quote) => normalized(quote.serviceName).includes("aliexpress standard"));
  if (standard) return standard;
  return [...quotes].sort((a, b) => {
    const amountA = a.amount == null ? Number.POSITIVE_INFINITY : a.amount;
    const amountB = b.amount == null ? Number.POSITIVE_INFINITY : b.amount;
    return amountA - amountB || a.serviceName.localeCompare(b.serviceName);
  })[0] || null;
}

function cents(value: number) {
  return Math.round(value) / 100;
}

async function resolveAmbLineItems(storeId: string, session: AmbStripeSession) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, status: true, connectorCapabilities: true },
  });
  if (!store || store.status !== "ACTIVE") throw new Error("AMB Boutique não está ativa no Store Manager.");
  const bridge = parseAmbBridgeConfig(store.connectorCapabilities);
  if (!bridge) throw new Error("AMB backend bridge não possui catálogo operacional configurado.");

  const requested = session.lines.map((line) => {
    const slug = line.product.metadata.slug?.trim();
    const size = line.product.metadata.size?.trim();
    if (!slug || !size) throw new Error(`Stripe line ${line.id} não contém slug e size para fulfillment.`);
    const binding = bridge.products[slug];
    if (!binding) throw new Error(`Produto AMB sem vínculo operacional no Manager: ${slug}.`);
    return { line, slug, size, binding };
  });

  const sourceProductIds = [...new Set(requested.map((item) => item.binding.sourceProductId))];
  const products = await prisma.product.findMany({
    where: { sourceProvider: "ALIEXPRESS", sourceProductId: { in: sourceProductIds } },
    include: {
      variants: true,
      supplierProducts: {
        where: { provider: "ALIEXPRESS", status: "ACTIVE" },
        select: { id: true },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  const bySource = new Map(products.map((product) => [product.sourceProductId, product]));

  return requested.map(({ line, slug, size, binding }) => {
    const product = bySource.get(binding.sourceProductId);
    if (!product) throw new Error(`Produto-fonte ${binding.sourceProductId} não existe no Manager.`);
    const candidates = product.variants.filter((variant) => {
      const attributes = record(variant.attributes);
      return normalized(attributes.Color) === normalized(binding.color)
        && normalized(attributes.Size) === normalized(size);
    });
    if (candidates.length !== 1) {
      throw new Error(
        `${slug}/${size} resolveu ${candidates.length} variantes para ${binding.sourceProductId}/${binding.color}; fulfillment bloqueado.`,
      );
    }
    const variant = candidates[0];
    const supplierProduct = product.supplierProducts[0];
    if (!supplierProduct) throw new Error(`Produto ${slug} não possui fornecedor AliExpress ativo.`);
    return { line, slug, size, binding, product, variant, supplierProductId: supplierProduct.id };
  });
}

async function createAmbOrder(storeId: string, session: AmbStripeSession) {
  const existing = await prisma.order.findUnique({
    where: { storeId_externalOrderId: { storeId, externalOrderId: session.id } },
    select: { id: true, status: true, fulfillmentStatus: true },
  });
  if (existing) return { ...existing, duplicate: true };

  const items = await resolveAmbLineItems(storeId, session);
  const order = await prisma.order.create({
    data: {
      storeId,
      externalOrderId: session.id,
      status: "PAID",
      paymentStatus: "PAID",
      fulfillmentStatus: "UNFULFILLED",
      sourceOrderScope: "FULL_ORDER",
      sourceOrderTotal: cents(session.amountTotal),
      currency: session.currency || "USD",
      subtotal: cents(session.amountSubtotal),
      shippingAmount: cents(session.amountShipping),
      discountAmount: cents(session.amountDiscount),
      total: cents(session.amountTotal),
      customerName: session.customerName,
      customerEmail: session.customerEmail,
      customerPhone: session.customerPhone,
      orderedAt: new Date(),
      shippingAddress: {
        create: {
          recipient: session.shipping.recipient,
          line1: session.shipping.line1,
          line2: session.shipping.line2,
          city: session.shipping.city,
          state: session.shipping.state,
          postalCode: session.shipping.postalCode,
          countryCode: session.shipping.countryCode,
        },
      },
      items: {
        create: items.map(({ line, slug, size, binding, product, variant }) => ({
          productId: product.id,
          variantId: variant.id,
          titleSnapshot: line.product.name,
          variantSnapshot: {
            source: "AMB_BACKEND_BRIDGE_V1",
            ambSlug: slug,
            ambSize: size,
            ambColor: line.product.metadata.color || null,
            supplierColor: binding.color,
            sourceSkuId: variant.sourceSkuId,
            attributes: variant.attributes,
          },
          sourceSkuIdSnapshot: variant.sourceSkuId,
          sourceUrlSnapshot: product.sourceUrl,
          quantity: line.quantity,
          unitPrice: cents(Math.round(line.amountSubtotal / line.quantity)),
          totalPrice: cents(line.amountSubtotal),
        })),
      },
    },
    select: { id: true, status: true, fulfillmentStatus: true },
  });
  return { ...order, duplicate: false };
}

async function refreshOrderSuppliers(orderId: string) {
  const rows = await prisma.orderItem.findMany({
    where: { orderId, productId: { not: null } },
    select: { productId: true },
  });
  const productIds = [...new Set(rows.flatMap((row) => row.productId ? [row.productId] : []))];
  for (const productId of productIds) {
    const suppliers = await prisma.supplierProduct.findMany({
      where: { productId, provider: "ALIEXPRESS", status: "ACTIVE" },
      select: { id: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    if (suppliers.length === 0) throw new Error(`Produto ${productId} sem fornecedor ativo.`);
    for (const supplier of suppliers) {
      await refreshSupplier({ productId, supplierId: supplier.id, syncAvailability: false });
    }
    await syncCanonicalAvailability(productId);
  }
  return productIds;
}

async function autoCreateAliExpressUnpaidOrders(orderId: string, countryCode: string) {
  const batches = await prisma.fulfillmentBatch.findMany({
    where: { orderId, provider: "ALIEXPRESS", status: "PROCESSING", externalOrderId: null },
    select: { id: true, supplierProductId: true },
    orderBy: { createdAt: "asc" },
  });
  const results: Array<Record<string, unknown>> = [];
  for (const batch of batches) {
    if (!batch.supplierProductId) {
      results.push({ batchId: batch.id, ok: false, error: "Lote sem SupplierProduct." });
      continue;
    }
    try {
      const skuSync = await synchronizeOfficialAliExpressSkus({
        supplierProductId: batch.supplierProductId,
        countryCode,
      });
      if (!skuSync.ready || !skuSync.written) {
        throw new Error(skuSync.issues.join(" | ") || "SKU oficial exige revisão manual.");
      }
      const quote = await quoteAliExpressBatch(orderId, batch.id);
      const selected = chooseAliExpressFreight(quote.quotes);
      if (!selected) throw new Error("AliExpress não retornou frete utilizável.");
      const placed = await placeAliExpressBatchOrder({
        orderId,
        batchId: batch.id,
        logisticsServiceName: selected.serviceName,
      });
      results.push({
        batchId: batch.id,
        ok: true,
        serviceName: selected.serviceName,
        externalOrderId: placed.externalOrderId,
        paymentRequired: placed.paymentRequired,
        paymentUrl: placed.paymentUrl,
      });
    } catch (error) {
      results.push({
        batchId: batch.id,
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao preparar pedido AliExpress.",
      });
    }
  }
  return results;
}

export async function ingestAmbPaidStripeSession(input: { storeId: string; sessionId: string }) {
  const session = await loadAmbStripeSession(input.sessionId);
  if (normalized(session.paymentStatus) !== "paid") {
    throw new Error(`Stripe Session ${session.id} ainda não está paga.`);
  }
  if (session.metadata.store && normalized(session.metadata.store) !== normalized("AMB BOUTIQUE")) {
    throw new Error("Stripe Session não pertence à AMB BOUTIQUE.");
  }

  const order = await createAmbOrder(input.storeId, session);
  const warnings: string[] = [];
  let prepared: Awaited<ReturnType<typeof prepareOrderFulfillment>> | null = null;
  let aliExpress: Array<Record<string, unknown>> = [];

  try {
    await refreshOrderSuppliers(order.id);
    prepared = await prepareOrderFulfillment(order.id);
    aliExpress = await autoCreateAliExpressUnpaidOrders(order.id, session.shipping.countryCode);
    if (aliExpress.some((result) => result.ok !== true)) {
      warnings.push("Pedido pago registrado e fulfillment preparado, mas um ou mais lotes ainda exigem ação no AliExpress.");
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Fulfillment automático não pôde ser concluído.");
  }

  return {
    ok: true,
    duplicate: order.duplicate,
    orderId: order.id,
    stripeSessionId: session.id,
    prepared,
    aliExpress,
    warnings,
  };
}

export async function ambInventorySnapshot(storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { connectorCapabilities: true },
  });
  const bridge = parseAmbBridgeConfig(store?.connectorCapabilities);
  if (!bridge) throw new Error("AMB backend bridge não configurado.");
  const sourceIds = [...new Set(Object.values(bridge.products).map((binding) => binding.sourceProductId))];
  const products = await prisma.product.findMany({
    where: { sourceProvider: "ALIEXPRESS", sourceProductId: { in: sourceIds } },
    select: { sourceProductId: true, variants: { select: { attributes: true, stock: true, available: true } } },
  });
  const bySource = new Map(products.map((product) => [product.sourceProductId, product]));

  return Object.entries(bridge.products).map(([slug, binding]) => {
    const product = bySource.get(binding.sourceProductId);
    const variants = (product?.variants || []).filter((variant) => {
      const attributes = record(variant.attributes);
      return normalized(attributes.Color) === normalized(binding.color);
    });
    return {
      slug,
      sourceProductId: binding.sourceProductId,
      supplierColor: binding.color,
      stock: variants.reduce((sum, variant) => sum + Math.max(0, variant.stock), 0),
      available: variants.some((variant) => variant.available && variant.stock > 0),
      sizes: variants.map((variant) => {
        const attributes = record(variant.attributes);
        return { size: text(attributes.Size), stock: Math.max(0, variant.stock), available: variant.available };
      }).filter((variant) => variant.size),
    };
  });
}
