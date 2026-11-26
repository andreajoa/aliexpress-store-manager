import { NextResponse } from "next/server";
import { z } from "zod";

import { relinkAmbPaidOrderToAliExpress } from "@/lib/amb-backend-bridge";
import { prisma } from "@/lib/prisma";
import { bearerToken, verifySharedWebhookToken } from "@/lib/store-webhook-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  confirm: z.literal(true),
  sessionId: z.string().trim().regex(/^cs_[A-Za-z0-9_]+$/),
  aliexpressOrderId: z.string().trim().regex(/^\d{10,24}$/),
}).strict();

// Re-links a paid AMB order to an AliExpress order that already exists.
// Never places a new AliExpress order (see relinkAmbPaidOrderToAliExpress).
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: storeId } = await context.params;
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { status: true, webhookEnabled: true, webhookTokenHash: true },
  });
  const token = bearerToken(request);
  if (
    storeId !== "amb-boutique-store" ||
    !store ||
    store.status !== "ACTIVE" ||
    !store.webhookEnabled ||
    !token ||
    !verifySharedWebhookToken(token, store.webhookTokenHash)
  ) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Informe confirm, sessionId e aliexpressOrderId." }, { status: 400 });
  }

  try {
    const result = await relinkAmbPaidOrderToAliExpress({
      storeId,
      sessionId: parsed.data.sessionId,
      aliexpressOrderId: parsed.data.aliexpressOrderId,
      accessToken: token,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: (error instanceof Error ? error.message : "Falha ao religar o pedido.").slice(0, 1000),
    }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}
