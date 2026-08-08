import {
  deriveCanonicalAvailability,
  selectSupplier,
  type SupplierSelectionInput,
} from "../src/lib/supplier-selection.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const now = new Date("2026-08-08T18:00:00Z");
const fresh = "2026-08-08T17:55:00Z";

function supplier(input: Partial<SupplierSelectionInput> & Pick<SupplierSelectionInput, "id" | "role">): SupplierSelectionInput {
  return {
    id: input.id,
    role: input.role,
    priority: input.priority ?? (input.role === "PRIMARY" ? 0 : 50),
    status: input.status ?? "ACTIVE",
    sourceCurrency: input.sourceCurrency ?? "USD",
    lastCheckedAt: input.lastCheckedAt ?? fresh,
    mappings: input.mappings ?? [
      {
        canonicalVariantId: "v-black-4",
        active: true,
        supplierVariant: {
          id: `${input.id}-sku1`,
          sourceSkuId: `${input.id}-sku1`,
          sourcePrice: 7.5,
          stock: 20,
        },
      },
    ],
  };
}

console.log("=== PRIMARY POLICY ===");
const primaryWins = selectSupplier({
  requirements: [{ canonicalVariantId: "v-black-4", quantity: 1 }],
  suppliers: [
    supplier({ id: "primary", role: "PRIMARY", mappings: [{ canonicalVariantId: "v-black-4", active: true, supplierVariant: { id: "p", sourceSkuId: "p", sourcePrice: 10, stock: 10 } }] }),
    supplier({ id: "cheap", role: "ALTERNATIVE", priority: 0, mappings: [{ canonicalVariantId: "v-black-4", active: true, supplierVariant: { id: "c", sourceSkuId: "c", sourcePrice: 2, stock: 100 } }] }),
  ],
  now,
});
assert(primaryWins.selected?.supplierId === "primary", "Fornecedor principal elegível deve vencer a política");
console.log("✅ principal elegível preservado mesmo com alternativa mais barata");

console.log("=== FALLBACK POR ESTOQUE ===");
const fallback = selectSupplier({
  requirements: [{ canonicalVariantId: "v-black-4", quantity: 3 }],
  suppliers: [
    supplier({ id: "primary", role: "PRIMARY", mappings: [{ canonicalVariantId: "v-black-4", active: true, supplierVariant: { id: "p", sourceSkuId: "p", sourcePrice: 7, stock: 1 } }] }),
    supplier({ id: "backup", role: "BACKUP", mappings: [{ canonicalVariantId: "v-black-4", active: true, supplierVariant: { id: "b", sourceSkuId: "b", sourcePrice: 8, stock: 8 } }] }),
  ],
  now,
});
assert(fallback.selected?.supplierId === "backup", "Backup deveria assumir quando principal não tem estoque");
console.log("✅ backup assume somente quando principal não atende");

console.log("=== MAPPING INCOMPLETO ===");
const missingMapping = selectSupplier({
  requirements: [{ canonicalVariantId: "v-purple-8", quantity: 1 }],
  suppliers: [supplier({ id: "s1", role: "PRIMARY" })],
  now,
});
assert(!missingMapping.selected, "Mapping ausente não pode selecionar fornecedor");
assert(missingMapping.candidates[0]?.issues.some((issue) => issue.code === "MAPPING_MISSING"), "Motivo mapping missing ausente");
console.log("✅ mapping incompleto bloqueia fulfillment automático");

console.log("=== DADOS VELHOS ===");
const stale = selectSupplier({
  requirements: [{ canonicalVariantId: "v-black-4", quantity: 1 }],
  suppliers: [supplier({ id: "stale", role: "PRIMARY", lastCheckedAt: "2026-08-07T00:00:00Z" })],
  now,
  maxAgeMinutes: 360,
});
assert(!stale.selected, "Dados antigos não podem alimentar seleção automática");
assert(stale.candidates[0]?.issues.some((issue) => issue.code === "SUPPLIER_DATA_STALE"), "Motivo stale ausente");
console.log("✅ fornecedor desatualizado exige refresh");

console.log("=== DESEMPATE POR CUSTO ===");
const cheapest = selectSupplier({
  requirements: [{ canonicalVariantId: "v-black-4", quantity: 2 }],
  suppliers: [
    supplier({ id: "b1", role: "BACKUP", priority: 50, mappings: [{ canonicalVariantId: "v-black-4", active: true, supplierVariant: { id: "b1s", sourceSkuId: "b1s", sourcePrice: 9, stock: 20 } }] }),
    supplier({ id: "b2", role: "BACKUP", priority: 50, mappings: [{ canonicalVariantId: "v-black-4", active: true, supplierVariant: { id: "b2s", sourceSkuId: "b2s", sourcePrice: 7, stock: 20 } }] }),
  ],
  now,
});
assert(cheapest.selected?.supplierId === "b2", "Mesma política/prioridade deve escolher menor custo comparável");
console.log("✅ custo só desempata dentro da mesma política e moeda");

console.log("=== MOEDAS NÃO COMPARÁVEIS ===");
const currencyReview = selectSupplier({
  requirements: [{ canonicalVariantId: "v-black-4", quantity: 1 }],
  suppliers: [
    supplier({ id: "usd", role: "BACKUP", priority: 50, sourceCurrency: "USD" }),
    supplier({ id: "brl", role: "BACKUP", priority: 50, sourceCurrency: "BRL" }),
  ],
  now,
});
assert(!currencyReview.selected && currencyReview.requiresReview, "Moedas diferentes em empate devem exigir revisão");
console.log("✅ comparação de custo entre moedas não é inventada");

console.log("=== DISPONIBILIDADE CANÔNICA ===");
const availability = deriveCanonicalAvailability({
  canonicalVariantIds: ["v-black-4", "v-purple-8"],
  suppliers: [
    supplier({ id: "p", role: "PRIMARY", mappings: [
      { canonicalVariantId: "v-black-4", active: true, supplierVariant: { id: "p1", sourceSkuId: "p1", sourcePrice: 7, stock: 5 } },
      { canonicalVariantId: "v-purple-8", active: true, supplierVariant: { id: "p2", sourceSkuId: "p2", sourcePrice: 11, stock: 0 } },
    ] }),
    supplier({ id: "b", role: "BACKUP", mappings: [
      { canonicalVariantId: "v-black-4", active: true, supplierVariant: { id: "b1", sourceSkuId: "b1", sourcePrice: 8, stock: 12 } },
      { canonicalVariantId: "v-purple-8", active: true, supplierVariant: { id: "b2", sourceSkuId: "b2", sourcePrice: 12, stock: 4 } },
    ] }),
  ],
  now,
});
assert(availability.find((item) => item.canonicalVariantId === "v-black-4")?.safeStock === 12, "Safe stock deveria usar maior estoque elegível sem somar fontes");
assert(availability.find((item) => item.canonicalVariantId === "v-purple-8")?.safeStock === 4, "Fallback deveria sustentar disponibilidade");
console.log("✅ estoque seguro usa máximo, nunca soma fornecedores potencialmente correlacionados");

console.log("====================================================");
console.log("SUPPLIER SELECTION ENGINE: PASS");
console.log("====================================================");
