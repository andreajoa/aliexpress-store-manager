import {
  suggestSupplierVariantMappings,
  validateManualVariantMapping,
} from "../src/lib/supplier-variant-mapper.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const canonical = [
  { id: "c-black-4", name: "Black 4pcs", attributes: { Color: "Black", Kit: "4pcs" } },
  { id: "c-purple-8", name: "Purple 8pcs", attributes: { Color: "Purple", Kit: "8pcs" } },
  { id: "c-green-4", name: "Green 4pcs", attributes: { Color: "Green", Kit: "4pcs" } },
];

const supplier = [
  { id: "s-black-4", sourceSkuId: "sku-101", name: "Black / 4 Pieces", attributes: { Cor: "Preto", Set: "4 pcs" }, price: 710, stock: 32 },
  { id: "s-violet-8", sourceSkuId: "sku-102", name: "Violet / 8PCS", attributes: { Color: "Violet", Kit: "8pcs" }, price: 1290, stock: 17 },
  { id: "s-green-4", sourceSkuId: "sku-103", name: "Green Set 4", attributes: { Color: "Green", Quantity: "4 pieces" }, price: 690, stock: 41 },
  { id: "s-pink-4", sourceSkuId: "sku-104", name: "Pink 4pcs", attributes: { Color: "Pink", Kit: "4pcs" }, price: 690, stock: 22 },
];

console.log("=== AUTO MAPPING ===");
const report = suggestSupplierVariantMappings({
  canonicalVariants: canonical,
  supplierVariants: supplier,
});
assert(report.readyForAutomaticConfirmation, JSON.stringify(report, null, 2));
assert(report.suggestions.find((item) => item.canonicalVariantId === "c-black-4")?.selected?.supplierVariantId === "s-black-4", "Black mapping incorreto");
assert(report.suggestions.find((item) => item.canonicalVariantId === "c-purple-8")?.selected?.supplierVariantId === "s-violet-8", "Purple/Violet alias não reconhecido");
assert(report.suggestions.find((item) => item.canonicalVariantId === "c-green-4")?.selected?.supplierVariantId === "s-green-4", "Green mapping incorreto");
console.log("✅ cor + kit + aliases mapeados automaticamente");

console.log("=== CONFLITO DE KIT ===");
const conflicting = suggestSupplierVariantMappings({
  canonicalVariants: [{ id: "c1", name: "Purple 8pcs" }],
  supplierVariants: [{ id: "s1", sourceSkuId: "sku", name: "Purple 4pcs" }],
});
assert(!conflicting.readyForAutomaticConfirmation, "Kit conflitante não pode auto-confirmar");
assert(conflicting.unmatchedCanonicalVariantIds.includes("c1"), "Kit conflitante precisa ficar sem mapping seguro");
console.log("✅ 8pcs nunca mapeia silenciosamente para 4pcs");

console.log("=== CONFLITO DE COR ===");
const colorConflict = suggestSupplierVariantMappings({
  canonicalVariants: [{ id: "c1", name: "Black 4pcs" }],
  supplierVariants: [{ id: "s1", sourceSkuId: "sku", name: "Pink 4pcs" }],
});
assert(!colorConflict.readyForAutomaticConfirmation, "Cor conflitante não pode auto-confirmar");
console.log("✅ cor incompatível bloqueada");

console.log("=== AMBIGUIDADE ===");
const ambiguous = suggestSupplierVariantMappings({
  canonicalVariants: [{ id: "c1", name: "Purple 8pcs" }],
  supplierVariants: [
    { id: "s1", sourceSkuId: "sku1", name: "Purple 8pcs" },
    { id: "s2", sourceSkuId: "sku2", name: "Violet 8pcs" },
  ],
});
assert(!ambiguous.readyForAutomaticConfirmation, "Duas opções equivalentes devem exigir revisão");
assert(ambiguous.ambiguousCanonicalVariantIds.includes("c1"), "Ambiguidade não reportada");
console.log("✅ empate plausível exige confirmação manual");

console.log("=== MANUAL MAPPING ===");
const manual = validateManualVariantMapping({
  canonicalVariants: canonical,
  supplierVariants: supplier,
  mappings: [
    { canonicalVariantId: "c-black-4", supplierVariantId: "s-black-4" },
    { canonicalVariantId: "c-purple-8", supplierVariantId: "s-violet-8" },
    { canonicalVariantId: "c-green-4", supplierVariantId: "s-green-4" },
  ],
});
assert(manual.valid, manual.issues.join(" | "));
console.log("✅ mapping manual completo e 1:1 aceito");

console.log("=== MANUAL DUPLICADO ===");
const duplicate = validateManualVariantMapping({
  canonicalVariants: canonical.slice(0, 2),
  supplierVariants: supplier.slice(0, 2),
  mappings: [
    { canonicalVariantId: "c-black-4", supplierVariantId: "s-black-4" },
    { canonicalVariantId: "c-purple-8", supplierVariantId: "s-black-4" },
  ],
});
assert(!duplicate.valid, "Supplier variant duplicada deveria bloquear");
console.log("✅ uma supplier variant não pode atender duas variantes canônicas");

console.log("====================================================");
console.log("SUPPLIER VARIANT MAPPER: PASS");
console.log("====================================================");
