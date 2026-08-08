import { prisma } from "./prisma";
import { canonicalSourceSkuFromExternalVariantId } from "./order-item-resolver";
import { selectSupplier } from "./supplier-selection";
import { syncCanonicalAvailability } from "./supplier-refresh-service";

export type CheckoutReservationItemInput = {
  externalProductId: string;
  externalVariantId: string;
  quantity: number;
};

export class InventoryReservationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 409,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function aggregateItems(items: CheckoutReservationItemInput[]) {
  const map = new Map<string, CheckoutReservationItemInput>();
  for (const item of items) {
    const externalProductId = item.externalProductId.trim();
    const externalVariantId = item.externalVariantId.trim();
    if (!externalProductId || !externalVariantId || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 100) {
      throw new InventoryReservationError("Item de reserva inválido.", "RESERVATION_ITEM_INVALID", 400);
    }
    const key = `${externalProductId}\u0000${externalVariantId}`;
    const existing = map.get(key);
    if (existing) existing.quantity += item.quantity;
    else map.set(key, { externalProductId, externalVariantId, quantity: item.quantity });
  }
  return [...map.values()];
}

function reservationMap(rows: Array<{ supplierVariantId: string; quantity: number }>) {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.supplierVariantId, (map.get(row.supplierVariantId) || 0) + row.quantity);
  }
  return map;
}

function mergeReserved(target: Map<string, number>, source: Map<string, number>) {
  for (const [key, value] of source) target.set(key, (target.get(key) || 0) + value);
}

function serializeReservation(reservation: {
  id: string;
  externalReservationId: string;
  status: string;
  expiresAt: Date;
  items: Array<{
    productId: string;
    canonicalVariantId: string;
    supplierProductId: string;
    supplierVariantId: string;
    quantity: number;
    sourceCurrency: string | null;
    sourceUnitCost: unknown;
  }>;
}) {
  return {
    id: reservation.id,
    externalReservationId: reservation.externalReservationId,
    status: reservation.status,
    expiresAt: reservation.expiresAt.toISOString(),
    items: reservation.items.map((item) => ({
      productId: item.productId,
      canonicalVariantId: item.canonicalVariantId,
      supplierProductId: item.supplierProductId,
      supplierVariantId: item.supplierVariantId,
      quantity: item.quantity,
      sourceCurrency: item.sourceCurrency,
      sourceUnitCost: item.sourceUnitCost == null ? null : Number(String(item.sourceUnitCost)),
    })),
  };
}

