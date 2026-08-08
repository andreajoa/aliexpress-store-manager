export type ReservedCanonicalItem = {
  canonicalVariantId: string;
  quantity: number;
};

export type PaidResolvedCanonicalItem = {
  variantId: string | null;
  quantity: number;
};

function aggregateReserved(items: ReservedCanonicalItem[]) {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item.canonicalVariantId, (map.get(item.canonicalVariantId) || 0) + item.quantity);
  }
  return map;
}

function aggregateResolved(items: PaidResolvedCanonicalItem[]) {
  const map = new Map<string, number>();
  const missingVariant = items.some((item) => !item.variantId);
  if (missingVariant) return { map, missingVariant: true };
  for (const item of items) {
    const variantId = item.variantId!;
    map.set(variantId, (map.get(variantId) || 0) + item.quantity);
  }
  return { map, missingVariant: false };
}

export function matchReservationToPaidOrder(input: {
  reservationItems: ReservedCanonicalItem[];
  resolvedOrderItems: PaidResolvedCanonicalItem[];
}) {
  const reserved = aggregateReserved(input.reservationItems);
  const resolved = aggregateResolved(input.resolvedOrderItems);
  const issues: string[] = [];

  if (resolved.missingVariant) {
    issues.push("Pedido pago possui item sem variante canônica, mas a reserva de estoque é por variante.");
  }

  if (reserved.size !== resolved.map.size) {
    issues.push("Quantidade de variantes da reserva não corresponde ao pedido pago.");
  }

  for (const [variantId, quantity] of reserved) {
    const paidQuantity = resolved.map.get(variantId);
    if (paidQuantity !== quantity) {
      issues.push(`Variante ${variantId}: reservado ${quantity}, pago ${paidQuantity ?? 0}.`);
    }
  }

  for (const variantId of resolved.map.keys()) {
    if (!reserved.has(variantId)) {
      issues.push(`Variante ${variantId} foi paga sem estar na reserva.`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function checkoutDeadlineFromHoldExpiry(holdExpiresAt: Date, graceMinutes = 10) {
  return new Date(holdExpiresAt.getTime() - Math.max(0, graceMinutes) * 60_000);
}
