import { prisma } from "./prisma";
import { selectSupplier } from "./supplier-selection";

export type FulfillmentPlanBlocker = {
  code:
    | "ORDER_NOT_FOUND"
    | "PAYMENT_NOT_PAID"
    | "ORDER_NOT_FULFILLABLE"
    | "PRODUCT_MISSING"
    | "CANONICAL_VARIANT_REQUIRED"
    | "SUPPLIER_SELECTION_BLOCKED";
  itemId?: string;
  productId?: string | null;
  detail: string;
};

export type FulfillmentPlanItem = {
  orderItemId: string;
  productId: string;
  canonicalVariantId: string;
  quantity: number;
  title: string;
  supplierProductId: string;
  supplierVariantId: string;
  provider: string;
  sourceProductId: string;
  sourceSkuId: string;
  sourceUrl: string;
  sourceCurrency: string | null;
  sourceUnitCost: number;
  selectionEvidence: {
    role: string;
    priority: number;
    totalSourceCost: number | null;
    minimumRemainingStock: number;
  };
};

export type FulfillmentPlanBatch = {
  supplierProductId: string;
  provider: string;
  sourceProductId: string;
  sourceUrl: string;
  currency: string | null;
  role: string;
  priority: number;
  items: FulfillmentPlanItem[];
};

export type FulfillmentPlan = {
  orderId: string;
  externalOrderId: string | null;
  ready: boolean;
  frozen: boolean;
  requiresReview: boolean;
  blockers: FulfillmentPlanBlocker[];
  batches: FulfillmentPlanBatch[];
};

function reservationMap(rows: Array<{ fulfillmentSupplierVariantId: string | null; quantity: number }>) {
  const result = new Map<string, number>();
  for (const row of rows) {
    if (!row.fulfillmentSupplierVariantId) continue;
    result.set(
      row.fulfillmentSupplierVariantId,
      (result.get(row.fulfillmentSupplierVariantId) || 0) + row.quantity,
    );
  }
  return result;
}