export async function reserveCheckoutInventory(input: {
  storeId: string;
  externalReservationId: string;
  items: CheckoutReservationItemInput[];
  ttlMinutes?: number;
}) {
  const externalReservationId = input.externalReservationId.trim();
  if (!externalReservationId || externalReservationId.length > 255) {
    throw new InventoryReservationError("reservationId inválido.", "RESERVATION_ID_INVALID", 400);
  }
  const requested = aggregateItems(input.items);
  if (requested.length === 0 || requested.length > 50) {
    throw new InventoryReservationError("A reserva precisa conter de 1 a 50 itens.", "RESERVATION_ITEMS_INVALID", 400);
  }
  const ttlMinutes = Math.max(15, Math.min(30, input.ttlMinutes ?? 30));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.inventoryReservation.updateMany({
      where: { status: "ACTIVE", expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });

    // Serialize competing checkouts for the same commercial variants.
    const locks = requested
      .map((item) => `${input.storeId}:${item.externalProductId}:${item.externalVariantId}`)
      .sort();
    for (const lockKey of locks) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    }

    const externalProductIds = [...new Set(requested.map((item) => item.externalProductId))];
    const publications = await tx.publication.findMany({
      where: {
        storeId: input.storeId,
        status: "PUBLISHED",
        externalProductId: { in: externalProductIds },
      },
      include: {
        product: {
          include: {
            variants: true,
            supplierProducts: {
              include: { mappings: { include: { supplierVariant: true } } },
            },
          },
        },
      },
    });
    const byExternalProduct = new Map(
      publications.flatMap((publication) => publication.externalProductId
        ? [[publication.externalProductId, publication] as const]
        : []),
    );

    const resolved = requested.map((item) => {
      const publication = byExternalProduct.get(item.externalProductId);
      if (!publication) {
        throw new InventoryReservationError(
          `Produto ${item.externalProductId} não está publicado nesta loja.`,
          "PRODUCT_NOT_PUBLISHED",
          409,
        );
      }
      const sourceSkuId = canonicalSourceSkuFromExternalVariantId(item.externalVariantId);
      if (!sourceSkuId) {
        throw new InventoryReservationError("Variante obrigatória para reserva.", "VARIANT_REQUIRED", 409);
      }
      const variant = publication.product.variants.find((candidate) => candidate.sourceSkuId === sourceSkuId);
      if (!variant) {
        throw new InventoryReservationError(
          `Variante ${item.externalVariantId} não corresponde ao catálogo canônico.`,
          "VARIANT_NOT_FOUND",
          409,
        );
      }
      return {
        ...item,
        productId: publication.product.id,
        canonicalVariantId: variant.id,
        supplierProducts: publication.product.supplierProducts,
      };
    });

    const existing = await tx.inventoryReservation.findUnique({
      where: {
        storeId_externalReservationId: {
          storeId: input.storeId,
          externalReservationId,
        },
      },
      include: { items: true },
    });
    if (existing) {
      if (existing.status !== "ACTIVE" || existing.expiresAt <= now) {
        throw new InventoryReservationError(
          "Esta reservationId já foi finalizada ou expirou. Gere uma nova reserva.",
          "RESERVATION_NOT_ACTIVE",
          409,
        );
      }
      const expected = new Map(resolved.map((item) => [item.canonicalVariantId, item.quantity]));
      const same = existing.items.length === expected.size && existing.items.every(
        (item) => expected.get(item.canonicalVariantId) === item.quantity,
      );
      if (!same) {
        throw new InventoryReservationError(
          "A mesma reservationId foi reutilizada com um carrinho diferente.",
          "RESERVATION_ID_REUSED",
          409,
        );
      }
      return { reservation: existing, idempotent: true };
    }

    const supplierVariantIds = [...new Set(
      resolved.flatMap((item) => item.supplierProducts.flatMap((supplier) =>
        supplier.mappings.map((mapping) => mapping.supplierVariant.id),
      )),
    )];

    const [fulfillmentRows, checkoutRows] = await Promise.all([
      tx.orderItem.findMany({
        where: {
          fulfillmentSupplierVariantId: { in: supplierVariantIds },
          fulfillmentBatch: { status: { in: ["PROCESSING", "ORDERED"] } },
        },
        select: { fulfillmentSupplierVariantId: true, quantity: true },
      }),
      tx.inventoryReservationItem.findMany({
        where: {
          supplierVariantId: { in: supplierVariantIds },
          reservation: { status: "ACTIVE", expiresAt: { gt: now } },
        },
        select: { supplierVariantId: true, quantity: true },
      }),
    ]);
    const reserved = reservationMap(
      fulfillmentRows.flatMap((row) => row.fulfillmentSupplierVariantId
        ? [{ supplierVariantId: row.fulfillmentSupplierVariantId, quantity: row.quantity }]
        : []),
    );
    mergeReserved(reserved, reservationMap(checkoutRows));

    const groups = new Map<string, typeof resolved>();
    for (const item of resolved) {
      const list = groups.get(item.productId) || [];
      list.push(item);
      groups.set(item.productId, list);
    }

    const plannedItems: Array<{
      productId: string;
      canonicalVariantId: string;
      supplierProductId: string;
      supplierVariantId: string;
      quantity: number;
      sourceCurrency: string | null;
      sourceUnitCost: number;
    }> = [];

    for (const [productId, items] of groups) {
      const product = items[0];
      const requirements = items.map((item) => ({
        canonicalVariantId: item.canonicalVariantId,
        quantity: item.quantity,
      }));
      const selection = selectSupplier({
        requirements,
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
              sourcePrice: mapping.supplierVariant.sourcePrice == null
                ? null
                : Number(mapping.supplierVariant.sourcePrice.toString()),
              stock: Math.max(
                0,
                mapping.supplierVariant.stock - (reserved.get(mapping.supplierVariant.id) || 0),
              ),
            },
          })),
        })),
      });
      if (!selection.selected || selection.requiresReview) {
        throw new InventoryReservationError(
          selection.blocker || `Estoque seguro indisponível para o produto ${productId}.`,
          "SUPPLIER_SELECTION_BLOCKED",
          409,
          selection.candidates,
        );
      }
      const selectedSupplier = product.supplierProducts.find((supplier) => supplier.id === selection.selected!.supplierId);
      if (!selectedSupplier) {
        throw new InventoryReservationError("Fornecedor selecionado deixou de existir.", "SUPPLIER_MISSING", 409);
      }
      const resolvedByCanonical = new Map(selection.selected.resolved.map((item) => [item.canonicalVariantId, item]));
      for (const item of items) {
        const selectedVariant = resolvedByCanonical.get(item.canonicalVariantId);
        if (!selectedVariant) {
          throw new InventoryReservationError("SKU do fornecedor não resolvido.", "SUPPLIER_VARIANT_MISSING", 409);
        }
        plannedItems.push({
          productId,
          canonicalVariantId: item.canonicalVariantId,
          supplierProductId: selectedSupplier.id,
          supplierVariantId: selectedVariant.supplierVariantId,
          quantity: item.quantity,
          sourceCurrency: selectedSupplier.sourceCurrency,
          sourceUnitCost: selectedVariant.sourcePrice,
        });
      }
    }

    const reservation = await tx.inventoryReservation.create({
      data: {
        storeId: input.storeId,
        externalReservationId,
        status: "ACTIVE",
        expiresAt,
        items: {
          create: plannedItems,
        },
      },
      include: { items: true },
    });
    return { reservation, idempotent: false };
  }, { isolationLevel: "Serializable" });

  const productIds = [...new Set(outcome.reservation.items.map((item) => item.productId))];
  await Promise.all(productIds.map((productId) => syncCanonicalAvailability(productId)));

  return {
    idempotent: outcome.idempotent,
    reservation: serializeReservation(outcome.reservation),
  };
}

