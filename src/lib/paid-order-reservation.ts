import { prisma } from "./prisma";
import {
  checkoutDeadlineFromHoldExpiry,
  matchReservationToPaidOrder,
} from "./inventory-reservation-match";
import type { ResolvedOrderItem } from "./order-item-resolver";

export type PaidOrderReservationSnapshot = {
  reservationId: string;
  valid: boolean;
  issues: string[];
  itemsByCanonicalVariant: Map<string, {
    reservationItemId: string;
    productId: string;
    canonicalVariantId: string;
    supplierProductId: string;
    supplierVariantId: string;
    quantity: number;
    sourceCurrency: string | null;
    sourceUnitCost: number | null;
    provider: string;
    sourceProductId: string;
    sourceUrl: string;
    sourceSkuId: string;
  }>;
};

export async function loadPaidOrderReservation(input: {
  storeId: string;
  reservationId: string | null | undefined;
  occurredAt: Date;
  resolvedItems: ResolvedOrderItem[];
}): Promise<PaidOrderReservationSnapshot | null> {
  const reservationId = input.reservationId?.trim();
  if (!reservationId) return null;

  const reservation = await prisma.inventoryReservation.findUnique({
    where: {
      storeId_externalReservationId: {
        storeId: input.storeId,
        externalReservationId: reservationId,
      },
    },
    include: {
      items: {
        include: {
          supplierProduct: {
            select: {
              provider: true,
              sourceProductId: true,
              sourceUrl: true,
              sourceCurrency: true,
            },
          },
          supplierVariant: {
            select: { sourceSkuId: true },
          },
        },
      },
    },
  });

  if (!reservation) {
    return {
      reservationId,
      valid: false,
      issues: ["Reserva informada pelo checkout não existe no Store Manager."],
      itemsByCanonicalVariant: new Map(),
    };
  }

  const issues: string[] = [];
  const checkoutDeadline = checkoutDeadlineFromHoldExpiry(reservation.expiresAt);
  if (input.occurredAt.getTime() > checkoutDeadline.getTime()) {
    issues.push("Pagamento ocorreu depois do prazo do checkout reservado.");
  }
  if (reservation.status !== "ACTIVE") {
    issues.push(`Reserva está ${reservation.status}, não ACTIVE.`);
  }
  if (reservation.expiresAt.getTime() <= Date.now()) {
    issues.push("Janela de segurança da reserva já expirou antes do processamento do webhook.");
  }

  const match = matchReservationToPaidOrder({
    reservationItems: reservation.items.map((item) => ({
      canonicalVariantId: item.canonicalVariantId,
      quantity: item.quantity,
    })),
    resolvedOrderItems: input.resolvedItems.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
    })),
  });
  issues.push(...match.issues);

  const itemsByCanonicalVariant = new Map(
    reservation.items.map((item) => [
      item.canonicalVariantId,
      {
        reservationItemId: item.id,
        productId: item.productId,
        canonicalVariantId: item.canonicalVariantId,
        supplierProductId: item.supplierProductId,
        supplierVariantId: item.supplierVariantId,
        quantity: item.quantity,
        sourceCurrency: item.sourceCurrency || item.supplierProduct.sourceCurrency,
        sourceUnitCost: item.sourceUnitCost == null ? null : Number(item.sourceUnitCost.toString()),
        provider: item.supplierProduct.provider,
        sourceProductId: item.supplierProduct.sourceProductId,
        sourceUrl: item.supplierProduct.sourceUrl,
        sourceSkuId: item.supplierVariant.sourceSkuId,
      },
    ]),
  );

  return {
    reservationId,
    valid: issues.length === 0,
    issues,
    itemsByCanonicalVariant,
  };
}