export async function buildOrderFulfillmentPlan(orderId: string): Promise<FulfillmentPlan> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      fulfillmentBatches: {
        include: { items: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!order) {
    return {
      orderId,
      externalOrderId: null,
      ready: false,
      frozen: false,
      requiresReview: false,
      blockers: [{ code: "ORDER_NOT_FOUND", detail: "Pedido não encontrado." }],
      batches: [],
    };
  }

  if (order.fulfillmentStatus !== "UNFULFILLED" && order.fulfillmentBatches.length > 0) {
    const frozenBatches: FulfillmentPlanBatch[] = order.fulfillmentBatches.map((batch) => ({
      supplierProductId: batch.supplierProductId || "snapshot-only",
      provider: batch.provider,
      sourceProductId: batch.sourceProductId,
      sourceUrl: batch.sourceUrl,
      currency: batch.currency,
      role: "FROZEN",
      priority: 0,
      items: batch.items.flatMap((item) => {
        if (
          !item.productId ||
          !item.variantId ||
          !item.fulfillmentSupplierProductId ||
          !item.fulfillmentSupplierVariantId ||
          !item.fulfillmentProvider ||
          !item.fulfillmentSourceProductId ||
          !item.fulfillmentSourceSkuId ||
          !item.fulfillmentSourceUrl ||
          !item.fulfillmentUnitCost
        ) {
          return [];
        }
        return [{
          orderItemId: item.id,
          productId: item.productId,
          canonicalVariantId: item.variantId,
          quantity: item.quantity,
          title: item.titleSnapshot,
          supplierProductId: item.fulfillmentSupplierProductId,
          supplierVariantId: item.fulfillmentSupplierVariantId,
          provider: item.fulfillmentProvider,
          sourceProductId: item.fulfillmentSourceProductId,
          sourceSkuId: item.fulfillmentSourceSkuId,
          sourceUrl: item.fulfillmentSourceUrl,
          sourceCurrency: item.fulfillmentCurrency,
          sourceUnitCost: Number(item.fulfillmentUnitCost.toString()),
          selectionEvidence: {
            role: "FROZEN",
            priority: 0,
            totalSourceCost: null,
            minimumRemainingStock: -1,
          },
        }];
      }),
    }));

    return {
      orderId: order.id,
      externalOrderId: order.externalOrderId,
      ready: frozenBatches.length > 0,
      frozen: true,
      requiresReview: false,
      blockers: [],
      batches: frozenBatches,
    };
  }

  const blockers: FulfillmentPlanBlocker[] = [];
  if (order.paymentStatus !== "PAID") {
    blockers.push({ code: "PAYMENT_NOT_PAID", detail: "Fulfillment só pode ser preparado para pedido pago." });
  }
  if (["CANCELLED", "REFUNDED"].includes(order.status)) {
    blockers.push({ code: "ORDER_NOT_FULFILLABLE", detail: `Pedido está ${order.status}.` });
  }

  const productIds = Array.from(new Set(order.items.flatMap((item) => item.productId ? [item.productId] : [])));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: {
      supplierProducts: {
        include: {
          mappings: { include: { supplierVariant: true } },
        },
      },
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const reservationRows = await prisma.orderItem.findMany({
    where: {
      orderId: { not: order.id },
      fulfillmentSupplierVariantId: { not: null },
      OR: [
        { fulfillmentBatch: { status: { in: ["PROCESSING", "ORDERED"] } } },
        {
          fulfillmentBatchId: null,
          order: {
            paymentStatus: "PAID",
            fulfillmentStatus: "UNFULFILLED",
            status: "PAID",
          },
        },
      ],
    },
    select: { fulfillmentSupplierVariantId: true, quantity: true },
  });
  const reserved = reservationMap(reservationRows);

  const groups = new Map<string, typeof order.items>();
  for (const item of order.items) {
    if (!item.productId || !productById.has(item.productId)) {
      blockers.push({
        code: "PRODUCT_MISSING",
        itemId: item.id,
        productId: item.productId,
        detail: "Produto canônico do item não está mais disponível no Manager.",
      });
      continue;
    }
    if (!item.variantId) {
      blockers.push({
        code: "CANONICAL_VARIANT_REQUIRED",
        itemId: item.id,
        productId: item.productId,
        detail: "Item sem variante canônica não pode usar o Supplier Engine automaticamente.",
      });
      continue;
    }
    const list = groups.get(item.productId) || [];
    list.push(item);
    groups.set(item.productId, list);
  }

  const batches: FulfillmentPlanBatch[] = [];
  let requiresReview = false;

  for (const [productId, items] of groups) {
    const product = productById.get(productId);
    if (!product) continue;

    const quantities = new Map<string, number>();
    for (const item of items) {
      if (!item.variantId) continue;
      quantities.set(item.variantId, (quantities.get(item.variantId) || 0) + item.quantity);
    }

    const selection = selectSupplier({
      requirements: [...quantities.entries()].map(([canonicalVariantId, quantity]) => ({
        canonicalVariantId,
        quantity,
      })),
      suppliers: product.supplierProducts.map((supplier) => ({
        id: supplier.id,
        role: supplier.role,
        priority: supplier.priority,
        status: supplier.status,
        sourceCurrency: supplier.sourceCurrency,
        lastCheckedAt: supplier.lastCheckedAt,
        mappings: supplier.mappings.map((mapping) => ({
          canonicalVariantId: mapping.canonicalVariantId,
          active: mapping.active,
          supplierVariant: {
            id: mapping.supplierVariant.id,
            sourceSkuId: mapping.supplierVariant.sourceSkuId,
            sourcePrice: mapping.supplierVariant.sourcePrice
              ? Number(mapping.supplierVariant.sourcePrice.toString())
              : null,
            stock: Math.max(
              0,
              mapping.supplierVariant.stock - (reserved.get(mapping.supplierVariant.id) || 0),
            ),
          },
        })),
      })),
    });

    requiresReview ||= selection.requiresReview;
    if (!selection.selected) {
      blockers.push({
        code: "SUPPLIER_SELECTION_BLOCKED",
        productId,
        detail: selection.blocker || "Nenhum fornecedor seguro foi selecionado.",
      });
      continue;
    }

    const supplier = product.supplierProducts.find((candidate) => candidate.id === selection.selected?.supplierId);
    if (!supplier) {
      blockers.push({
        code: "SUPPLIER_SELECTION_BLOCKED",
        productId,
        detail: "Fornecedor selecionado deixou de existir durante o planejamento.",
      });
      continue;
    }

    const resolvedByCanonical = new Map(
      selection.selected.resolved.map((item) => [item.canonicalVariantId, item]),
    );
    const planItems: FulfillmentPlanItem[] = [];

    for (const item of items) {
      if (!item.variantId) continue;
      const resolved = resolvedByCanonical.get(item.variantId);
      if (!resolved) {
        blockers.push({
          code: "SUPPLIER_SELECTION_BLOCKED",
          itemId: item.id,
          productId,
          detail: "A variante do item não recebeu um SKU do fornecedor selecionado.",
        });
        continue;
      }

      planItems.push({
        orderItemId: item.id,
        productId,
        canonicalVariantId: item.variantId,
        quantity: item.quantity,
        title: item.titleSnapshot,
        supplierProductId: supplier.id,
        supplierVariantId: resolved.supplierVariantId,
        provider: supplier.provider,
        sourceProductId: supplier.sourceProductId,
        sourceSkuId: resolved.sourceSkuId,
        sourceUrl: supplier.sourceUrl,
        sourceCurrency: supplier.sourceCurrency,
        sourceUnitCost: resolved.sourcePrice,
        selectionEvidence: {
          role: selection.selected.role,
          priority: selection.selected.priority,
          totalSourceCost: selection.selected.totalSourceCost,
          minimumRemainingStock: selection.selected.minimumRemainingStock,
        },
      });
    }

    batches.push({
      supplierProductId: supplier.id,
      provider: supplier.provider,
      sourceProductId: supplier.sourceProductId,
      sourceUrl: supplier.sourceUrl,
      currency: supplier.sourceCurrency,
      role: selection.selected.role,
      priority: selection.selected.priority,
      items: planItems,
    });
  }

  return {
    orderId: order.id,
    externalOrderId: order.externalOrderId,
    ready: blockers.length === 0 && batches.length > 0,
    frozen: false,
    requiresReview,
    blockers,
    batches: blockers.length === 0 ? batches : [],
  };
}

async function prepareOnce(orderId: string, plan: FulfillmentPlan) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.order.updateMany({
      where: {
        id: orderId,
        paymentStatus: "PAID",
        fulfillmentStatus: "UNFULFILLED",
        status: "PAID",
      },
      data: {
        status: "PROCESSING",
        fulfillmentStatus: "PROCESSING",
      },
    });

    if (locked.count !== 1) {
      throw new Error("Pedido mudou de estado enquanto o fulfillment era preparado.");
    }

    const preparedAt = new Date();

    for (const batchPlan of plan.batches) {
      const currentSupplier = await tx.supplierProduct.findUnique({
        where: { id: batchPlan.supplierProductId },
        select: { id: true, status: true, provider: true, sourceProductId: true, sourceUrl: true, sourceCurrency: true },
      });
      if (!currentSupplier || currentSupplier.status !== "ACTIVE") {
        throw new Error(`Fornecedor ${batchPlan.supplierProductId} deixou de estar ativo.`);
      }

      const quantities = new Map<string, number>();
      for (const item of batchPlan.items) {
        quantities.set(item.supplierVariantId, (quantities.get(item.supplierVariantId) || 0) + item.quantity);
      }

      const currentVariants = await tx.supplierVariant.findMany({
        where: {
          id: { in: [...quantities.keys()] },
          supplierProductId: currentSupplier.id,
        },
        select: { id: true, sourceSkuId: true, sourcePrice: true, stock: true },
      });
      const currentById = new Map(currentVariants.map((variant) => [variant.id, variant]));

      const otherReservations = await tx.orderItem.findMany({
        where: {
          orderId: { not: orderId },
          fulfillmentSupplierVariantId: { in: [...quantities.keys()] },
          OR: [
            { fulfillmentBatch: { status: { in: ["PROCESSING", "ORDERED"] } } },
            {
              fulfillmentBatchId: null,
              order: {
                paymentStatus: "PAID",
                fulfillmentStatus: "UNFULFILLED",
                status: "PAID",
              },
            },
          ],
        },
        select: { fulfillmentSupplierVariantId: true, quantity: true },
      });
      const reserved = reservationMap(otherReservations);

      for (const [supplierVariantId, quantity] of quantities) {
        const current = currentById.get(supplierVariantId);
        if (!current || !current.sourcePrice) {
          throw new Error(`SKU ${supplierVariantId} deixou de possuir custo válido.`);
        }
        const safeAvailable = Math.max(0, current.stock - (reserved.get(supplierVariantId) || 0));
        if (safeAvailable < quantity) {
          throw new Error(`SKU ${current.sourceSkuId} não possui mais estoque seguro para este pedido.`);
        }
      }

      const canonicalVariantIds = batchPlan.items.map((item) => item.canonicalVariantId);
      const mappings = await tx.supplierVariantMapping.findMany({
        where: {
          supplierProductId: currentSupplier.id,
          canonicalVariantId: { in: canonicalVariantIds },
          active: true,
        },
        select: { canonicalVariantId: true, supplierVariantId: true },
      });
      const mappingByCanonical = new Map(mappings.map((mapping) => [mapping.canonicalVariantId, mapping.supplierVariantId]));
      for (const item of batchPlan.items) {
        if (mappingByCanonical.get(item.canonicalVariantId) !== item.supplierVariantId) {
          throw new Error(`Mapping da variante ${item.canonicalVariantId} mudou antes da preparação.`);
        }
      }

      const batch = await tx.fulfillmentBatch.create({
        data: {
          orderId,
          supplierProductId: currentSupplier.id,
          provider: currentSupplier.provider,
          sourceProductId: currentSupplier.sourceProductId,
          sourceUrl: currentSupplier.sourceUrl,
          currency: currentSupplier.sourceCurrency,
          status: "PROCESSING",
        },
        select: { id: true },
      });

      for (const item of batchPlan.items) {
        const currentVariant = currentById.get(item.supplierVariantId);
        if (!currentVariant?.sourcePrice) throw new Error("Custo do SKU indisponível.");
        await tx.orderItem.update({
          where: { id: item.orderItemId },
          data: {
            fulfillmentBatchId: batch.id,
            fulfillmentSupplierProductId: currentSupplier.id,
            fulfillmentSupplierVariantId: currentVariant.id,
            fulfillmentProvider: currentSupplier.provider,
            fulfillmentSourceProductId: currentSupplier.sourceProductId,
            fulfillmentSourceSkuId: currentVariant.sourceSkuId,
            fulfillmentSourceUrl: currentSupplier.sourceUrl,
            fulfillmentUnitCost: currentVariant.sourcePrice,
            fulfillmentCurrency: currentSupplier.sourceCurrency,
            fulfillmentSelectionMethod: "SUPPLIER_POLICY_V1",
            fulfillmentSelectionEvidence: item.selectionEvidence,
            supplierSelectedAt: preparedAt,
            fulfillmentPreparedAt: preparedAt,
          },
        });
      }
    }

    return tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        fulfillmentBatches: { include: { items: true } },
      },
    });
  }, { isolationLevel: "Serializable" });
}