export async function releaseCheckoutReservation(input: {
  storeId: string;
  externalReservationId: string;
}) {
  const reservation = await prisma.inventoryReservation.findUnique({
    where: {
      storeId_externalReservationId: {
        storeId: input.storeId,
        externalReservationId: input.externalReservationId.trim(),
      },
    },
    include: { items: true },
  });
  if (!reservation) return { released: false, missing: true };
  if (reservation.status === "CONSUMED") {
    throw new InventoryReservationError("Reserva já foi consumida por um pedido pago.", "RESERVATION_CONSUMED", 409);
  }
  if (reservation.status === "ACTIVE") {
    await prisma.inventoryReservation.update({
      where: { id: reservation.id },
      data: { status: "RELEASED" },
    });
  }
  const productIds = [...new Set(reservation.items.map((item) => item.productId))];
  await Promise.all(productIds.map((productId) => syncCanonicalAvailability(productId)));
  return { released: true, missing: false };
}

export async function expireCheckoutReservations() {
  const now = new Date();
  const expired = await prisma.inventoryReservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    select: { id: true, items: { select: { productId: true } } },
  });
  if (!expired.length) return { expired: 0 };
  await prisma.inventoryReservation.updateMany({
    where: { id: { in: expired.map((item) => item.id) }, status: "ACTIVE" },
    data: { status: "EXPIRED" },
  });
  const productIds = [...new Set(expired.flatMap((item) => item.items.map((row) => row.productId)))];
  await Promise.all(productIds.map((productId) => syncCanonicalAvailability(productId)));
  return { expired: expired.length };
}
