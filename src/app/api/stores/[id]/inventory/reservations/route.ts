import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  InventoryReservationError,
  releaseCheckoutReservation,
  reserveCheckoutInventory,
} from "@/lib/inventory-reservation";
import { prisma } from "@/lib/prisma";
import { bearerToken, verifyStoreWebhookToken } from "@/lib/store-webhook-auth";

export const runtime = "nodejs";

const reserveSchema = z.object({
  reservationId: z.string().trim().min(1).max(255),
  ttlMinutes: z.number().int().min(15).max(30).optional(),
  items: z.array(z.object({
    externalProductId: z.string().trim().min(1).max(200),
    externalVariantId: z.string().trim().min(1).max(200),
    quantity: z.number().int().min(1).max(100),
  }).strict()).min(1).max(50),
}).strict();

const releaseSchema = z.object({
  reservationId: z.string().trim().min(1).max(255),
}).strict();

async function authorize(storeId: string, request: Request) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, status: true, webhookEnabled: true, webhookTokenHash: true },
  });
  const token = bearerToken(request);
  if (
    !store ||
    store.status !== "ACTIVE" ||
    !store.webhookEnabled ||
    !token ||
    !verifyStoreWebhookToken(token, store.webhookTokenHash)
  ) return false;
  return true;
}

function errorResponse(error: unknown) {
  if (error instanceof InventoryReservationError) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message, details: error.details ?? null },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  console.error("Inventory reservation failed:", error);
  return NextResponse.json(
    { ok: false, code: "RESERVATION_FAILED", error: "Não foi possível reservar o estoque com segurança." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: storeId } = await params;
  if (!(await authorize(storeId, request))) {
    return NextResponse.json({ ok: false, error: "Credencial da loja inválida." }, { status: 401 });
  }
  const parsed = reserveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Reserva inválida.", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const result = await reserveCheckoutInventory({
      storeId,
      externalReservationId: parsed.data.reservationId,
      items: parsed.data.items,
      ttlMinutes: parsed.data.ttlMinutes,
    });
    return NextResponse.json({ ok: true, ...result }, {
      status: result.idempotent ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: storeId } = await params;
  if (!(await authorize(storeId, request))) {
    return NextResponse.json({ ok: false, error: "Credencial da loja inválida." }, { status: 401 });
  }
  const parsed = releaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "reservationId inválida." }, { status: 400 });
  try {
    const result = await releaseCheckoutReservation({
      storeId,
      externalReservationId: parsed.data.reservationId,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
