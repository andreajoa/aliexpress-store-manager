import {
  buildSanitizedAmbDeliveryPayload,
  extractSupplierDeliveryProfile,
  mergeDeliveryPayloadFields,
  parseEstimatedDeliveryDays,
  summarizeFreightDeliveryTimes,
} from "../src/lib/supplier-delivery.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const refMs = Date.UTC(2026, 10, 23, 12, 0, 0); // 2026-11-23T12:00:00Z

// 1. Parse all common AliExpress estimatedDeliveryTime formats
const p5 = parseEstimatedDeliveryDays("5days", refMs);
assert(p5 && p5.minDays === 5 && p5.maxDays === 5, "Deve ler '5days'");

const pRange = parseEstimatedDeliveryDays("7-10 days", refMs);
assert(pRange && pRange.minDays === 7 && pRange.maxDays === 10, "Deve ler '7-10 days'");

const pEnDash = parseEstimatedDeliveryDays("8–15", refMs);
assert(pEnDash && pEnDash.minDays === 8 && pEnDash.maxDays === 15, "Deve ler '8–15'");

const pIso = parseEstimatedDeliveryDays("2026-12-03", refMs);
assert(pIso && pIso.minDays === 10 && pIso.maxDays === 10, "Deve calcular dias a partir de data ISO");

assert(parseEstimatedDeliveryDays(null, refMs) === null, "null deve retornar null");
assert(parseEstimatedDeliveryDays("0days", refMs) === null, "0 dias deve ser rejeitado");
assert(parseEstimatedDeliveryDays("95days", refMs) === null, ">60 dias deve ser rejeitado");

// 2. Summarize multi-SKU freight delivery times without discarding differing SKUs
const merged = summarizeFreightDeliveryTimes(["10days", "12days", null], refMs);
assert(merged?.estimatedDeliveryTime === "10-12days", "SKUs 10days e 12days devem consolidar em 10-12days");

const uniform = summarizeFreightDeliveryTimes(["15days", "15days"], refMs);
assert(uniform?.estimatedDeliveryTime === "15days", "SKUs iguais devem manter 15days");

// 3. Preserving manual overrides and merging market quotes on refresh
const existingRaw = {
  manualDeliveryDays: { minDays: 5, maxDays: 6, allMarkets: false, updatedAt: "2026-11-20T10:00:00.000Z" },
  deliveryByMarket: {
    UK: { minDays: 9, maxDays: 12, source: "supplier-quote", updatedAt: "2026-11-19T10:00:00.000Z" },
  },
};
const mergedFields = mergeDeliveryPayloadFields(existingRaw, {
  countryCode: "US",
  calculatedAt: "2026-11-23T15:00:00.000Z",
  freight: { estimatedDeliveryTime: "11days" },
});
assert(
  (mergedFields.manualDeliveryDays as { minDays: number }).minDays === 5,
  "Refresh não pode apagar manualDeliveryDays",
);
assert(
  ((mergedFields.deliveryByMarket as Record<string, { minDays: number }>).UK)?.minDays === 9 &&
  ((mergedFields.deliveryByMarket as Record<string, { minDays: number }>).US)?.minDays === 11,
  "Refresh deve preservar mercados anteriores e atualizar o mercado cotado",
);

// 4. Precedence: manual override > supplier costSnapshot > product fallback
const extracted = extractSupplierDeliveryProfile({
  supplierRawPayload: {
    ...mergedFields,
    costSnapshot: {
      countryCode: "US",
      calculatedAt: "2026-11-23T15:00:00.000Z",
      freight: { estimatedDeliveryTime: "14days" },
    },
  },
  supplierUpdatedAt: "2026-11-23T15:00:00.000Z",
});
assert(extracted?.markets.US?.minDays === 5 && extracted.markets.US.source === "manual", "Manual override deve ter prioridade sobre cotação US");
assert(extracted?.markets.UK?.minDays === 9 && extracted.markets.UK.source === "supplier-quote", "Mercado UK preservado deve continuar disponível");

// 5. Sanitized AMB payload: ZERO leakage of supplier identity, AliExpress, carriers, or costs
const sanitized = buildSanitizedAmbDeliveryPayload({
  storeId: "amb-boutique-store",
  bridge: {
    version: 1,
    mode: "backend-only",
    products: {
      "fast-silk-dress": { sourceProductId: "3256800001", color: "Ivory" },
      "standard-trench": { sourceProductId: "3256800002", color: "Camel" },
      "unquoted-piece": { sourceProductId: "3256800003", color: "Black" },
    },
  },
  publications: [],
  products: [
    {
      id: "prod-1",
      sourceProductId: "3256800001",
      rawPayload: { sellerName: "Secret AliExpress Factory", landedCost: 14.5 },
      specifications: {},
      updatedAt: "2026-11-23T12:00:00.000Z",
      supplierProducts: [
        {
          role: "PRIMARY",
          priority: 0,
          status: "ACTIVE",
          rawPayload: {
            costSnapshot: {
              countryCode: "US",
              calculatedAt: "2026-11-23T14:00:00.000Z",
              freight: {
                selectedServiceName: "YUNEXPRESS_STANDARD",
                estimatedDeliveryTime: "5days",
                amountInCostCurrency: 6.4,
              },
            },
          },
          lastCheckedAt: "2026-11-23T14:00:00.000Z",
          updatedAt: "2026-11-23T14:00:00.000Z",
        },
      ],
    },
    {
      id: "prod-2",
      sourceProductId: "3256800002",
      rawPayload: {
        costSnapshot: {
          countryCode: "US",
          calculatedAt: "2026-11-22T14:00:00.000Z",
          freight: { estimatedDeliveryTime: "15days" },
        },
      },
      specifications: {},
      updatedAt: "2026-11-22T14:00:00.000Z",
      supplierProducts: [
        {
          role: "PRIMARY",
          priority: 0,
          status: "ACTIVE",
          rawPayload: {},
          lastCheckedAt: "2026-11-22T14:00:00.000Z",
          updatedAt: "2026-11-22T14:00:00.000Z",
        },
      ],
    },
    {
      id: "prod-3",
      sourceProductId: "3256800003",
      rawPayload: {},
      specifications: {},
      updatedAt: "2026-11-22T14:00:00.000Z",
      supplierProducts: [],
    },
  ],
});

