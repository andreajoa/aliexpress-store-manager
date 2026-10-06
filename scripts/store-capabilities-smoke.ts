import assert from "node:assert/strict";
import { mergeScannedCapabilities } from "../src/lib/store-capabilities.ts";

const existing = {
  ambBridge: { version: 1, mode: "backend-only", products: { "ava-cami": { sourceProductId: "1", color: "WHITE" } } },
  ambCatalogScan: { version: 1, totalProducts: 463 },
  ambExportLineage: { version: 1, exports: [] },
  publicationTarget: { old: true },
};

// Análise em fallback devolve {}: vínculos e varredura precisam continuar.
const fallback = mergeScannedCapabilities(existing, {});
assert.deepEqual(fallback.ambBridge, existing.ambBridge);
assert.deepEqual(fallback.ambCatalogScan, existing.ambCatalogScan);
assert.deepEqual(fallback.ambExportLineage, existing.ambExportLineage);
assert.equal("publicationTarget" in fallback, false, "chaves do conector vêm da nova análise");

// Análise completa atualiza as chaves do conector sem tocar nas do Manager.
const scanned = mergeScannedCapabilities(existing, { publicationTarget: { v: 2 }, ambBridge: { forged: true } });
assert.deepEqual(scanned.publicationTarget, { v: 2 });
assert.deepEqual(scanned.ambBridge, existing.ambBridge, "a análise não pode sobrescrever vínculos");

// Loja sem dados do Manager continua igual ao comportamento anterior.
assert.deepEqual(mergeScannedCapabilities(null, { a: 1 }), { a: 1 });
assert.deepEqual(mergeScannedCapabilities({}, {}), {});
console.log("store capabilities smoke: OK");
