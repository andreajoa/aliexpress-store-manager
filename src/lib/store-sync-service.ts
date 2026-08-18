import { prisma } from "./prisma";

/*
 * Store Sync Service
 *
 * Empurra atualizações de estoque e rastreamento para lojas conectadas que
 * declaram as capabilities `inventorySync` e/ou `trackingSync` no blob
 * `connectorCapabilities` do Store.
 *
 * Todas as funções de push são fire-and-forget: logam warnings, nunca lançam.
 */

// ---------------------------------------------------------------------------
// Capability parsing
// ---------------------------------------------------------------------------

export type InventorySyncCapability = {
  endpointPath: string;
  authToken: string;
};

export type TrackingSyncCapability = {
  endpointPath: string;
  authToken: string;
};

export type StoreSyncCapabilities = {
  inventorySync: InventorySyncCapability | null;
  trackingSync: TrackingSyncCapability | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseSyncEndpoint(
  raw: unknown,
): { endpointPath: string; authToken: string } | null {
  const obj = record(raw);
  const endpointPath =
    typeof obj.endpointPath === "string" ? obj.endpointPath.trim() : "";
  const authToken =
    typeof obj.authToken === "string" ? obj.authToken.trim() : "";

  if (!endpointPath.startsWith("/")) return null;
  if (!authToken) return null;

  return { endpointPath, authToken };
}

export function parseStoreSyncCapabilities(
  capabilities: unknown,
): StoreSyncCapabilities {
  const obj = record(capabilities);
  return {
    inventorySync: parseSyncEndpoint(obj.inventorySync),
    trackingSync: parseSyncEndpoint(obj.trackingSync),
  };
}

// ---------------------------------------------------------------------------
// Outbound HTTP helper
// ---------------------------------------------------------------------------

const SYNC_TIMEOUT_MS = 10_000;

async function postToStore(
  baseUrl: string,
  endpointPath: string,
  authToken: string,
  payload: unknown,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = new URL(endpointPath, baseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

// ---------------------------------------------------------------------------
// Resolve store base URL
// ---------------------------------------------------------------------------

function storeBaseUrl(store: { apiEndpoint: string | null; baseUrl: string }) {
  if (store.apiEndpoint) {
    // apiEndpoint may be "https://store.com/api/store-connector"
    // We need just the origin for building sync URLs.
    try {
      const parsed = new URL(store.apiEndpoint);
      return parsed.origin;
    } catch {
      // fallthrough
    }
  }
  return store.baseUrl;
}

// ---------------------------------------------------------------------------
// Inventory push
// ---------------------------------------------------------------------------

export type InventorySyncPayload = {
  syncedAt: string;
  productId: string;
  sourceProductId: string;
  variants: Array<{
    sourceSkuId: string;
    stock: number;
    available: boolean;
  }>;
};

export async function pushInventoryToStores(productId: string): Promise<void> {
  const publications = await prisma.publication.findMany({
    where: { productId, status: "PUBLISHED" },
    select: {
      storeId: true,
      store: {
        select: {
          id: true,
          baseUrl: true,
          apiEndpoint: true,
          connectorCapabilities: true,
          status: true,
        },
      },
    },
  });

  if (publications.length === 0) return;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      sourceProductId: true,
      variants: {
        select: {
          sourceSkuId: true,
          stock: true,
          available: true,
        },
      },
    },
  });

  if (!product) return;

  const payload: InventorySyncPayload = {
    syncedAt: new Date().toISOString(),
    productId: product.id,
    sourceProductId: product.sourceProductId,
    variants: product.variants.map((v) => ({
      sourceSkuId: v.sourceSkuId,
      stock: v.stock ?? 0,
      available: v.available,
    })),
  };

  const seen = new Set<string>();

  for (const pub of publications) {
    const store = pub.store;
    if (seen.has(store.id)) continue;
    seen.add(store.id);

    if (store.status !== "ACTIVE") continue;

    const caps = parseStoreSyncCapabilities(store.connectorCapabilities);
    if (!caps.inventorySync) continue;

    try {
      const base = storeBaseUrl(store);
      const result = await postToStore(
        base,
        caps.inventorySync.endpointPath,
        caps.inventorySync.authToken,
        payload,
      );

      if (result.ok) {
        console.log(
          `[Store Sync] Inventory pushed to store ${store.id} for product ${productId}.`,
        );
      } else {
        console.warn(
          `[Store Sync] Inventory push to store ${store.id} returned HTTP ${result.status}: ${result.body.slice(0, 200)}`,
        );
      }
    } catch (error) {
      console.warn(
        `[Store Sync] Inventory push to store ${store.id} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Tracking push
// ---------------------------------------------------------------------------

export type TrackingSyncPayload = {
  syncedAt: string;
  externalOrderId: string;
  trackingCode: string;
  trackingUrl: string | null;
  carrier: string | null;
  status: "SHIPPED" | "DELIVERED";
  shippedAt: string | null;
};

export async function pushTrackingToStore(
  orderId: string,
  batchId: string,
): Promise<void> {
  const batch = await prisma.fulfillmentBatch.findFirst({
    where: { id: batchId, orderId },
    select: {
      trackingCode: true,
      trackingUrl: true,
      carrier: true,
      status: true,
      shippedAt: true,
      order: {
        select: {
          externalOrderId: true,
          storeId: true,
          store: {
            select: {
              id: true,
              baseUrl: true,
              apiEndpoint: true,
              connectorCapabilities: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!batch) return;
  if (!batch.trackingCode) return;
  if (batch.status !== "SHIPPED" && batch.status !== "DELIVERED") return;

  const store = batch.order.store;
  if (store.status !== "ACTIVE") return;

  const caps = parseStoreSyncCapabilities(store.connectorCapabilities);
  if (!caps.trackingSync) return;

  const payload: TrackingSyncPayload = {
    syncedAt: new Date().toISOString(),
    externalOrderId: batch.order.externalOrderId,
    trackingCode: batch.trackingCode,
    trackingUrl: batch.trackingUrl,
    carrier: batch.carrier,
    status: batch.status as "SHIPPED" | "DELIVERED",
    shippedAt: batch.shippedAt?.toISOString() || null,
  };

  try {
    const base = storeBaseUrl(store);
    const result = await postToStore(
      base,
      caps.trackingSync.endpointPath,
      caps.trackingSync.authToken,
      payload,
    );

    if (result.ok) {
      console.log(
        `[Store Sync] Tracking pushed to store ${store.id} for order ${batch.order.externalOrderId}.`,
      );
    } else {
      console.warn(
        `[Store Sync] Tracking push to store ${store.id} returned HTTP ${result.status}: ${result.body.slice(0, 200)}`,
      );
    }
  } catch (error) {
    console.warn(
      `[Store Sync] Tracking push to store ${store.id} failed:`,
      error instanceof Error ? error.message : error,
    );
  }
}