assert(sanitized.ok === true, "Payload deve retornar ok: true");
assert(sanitized.linkedCount === 3, "Deve contar 3 produtos vinculados");
assert(sanitized.productCount === 2, "Deve exportar apenas os 2 produtos com prazo válido");
assert(sanitized.products["fast-silk-dress"]?.markets.US?.minDays === 5, "fast-silk-dress deve ter 5 dias");
assert(sanitized.products["standard-trench"]?.markets.US?.minDays === 15, "standard-trench deve usar fallback do produto (15 dias)");
assert(!sanitized.products["unquoted-piece"], "Produto sem prazo não deve aparecer no mapa");

const serialized = JSON.stringify(sanitized).toLowerCase();
for (const forbidden of ["aliexpress", "yunexpress", "cainiao", "secret", "3256800001", "landedcost", "14.5", "6.4"]) {
  assert(!serialized.includes(forbidden), `Vazamento proibido no payload AMB: ${forbidden}`);
}

// 6. US Warehouse signal: only shipsFromUs/usWarehouse=true when US warehouse has stock > 0
const usWarehousePayload = buildSanitizedAmbDeliveryPayload({
  storeId: "amb-boutique-store",
  bridge: {
    version: 1,
    mode: "backend-only",
    products: {
      "us-in-stock-dress": { sourceProductId: "3256809001", color: "Ivory" },
      "us-out-of-stock-shorts": { sourceProductId: "3256809002", color: "Blue" },
    },
  },
  publications: [],
  products: [
    {
      id: "prod-us-ok",
      sourceProductId: "3256809001",
      rawPayload: {},
      specifications: {},
      updatedAt: "2026-11-24T12:00:00.000Z",
      supplierProducts: [
        {
          role: "PRIMARY",
          priority: 0,
          status: "ACTIVE",
          rawPayload: {
            deliveryByMarket: {
              US: { minDays: 6, maxDays: 8, source: "supplier-quote", updatedAt: "2026-11-24T12:00:00.000Z" },
            },
            usWarehouseAudit: {
              checkedAt: "2026-11-24T12:00:00.000Z",
              checked: true,
              hasUsWarehouse: true,
              hasUsInStock: true,
              usTotalStock: 120,
              dispatchCountry: "US",
            },
          },
          lastCheckedAt: "2026-11-24T12:00:00.000Z",
          updatedAt: "2026-11-24T12:00:00.000Z",
        },
      ],
    },
    {
      id: "prod-us-empty",
      sourceProductId: "3256809002",
      rawPayload: {},
      specifications: {},
      updatedAt: "2026-11-24T12:00:00.000Z",
      supplierProducts: [
        {
          role: "PRIMARY",
          priority: 0,
          status: "ACTIVE",
          rawPayload: {
            deliveryByMarket: {
              US: { minDays: 14, maxDays: 18, source: "supplier-quote", updatedAt: "2026-11-24T12:00:00.000Z" },
            },
            usWarehouseAudit: {
              checkedAt: "2026-11-24T12:00:00.000Z",
              checked: true,
              hasUsWarehouse: true,
              hasUsInStock: false,
              usTotalStock: 0,
              dispatchCountry: "CN",
            },
          },
          lastCheckedAt: "2026-11-24T12:00:00.000Z",
          updatedAt: "2026-11-24T12:00:00.000Z",
        },
      ],
    },
  ],
});

assert(usWarehousePayload.products["us-in-stock-dress"]?.shipsFromUs === true, "Produto com estoque nos EUA deve sinalizar shipsFromUs=true");
assert(usWarehousePayload.products["us-in-stock-dress"]?.markets.US?.usWarehouse === true, "Mercado US com estoque EUA deve sinalizar usWarehouse=true");
assert(!usWarehousePayload.products["us-out-of-stock-shorts"]?.shipsFromUs, "Produto US com estoque 0 NÃO pode sinalizar shipsFromUs na loja");
assert(!usWarehousePayload.products["us-out-of-stock-shorts"]?.markets.US?.usWarehouse, "Mercado US com estoque 0 NÃO pode sinalizar usWarehouse na loja");

console.log("AMB SUPPLIER DELIVERY: PASS");
