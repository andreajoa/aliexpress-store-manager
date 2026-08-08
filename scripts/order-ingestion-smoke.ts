import {
  minimizedIntegrationPayload,
  paidOrderEventSchema,
} from "../src/lib/order-paid-contract.ts";
import { resolvePaidOrderItems } from "../src/lib/order-item-resolver.ts";
import {
  createStoreWebhookToken,
  hashStoreWebhookToken,
  verifyStoreWebhookToken,
} from "../src/lib/store-webhook-auth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("=== WEBHOOK AUTH ===");
const token = createStoreWebhookToken();
const hash = hashStoreWebhookToken(token);
assert(token.startsWith("smwh_"), "Prefixo do token inválido");
assert(hash.length === 64, "Hash SHA-256 inválido");
assert(verifyStoreWebhookToken(token, hash), "Token correto não validou");
assert(!verifyStoreWebhookToken(`${token}x`, hash), "Token alterado foi aceito");
console.log("✅ segredo persistível somente como hash e comparação timing-safe");

const validEvent = {
  eventId: "evt_store_paid_001",
  eventType: "order.paid" as const,
  occurredAt: "2026-08-08T18:30:00Z",
  order: {
    id: "cs_test_001",
    currency: "BRL",
    subtotalCents: 9980,
    shippingAmountCents: 1200,
    discountAmountCents: 500,
    totalCents: 10680,
    customer: {
      name: "Ana Cliente",
      email: "ana@example.com",
      phone: "+5513999999999",
    },
    shippingAddress: {
      recipient: "Ana Cliente",
      line1: "Rua Exemplo",
      number: "123",
      district: "Centro",
      city: "Santos",
      state: "SP",
      postalCode: "11000-000",
      countryCode: "BR",
    },
    items: [
      {
        externalProductId: "ae-3256810332224371",
        externalVariantId: "sku-12000052674809549",
        title: "Brinquedo Magnético",
        quantity: 2,
        unitPriceCents: 4990,
        totalPriceCents: 9980,
      },
    ],
  },
};

console.log("=== CONTRACT ===");
const parsed = paidOrderEventSchema.safeParse(validEvent);
assert(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
const invalidTotal = paidOrderEventSchema.safeParse({
  ...validEvent,
  order: { ...validEvent.order, totalCents: 9999 },
});
assert(!invalidTotal.success, "Total inconsistente deveria ser rejeitado");
console.log("✅ centavos inteiros e reconciliação financeira validados");

console.log("=== EVENT MINIMIZATION ===");
const minimized = minimizedIntegrationPayload(parsed.data);
const serialized = JSON.stringify(minimized);
assert(!serialized.includes("Ana Cliente"), "PII do cliente vazou para IntegrationEvent");
assert(!serialized.includes("Rua Exemplo"), "Endereço vazou para IntegrationEvent");
assert(serialized.includes("ae-3256810332224371"), "Identificador operacional do produto foi perdido");
console.log("✅ log de integração minimizado sem PII duplicada");

console.log("=== ITEM RESOLUTION ===");
const lookup = [{
  externalProductId: "ae-3256810332224371",
  productId: "product-1",
  sourceUrl: "https://www.aliexpress.com/item/3256810332224371.html",
  variants: [
    {
      id: "canonical-black-4",
      sourceSkuId: "12000052674809549",
      attributes: { Color: "Black", Kit: "4pcs" },
    },
  ],
}];
const resolved = resolvePaidOrderItems({
  items: validEvent.order.items,
  publishedProducts: lookup,
});
assert(resolved.ready, JSON.stringify(resolved.blockers));
assert(resolved.items[0]?.variantId === "canonical-black-4", "SKU externo não resolveu para variante canônica");
assert(resolved.items[0]?.sourceSkuId === "12000052674809549", "Prefixo sku- não foi normalizado corretamente");
console.log("✅ externalProductId + externalVariantId resolvem somente por identificadores exatos");

console.log("=== FAIL CLOSED ===");
const missingPublication = resolvePaidOrderItems({
  items: validEvent.order.items,
  publishedProducts: [],
});
assert(!missingPublication.ready, "Produto não publicado foi aceito");
assert(missingPublication.blockers[0]?.code === "PRODUCT_NOT_PUBLISHED", "Blocker incorreto para produto não publicado");
const missingVariant = resolvePaidOrderItems({
  items: [{ ...validEvent.order.items[0], externalVariantId: null }],
  publishedProducts: lookup,
});
assert(!missingVariant.ready, "Produto com variantes aceitou item sem variante");
assert(missingVariant.blockers[0]?.code === "VARIANT_REQUIRED", "Blocker incorreto para variante ausente");
const wrongVariant = resolvePaidOrderItems({
  items: [{ ...validEvent.order.items[0], externalVariantId: "sku-nao-existe" }],
  publishedProducts: lookup,
});
assert(!wrongVariant.ready, "SKU inexistente foi aceito");
assert(wrongVariant.blockers[0]?.code === "VARIANT_NOT_FOUND", "Blocker incorreto para SKU inexistente");
console.log("✅ produto/variante desconhecidos nunca geram pedido parcial");

console.log("====================================================");
console.log("ORDER INGESTION SAFETY: PASS");
console.log("====================================================");
