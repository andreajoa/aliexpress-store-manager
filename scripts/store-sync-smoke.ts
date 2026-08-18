import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Inline do parsing para evitar import de módulos com dependência de Prisma.
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

function parseStoreSyncCapabilities(capabilities: unknown) {
  const obj = record(capabilities);
  return {
    inventorySync: parseSyncEndpoint(obj.inventorySync),
    trackingSync: parseSyncEndpoint(obj.trackingSync),
  };
}

// Garante que o source exporte a mesma função.
const serviceSource = readFileSync("src/lib/store-sync-service.ts", "utf8");
assert(
  serviceSource.includes("export function parseStoreSyncCapabilities"),
  "store-sync-service deve exportar parseStoreSyncCapabilities",
);

// ---------------------------------------------------------------------------
// parseStoreSyncCapabilities — parsing válido
// ---------------------------------------------------------------------------

const validCaps = parseStoreSyncCapabilities({
  inventorySync: {
    endpointPath: "/api/store-connector/inventory",
    authToken: "secret-inventory-token",
  },
  trackingSync: {
    endpointPath: "/api/store-connector/tracking",
    authToken: "secret-tracking-token",
  },
});

assert(validCaps.inventorySync !== null, "inventorySync deve ser parseado");
assert(validCaps.inventorySync.endpointPath === "/api/store-connector/inventory", "endpointPath incorreto");
assert(validCaps.inventorySync.authToken === "secret-inventory-token", "authToken incorreto");
assert(validCaps.trackingSync !== null, "trackingSync deve ser parseado");
assert(validCaps.trackingSync.endpointPath === "/api/store-connector/tracking", "endpointPath tracking incorreto");
assert(validCaps.trackingSync.authToken === "secret-tracking-token", "authToken tracking incorreto");

// ---------------------------------------------------------------------------
// parseStoreSyncCapabilities — capabilities ausentes
// ---------------------------------------------------------------------------

const emptyCaps = parseStoreSyncCapabilities({});
assert(emptyCaps.inventorySync === null, "inventorySync ausente deve ser null");
assert(emptyCaps.trackingSync === null, "trackingSync ausente deve ser null");

const nullCaps = parseStoreSyncCapabilities(null);
assert(nullCaps.inventorySync === null, "null capabilities deve retornar null");
assert(nullCaps.trackingSync === null, "null capabilities deve retornar null");

const undefinedCaps = parseStoreSyncCapabilities(undefined);
assert(undefinedCaps.inventorySync === null, "undefined capabilities deve retornar null");

// ---------------------------------------------------------------------------
// parseStoreSyncCapabilities — valores inválidos
// ---------------------------------------------------------------------------

const noTokenCaps = parseStoreSyncCapabilities({
  inventorySync: { endpointPath: "/api/store-connector/inventory" },
});
assert(noTokenCaps.inventorySync === null, "inventorySync sem authToken deve ser null");

const noPathCaps = parseStoreSyncCapabilities({
  inventorySync: { authToken: "token" },
});
assert(noPathCaps.inventorySync === null, "inventorySync sem endpointPath deve ser null");

const badPathCaps = parseStoreSyncCapabilities({
  inventorySync: { endpointPath: "not-a-path", authToken: "token" },
});
assert(badPathCaps.inventorySync === null, "endpointPath sem / deve ser null");

const partialCaps = parseStoreSyncCapabilities({
  inventorySync: {
    endpointPath: "/api/inventory",
    authToken: "valid",
  },
});
assert(partialCaps.inventorySync !== null, "inventorySync parcial deve funcionar");
assert(partialCaps.trackingSync === null, "trackingSync ausente deve ser null");

// ---------------------------------------------------------------------------
// Verifica injeção no supplier-refresh-service
// ---------------------------------------------------------------------------

const refreshService = readFileSync("src/lib/supplier-refresh-service.ts", "utf8");
assert(
  refreshService.includes("pushInventoryToStores"),
  "supplier-refresh-service deve chamar pushInventoryToStores",
);

// ---------------------------------------------------------------------------
// Verifica injeção no order-fulfillment-lifecycle
// ---------------------------------------------------------------------------

const lifecycle = readFileSync("src/lib/order-fulfillment-lifecycle.ts", "utf8");
assert(
  lifecycle.includes("pushTrackingToStore"),
  "order-fulfillment-lifecycle deve chamar pushTrackingToStore",
);

// ---------------------------------------------------------------------------
// Verifica crons no vercel.json
// ---------------------------------------------------------------------------

const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  crons?: Array<{ path: string; schedule: string }>;
};

assert(
  vercelConfig.crons?.some((c) => c.path === "/api/cron/stock-sync"),
  "vercel.json deve ter cron stock-sync",
);
assert(
  vercelConfig.crons?.some((c) => c.path === "/api/cron/tracking-sync"),
  "vercel.json deve ter cron tracking-sync",
);
assert(
  vercelConfig.crons?.some((c) => c.path === "/api/cron/maintenance"),
  "vercel.json deve manter cron maintenance",
);

// ---------------------------------------------------------------------------
// Verifica rotas de cron existem
// ---------------------------------------------------------------------------

const stockSyncRoute = readFileSync("src/app/api/cron/stock-sync/route.ts", "utf8");
assert(stockSyncRoute.includes("refreshSupplier"), "stock-sync deve chamar refreshSupplier");
assert(stockSyncRoute.includes("CRON_SECRET"), "stock-sync deve verificar CRON_SECRET");

const trackingSyncRoute = readFileSync("src/app/api/cron/tracking-sync/route.ts", "utf8");
assert(trackingSyncRoute.includes("syncAliExpressBatch"), "tracking-sync deve chamar syncAliExpressBatch");
assert(trackingSyncRoute.includes("CRON_SECRET"), "tracking-sync deve verificar CRON_SECRET");

// ---------------------------------------------------------------------------
// Verifica maintenance simplificado
// ---------------------------------------------------------------------------

const maintenanceRoute = readFileSync("src/app/api/cron/maintenance/route.ts", "utf8");
assert(maintenanceRoute.includes("scanAmbCatalog"), "maintenance deve manter scanAmbCatalog");
assert(maintenanceRoute.includes("expireCheckoutReservations"), "maintenance deve manter expireCheckoutReservations");
assert(!maintenanceRoute.includes("refreshSupplier"), "maintenance não deve mais chamar refreshSupplier");
assert(!maintenanceRoute.includes("syncAliExpressBatch"), "maintenance não deve mais chamar syncAliExpressBatch");

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

console.log("STORE SYNC: PASS");
