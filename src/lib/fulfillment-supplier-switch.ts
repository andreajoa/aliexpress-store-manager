import { randomUUID } from "node:crypto";

import { prisma } from "./prisma";
import { selectSupplier } from "./supplier-selection";
import { syncCanonicalAvailability } from "./supplier-refresh-service";

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

async function loadSwitchContext(orderId: string, batchId: string) {
  const batch = await prisma.fulfillmentBatch.findFirst({
    where: { id: batchId, orderId },
    include: {
      order: { select: { storeId: true } },
      items: {
        select: {
          id: true,
          productId: true,
          variantId: true,
          quantity: true,
          fulfillmentSupplierVariantId: true,
        },
      },
    },
  });

  if (!batch) throw new Error("Lote de fulfillment não encontrado.");
  if (batch.status !== "PROCESSING" || batch.externalOrderId) {
    throw new Error("Fornecedor só pode ser trocado antes de registrar a compra externa.");
  }
  if (batch.items.length === 0) throw new Error("Lote não possui itens.");

  const productIds = new Set(batch.items.flatMap((item) => item.productId ? [item.productId] : []));
  if (productIds.size !== 1) {
    throw new Error("Lote com mais de um produto canônico exige revisão manual.");
  }
  const productId = [...productIds][0];
  const requirements = new Map<string, number>();
  for (const item of batch.items) {
    if (!item.variantId) throw new Error("Item sem variante canônica não pode trocar fornecedor automaticamente.");
    requirements.set(item.variantId, (requirements.get(item.variantId) || 0) + item.quantity);
  }

  const [product, reservationRows] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      include: {
        supplierProducts: {
          include: {
            mappings: { include: { supplierVariant: true } },
          },
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
    prisma.orderItem.findMany({
      where: {
        fulfillmentBatchId: { not: batch.id },
        fulfillmentSupplierVariantId: { not: null },
        fulfillmentBatch: { status: { in: ["PROCESSING", "ORDERED"] } },
      },
      select: { fulfillmentSupplierVariantId: true, quantity: true },
    }),
  ]);

  if (!product) throw new Error("Produto canônico do lote não foi encontrado.");
  const reserved = reservationMap(reservationRows);

  const suppliers = product.supplierProducts
    .filter((supplier) => supplier.id !== batch.supplierProductId)
    .map((supplier) => ({
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
    }));

  return {
    batch,
    product,
    productId,
    requirements: [...requirements.entries()].map(([canonicalVariantId, quantity]) => ({
      canonicalVariantId,
      quantity,
    })),
    suppliers,
  };
}

export async function getFulfillmentSupplierSwitchCandidates(orderId: string, batchId: string) {
  const context = await loadSwitchContext(orderId, batchId);
  const recommendation = selectSupplier({
    requirements: context.requirements,
    suppliers: context.suppliers,
  });

  const candidates = context.suppliers.map((supplier) => {
    const evaluation = selectSupplier({
      requirements: context.requirements,
      suppliers: [supplier],
    });
    const dbSupplier = context.product.supplierProducts.find((item) => item.id === supplier.id);
    return {
      supplierId: supplier.id,
      sellerName: dbSupplier?.sellerName || null,
      sourceProductId: dbSupplier?.sourceProductId || null,
      sourceUrl: dbSupplier?.sourceUrl || null,
      role: supplier.role,
      priority: supplier.priority,
      currency: supplier.sourceCurrency,
      eligible: Boolean(evaluation.selected),
      totalSourceCost: evaluation.selected?.totalSourceCost ?? null,
      issues: evaluation.candidates[0]?.issues || [],
    };
  });

  return {
    orderId,
    batchId,
    currentSupplierProductId: context.batch.supplierProductId,
    recommendedSupplierProductId: recommendation.selected?.supplierId || null,
    requiresReview: recommendation.requiresReview,
    blocker: recommendation.blocker,
    candidates,
  };
}

