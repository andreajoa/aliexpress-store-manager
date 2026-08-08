import { z } from "zod";

const cents = z.number().int().min(0).max(1_000_000_000);

const addressSchema = z.object({
  recipient: z.string().trim().min(1).max(200),
  line1: z.string().trim().min(1).max(300),
  line2: z.string().trim().max(300).optional().nullable(),
  number: z.string().trim().max(80).optional().nullable(),
  district: z.string().trim().max(160).optional().nullable(),
  city: z.string().trim().min(1).max(160),
  state: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().min(1).max(32),
  countryCode: z.string().trim().length(2).default("BR"),
  instructions: z.string().trim().max(1000).optional().nullable(),
}).strict();

const itemSchema = z.object({
  externalProductId: z.string().trim().min(1).max(200),
  externalVariantId: z.string().trim().min(1).max(200).optional().nullable(),
  title: z.string().trim().min(1).max(500),
  quantity: z.number().int().min(1).max(100),
  unitPriceCents: cents,
  totalPriceCents: cents,
}).strict().superRefine((item, ctx) => {
  if (item.totalPriceCents !== item.unitPriceCents * item.quantity) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "totalPriceCents deve ser igual a unitPriceCents × quantity.",
      path: ["totalPriceCents"],
    });
  }
});

export const paidOrderEventSchema = z.object({
  eventId: z.string().trim().min(1).max(255),
  eventType: z.literal("order.paid"),
  occurredAt: z.string().datetime({ offset: true }),
  order: z.object({
    id: z.string().trim().min(1).max(255),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    subtotalCents: cents,
    shippingAmountCents: cents,
    discountAmountCents: cents,
    totalCents: cents,
    customer: z.object({
      name: z.string().trim().min(1).max(200),
      email: z.string().trim().email().max(320).optional().nullable(),
      phone: z.string().trim().max(80).optional().nullable(),
    }).strict(),
    shippingAddress: addressSchema,
    items: z.array(itemSchema).min(1).max(50),
  }).strict(),
}).strict().superRefine((event, ctx) => {
  const subtotal = event.order.items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  if (subtotal !== event.order.subtotalCents) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "subtotalCents não corresponde à soma dos itens.",
      path: ["order", "subtotalCents"],
    });
  }

  const expectedTotal = event.order.subtotalCents - event.order.discountAmountCents + event.order.shippingAmountCents;
  if (expectedTotal < 0 || expectedTotal !== event.order.totalCents) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "totalCents não corresponde a subtotal - desconto + frete.",
      path: ["order", "totalCents"],
    });
  }
});

export type PaidOrderEvent = z.infer<typeof paidOrderEventSchema>;

export function minimizedIntegrationPayload(event: PaidOrderEvent) {
  return {
    protocolVersion: "2026-08-08",
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    externalOrderId: event.order.id,
    currency: event.order.currency,
    totalCents: event.order.totalCents,
    items: event.order.items.map((item) => ({
      externalProductId: item.externalProductId,
      externalVariantId: item.externalVariantId || null,
      quantity: item.quantity,
    })),
  };
}

export function centsToCurrencyUnits(value: number) {
  return Math.round(value) / 100;
}
