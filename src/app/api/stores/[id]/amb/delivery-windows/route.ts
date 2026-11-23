import { createPublicKey, verify as verifySignature } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { parseAmbBridgeConfig } from "@/lib/amb-bridge-contract";
import { prisma } from "@/lib/prisma";
import { bearerToken, verifySharedWebhookToken } from "@/lib/store-webhook-auth";
import { buildSanitizedAmbDeliveryPayload } from "@/lib/supplier-delivery";

export const runtime = "nodejs";
export const maxDuration = 60;

async function ambBootstrapHash() {
  const baseUrl =
    process.env.AMB_BOUTIQUE_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://www.ambboutique.online";
  const response = await fetch(`${baseUrl}/api/store-manager/bootstrap`, { cache: "no-store" });
  const body = await response.json().catch(() => null) as { tokenHash?: string } | null;
  return response.ok ? body?.tokenHash?.trim() || "" : "";
}

async function verifyAmbSignedRequest(request: NextRequest) {
  const timestamp = request.headers.get("x-amb-timestamp")?.trim() || "";
  const signature = request.headers.get("x-amb-signature")?.trim() || "";
  const keyId = request.headers.get("x-amb-key-id")?.trim() || "";
  const timestampNumber = Number(timestamp);
  const timestampFresh = Boolean(
    timestamp &&
    Number.isFinite(timestampNumber) &&
    Math.abs(Date.now() - timestampNumber) <= 5 * 60 * 1000,
  );

  const diagnostic = {
    headersPresent: Boolean(timestamp && signature && keyId),
    timestampFresh,
    keyFetched: false,
    keyIdMatch: false,
    signatureValid: false,
  };

  if (!diagnostic.headersPresent || !timestampFresh) {
    return { valid: false, diagnostic };
  }

  const baseUrl =
    process.env.AMB_BOUTIQUE_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://www.ambboutique.online";
  const response = await fetch(`${baseUrl}/api/fulfillment/public-key`, { cache: "no-store" });
  const body = await response.json().catch(() => null) as {
    algorithm?: string;
    keyId?: string;
    publicKeyPem?: string;
  } | null;
  diagnostic.keyFetched = Boolean(response.ok && body?.publicKeyPem);
  diagnostic.keyIdMatch = Boolean(body?.keyId && body.keyId === keyId);
  if (
    !response.ok ||
    body?.algorithm !== "Ed25519" ||
    !body.publicKeyPem ||
    body.keyId !== keyId
  ) {
    return { valid: false, diagnostic };
  }

  const canonical = [
    "GET",
    request.nextUrl.pathname,
    "delivery-windows",
    timestamp,
  ].join("\n");

  try {
    diagnostic.signatureValid = verifySignature(
      null,
      Buffer.from(canonical, "utf8"),
      createPublicKey(body.publicKeyPem),
      Buffer.from(signature, "base64"),
    );
    return { valid: diagnostic.signatureValid, diagnostic };
  } catch {
    return { valid: false, diagnostic };
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: storeId } = await context.params;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      status: true,
      webhookEnabled: true,
      webhookTokenHash: true,
      connectorCapabilities: true,
    },
  });

  if (storeId !== "amb-boutique-store" || !store || store.status !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const token = bearerToken(request);
  let tokenValid = Boolean(
    token &&
    store.webhookEnabled &&
    verifySharedWebhookToken(token, store.webhookTokenHash),
  );
  if (!tokenValid && token) {
    const bootstrapHash = await ambBootstrapHash().catch(() => "");
    if (bootstrapHash && verifySharedWebhookToken(token, bootstrapHash)) {
      tokenValid = true;
      await prisma.store.update({
        where: { id: storeId },
        data: {
          baseUrl: "https://www.ambboutique.online",
          webhookEnabled: true,
          webhookTokenHash: bootstrapHash,
          webhookTokenCreatedAt: new Date(),
        },
      });
    }
  }

  const signed = tokenValid
    ? { valid: true, diagnostic: { tokenValid: true } }
    : await verifyAmbSignedRequest(request);

  if (!signed.valid) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
        authDiagnostic: signed.diagnostic,
      },
      { status: 401 },
    );
  }

  const bridge = parseAmbBridgeConfig(store.connectorCapabilities);
  const publications = await prisma.publication.findMany({
    where: {
      storeId,
      externalSlug: { not: null },
      status: { not: "ARCHIVED" },
    },
    select: {
      externalSlug: true,
      productId: true,
    },
  });

  const sourceProductIds = bridge
    ? [...new Set(Object.values(bridge.products).map((binding) => binding.sourceProductId))]
    : [];
  const publicationProductIds = [...new Set(publications.map((pub) => pub.productId))];

  const productFilters: Array<Record<string, unknown>> = [];
  if (sourceProductIds.length > 0) {
    productFilters.push({
      sourceProvider: "ALIEXPRESS",
      sourceProductId: { in: sourceProductIds },
    });
  }
  if (publicationProductIds.length > 0) {
    productFilters.push({
      id: { in: publicationProductIds },
    });
  }

  const products = productFilters.length > 0
    ? await prisma.product.findMany({
      where: { OR: productFilters },
      select: {
        id: true,
        sourceProductId: true,
        rawPayload: true,
        specifications: true,
        updatedAt: true,
        supplierProducts: {
          where: { status: "ACTIVE" },
          select: {
            role: true,
            priority: true,
            status: true,
            rawPayload: true,
            lastCheckedAt: true,
            updatedAt: true,
          },
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        },
      },
    })
    : [];

  const payload = buildSanitizedAmbDeliveryPayload({
    storeId,
    bridge,
    publications,
    products,
  });

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
