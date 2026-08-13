import {
  checkoutDeadlineFromHoldExpiry,
  matchReservationToPaidOrder,
} from "../src/lib/inventory-reservation-match.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("=== EXACT MATCH ===");
const exact = matchReservationToPaidOrder({
  reservationItems: [
    { canonicalVariantId: "variant-a", quantity: 2 },
    { canonicalVariantId: "variant-b", quantity: 1 },
  ],
  resolvedOrderItems: [
    { variantId: "variant-b", quantity: 1 },
    { variantId: "variant-a", quantity: 2 },
  ],
});
assert(exact.valid, `Exact reservation should match: ${exact.issues.join(" | ")}`);
console.log("✅ order can inherit only an exact reservation");

console.log("=== QUANTITY MISMATCH ===");
const quantityMismatch = matchReservationToPaidOrder({
  reservationItems: [{ canonicalVariantId: "variant-a", quantity: 1 }],
  resolvedOrderItems: [{ variantId: "variant-a", quantity: 2 }],
});
assert(!quantityMismatch.valid && quantityMismatch.issues.length > 0, "Quantity mismatch was accepted");
console.log("✅ quantity mismatch blocked");

console.log("=== VARIANT MISMATCH ===");
const variantMismatch = matchReservationToPaidOrder({
  reservationItems: [{ canonicalVariantId: "variant-a", quantity: 1 }],
  resolvedOrderItems: [{ variantId: "variant-b", quantity: 1 }],
});
assert(!variantMismatch.valid, "Different canonical variant was accepted");
console.log("✅ variant mismatch blocked");

console.log("=== MISSING VARIANT ===");
const missingVariant = matchReservationToPaidOrder({
  reservationItems: [{ canonicalVariantId: "variant-a", quantity: 1 }],
  resolvedOrderItems: [{ variantId: null, quantity: 1 }],
});
assert(!missingVariant.valid, "Variantless paid item was accepted against variant reservation");
console.log("✅ variantless paid item blocked");

console.log("=== CHECKOUT DEADLINE / GRACE ===");
const holdExpiry = new Date("2026-08-08T20:45:00.000Z");
const deadline = checkoutDeadlineFromHoldExpiry(holdExpiry, 10);
assert(deadline.toISOString() === "2026-08-08T20:35:00.000Z", "Webhook grace calculation changed");
console.log("✅ payment deadline precedes stock release by 10 minutes");

console.log("====================================================");
console.log("CHECKOUT INVENTORY RESERVATION: PASS");
console.log("====================================================");