export async function prepareOrderFulfillment(orderId: string) {
  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    include: { fulfillmentBatches: true },
  });
  if (!existing) throw new Error("Pedido não encontrado.");
  if (existing.fulfillmentStatus !== "UNFULFILLED") {
    if (existing.fulfillmentBatches.length > 0) {
      return { idempotent: true, orderId, batches: existing.fulfillmentBatches.length };
    }
    throw new Error("Pedido já está em outro estado de fulfillment.");
  }

  const plan = await buildOrderFulfillmentPlan(orderId);
  if (!plan.ready || plan.requiresReview) {
    throw new Error(
      plan.blockers.map((blocker) => blocker.detail).join(" | ") ||
      "Plano de fulfillment não está pronto para confirmação automática.",
    );
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const prepared = await prepareOnce(orderId, plan);
      return {
        idempotent: false,
        orderId,
        batches: prepared.fulfillmentBatches.length,
      };
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code;
      if (code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha ao preparar fulfillment.");
}

export async function getOrderFulfillmentPackage(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      shippingAddress: true,
      fulfillmentBatches: {
        include: {
          items: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!order) throw new Error("Pedido não encontrado.");
  if (!order.shippingAddress) throw new Error("Pedido não possui endereço de entrega.");
  if (order.fulfillmentBatches.length === 0) throw new Error("Fulfillment ainda não foi preparado.");

  return {
    orderId: order.id,
    externalOrderId: order.externalOrderId,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
    customer: {
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
    },
    shippingAddress: {
      recipient: order.shippingAddress.recipient,
      line1: order.shippingAddress.line1,
      line2: order.shippingAddress.line2,
      number: order.shippingAddress.number,
      district: order.shippingAddress.district,
      city: order.shippingAddress.city,
      state: order.shippingAddress.state,
      postalCode: order.shippingAddress.postalCode,
      countryCode: order.shippingAddress.countryCode,
      instructions: order.shippingAddress.instructions,
    },
    batches: order.fulfillmentBatches.map((batch) => ({
      batchId: batch.id,
      provider: batch.provider,
      sourceProductId: batch.sourceProductId,
      sourceUrl: batch.sourceUrl,
      currency: batch.currency,
      status: batch.status,
      externalOrderId: batch.externalOrderId,
      carrier: batch.carrier,
      trackingCode: batch.trackingCode,
      trackingUrl: batch.trackingUrl,
      items: batch.items.map((item) => ({
        orderItemId: item.id,
        title: item.titleSnapshot,
        sourceSkuId: item.fulfillmentSourceSkuId,
        quantity: item.quantity,
        unitCost: item.fulfillmentUnitCost?.toString() || null,
        currency: item.fulfillmentCurrency,
      })),
    })),
  };
}
