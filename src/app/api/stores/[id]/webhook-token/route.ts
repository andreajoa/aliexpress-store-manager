import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  createStoreWebhookToken,
  hashStoreWebhookToken,
} from "@/lib/store-webhook-auth";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const store = await prisma.store.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      webhookEnabled: true,
      webhookTokenCreatedAt: true,
      webhookLastSeenAt: true,
    },
  });

  if (!store) {
    return NextResponse.json({ ok: false, error: "Loja não encontrada." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    storeId: store.id,
    storeName: store.name,
    enabled: store.webhookEnabled,
    tokenCreatedAt: store.webhookTokenCreatedAt?.toISOString() || null,
    lastSeenAt: store.webhookLastSeenAt?.toISOString() || null,
    webhookPath: `/api/stores/${encodeURIComponent(store.id)}/orders/webhook`,
  });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const store = await prisma.store.findUnique({
    where: { id },
    select: { id: true, name: true },
  });

  if (!store) {
    return NextResponse.json({ ok: false, error: "Loja não encontrada." }, { status: 404 });
  }

  const token = createStoreWebhookToken();
  const createdAt = new Date();

  await prisma.store.update({
    where: { id },
    data: {
      webhookTokenHash: hashStoreWebhookToken(token),
      webhookTokenCreatedAt: createdAt,
      webhookEnabled: true,
    },
  });

  return NextResponse.json({
    ok: true,
    storeId: store.id,
    storeName: store.name,
    token,
    tokenVisibleOnce: true,
    tokenCreatedAt: createdAt.toISOString(),
    webhookPath: `/api/stores/${encodeURIComponent(store.id)}/orders/webhook`,
    warning: "Guarde este token como segredo na loja conectada. O Store Manager armazena apenas o hash e não poderá exibi-lo novamente.",
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const store = await prisma.store.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!store) {
    return NextResponse.json({ ok: false, error: "Loja não encontrada." }, { status: 404 });
  }

  await prisma.store.update({
    where: { id },
    data: {
      webhookEnabled: false,
      webhookTokenHash: null,
      webhookTokenCreatedAt: null,
    },
  });

  return NextResponse.json({ ok: true, disabled: true });
}