async function switchOnce(input: {
  orderId: string;
  batchId: string;
  targetSupplierProductId: string;
  reason: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.fulfillmentBatch.findFirst({
      where: { id: input.batchId, orderId: input.orderId },
      include: {
        order: { select: { storeId: true } },
        items: true,
      },
    });
    if (!batch) throw new Error("Lote de fulfillment não encontrado.");
    if (batch.status !== "PROCESSING" || batch.externalOrderId) {
      throw new Error("Fornecedor só pode ser trocado antes de registrar a compra externa.");
    }
    if (batch.supplierProductId === input.targetSupplierProductId) {
      throw new Error("O fornecedor selecionado já é o fornecedor atual do lote.");
    }

    const productIds = new Set(batch.items.flatMap((item) => item.productId ? [item.productId] : []));
    if (productIds.size !== 1) throw new Error("Lote incompatível com troca automática.");
    const productId = [...productIds][0];

    const target = await tx.supplierProduct.findFirst({
      where: {
        id: input.targetSupplierProductId,
        productId,
        status: "ACTIVE",
      },
      include: {
        mappings: { include: { supplierVariant: true } },
      },
    });
    if (!target) throw new Error("Fornecedor alternativo ativo não encontrado para este produto.");

    const requirements = new Map<string, number>();
    for (const item of batch.items) {
      if (!item.variantId) throw new Error("Item sem variante canônica.");
      requirements.set(item.variantId, (requirements.get(item.variantId) || 0) + item.quantity);
    }

    const reservationRows = await tx.orderItem.findMany({
      where: {
        fulfillmentBatchId: { not: batch.id },
        fulfillmentSupplierVariantId: { not: null },
        fulfillmentBatch: { status: { in: ["PROCESSING", "ORDERED"] } },
      },
      select: { fulfillmentSupplierVariantId: true, quantity: true },
    });
    const reserved = reservationMap(reservationRows);

    const evaluation = selectSupplier({
      requirements: [...requirements.entries()].map(([canonicalVariantId, quantity]) => ({
        canonicalVariantId,
        quantity,
      })),
      suppliers: [{
        id: target.id,
        role: target.role,
        priority: target.priority,
        status: target.status,
        sourceCurrency: target.sourceCurrency,
        lastCheckedAt: target.lastCheckedAt,
        mappings: target.mappings.map((mapping) => ({
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
      }],
    });
    if (!evaluation.selected || evaluation.requiresReview) {
      throw new Error(
        evaluation.blocker ||
        evaluation.candidates[0]?.issues.map((issue) => issue.detail).join(" | ") ||
        "Fornecedor alternativo não está elegível.",
      );
    }

    const resolvedByCanonical = new Map(
      evaluation.selected.resolved.map((item) => [item.canonicalVariantId, item]),
    );
    const switchedAt = new Date();
    const fromSupplierProductId = batch.supplierProductId;
    const itemAudit: Array<{
      orderItemId: string;
      canonicalVariantId: string;
      fromSupplierVariantId: string | null;
      toSupplierVariantId: string;
      toSourceSkuId: string;
    }> = [];

    for (const item of batch.items) {
      if (!item.variantId) throw new Error("Item sem variante canônica.");
      const resolved = resolvedByCanonical.get(item.variantId);
      if (!resolved) throw new Error(`Variante ${item.variantId} não foi resolvida no novo fornecedor.`);
      itemAudit.push({
        orderItemId: item.id,
        canonicalVariantId: item.variantId,
        fromSupplierVariantId: item.fulfillmentSupplierVariantId,
        toSupplierVariantId: resolved.supplierVariantId,
        toSourceSkuId: resolved.sourceSkuId,
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          fulfillmentSupplierProductId: target.id,
          fulfillmentSupplierVariantId: resolved.supplierVariantId,
          fulfillmentProvider: target.provider,
          fulfillmentSourceProductId: target.sourceProductId,
          fulfillmentSourceSkuId: resolved.sourceSkuId,
          fulfillmentSourceUrl: target.sourceUrl,
          fulfillmentUnitCost: resolved.sourcePrice,
          fulfillmentCurrency: target.sourceCurrency,
          fulfillmentSelectionMethod: "SUPPLIER_SWITCH_V1",
          fulfillmentSelectionEvidence: {
            fromSupplierProductId,
            toSupplierProductId: target.id,
            role: target.role,
            priority: target.priority,
            totalSourceCost: evaluation.selected.totalSourceCost,
            reason: input.reason,
          },
          supplierSelectedAt: switchedAt,
        },
      });
    }

    await tx.fulfillmentBatch.update({
      where: { id: batch.id },
      data: {
        supplierProductId: target.id,
        provider: target.provider,
        sourceProductId: target.sourceProductId,
        sourceUrl: target.sourceUrl,
        currency: target.sourceCurrency,
      },
    });

    await tx.integrationEvent.create({
      data: {
        storeId: batch.order.storeId,
        externalEventId: `supplier-switch:${batch.id}:${randomUUID()}`,
        eventType: "fulfillment.supplier_switched",
        status: "PROCESSED",
        payload: {
          orderId: batch.orderId,
          batchId: batch.id,
          productId,
          fromSupplierProductId,
          toSupplierProductId: target.id,
          reason: input.reason,
          items: itemAudit,
        },
        processedAt: switchedAt,
      },
    });

    return {
      productId,
      fromSupplierProductId,
      toSupplierProductId: target.id,
      switchedAt,
    };
  }, { isolationLevel: "Serializable" });
}

export async function switchFulfillmentSupplier(input: {
  orderId: string;
  batchId: string;
  targetSupplierProductId: string;
  reason?: string | null;
}) {
  const candidates = await getFulfillmentSupplierSwitchCandidates(input.orderId, input.batchId);
  const candidate = candidates.candidates.find(
    (item) => item.supplierId === input.targetSupplierProductId,
  );
  if (!candidate) throw new Error("Fornecedor escolhido não pertence às alternativas deste lote.");
  if (!candidate.eligible) {
    throw new Error(candidate.issues.map((issue) => issue.detail).join(" | ") || "Fornecedor escolhido não está elegível.");
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await switchOnce({
        ...input,
        reason: input.reason?.trim().slice(0, 500) || null,
      });
      const syncWarnings: string[] = [];
      try {
        await syncCanonicalAvailability(result.productId);
      } catch (error) {
        syncWarnings.push(error instanceof Error ? error.message : "Falha ao recalcular disponibilidade.");
      }
      return { ...result, syncWarnings };
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code;
      if (code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha ao trocar fornecedor.");
}
