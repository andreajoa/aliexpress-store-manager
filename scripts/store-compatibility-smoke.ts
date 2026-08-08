import {
  evaluateStoreCompatibility,
} from "../src/lib/store-compatibility.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function level(report: ReturnType<typeof evaluateStoreCompatibility>, key: string) {
  return report.items.find((item) => item.key === key)?.level;
}

const base = {
  baseUrl: "https://fixture.test",
  apiEndpoint: "https://fixture.test/api/store-connector",
  githubOwner: null,
  githubRepo: null,
  githubBranch: null,
  connectorVersion: "1.1.0",
  intelligenceSource: null,
  lastScannedAt: null,
};

console.log("");
console.log("=== DESCONECTADA ===");
const disconnected = evaluateStoreCompatibility({
  ...base,
  status: "DISCONNECTED",
  connectionType: "GENERIC_API",
  connectorCapabilities: null,
});
assert(disconnected.overall === "BLOCKED", "Loja desconectada deveria estar BLOCKED.");
assert(disconnected.publishable === false, "Loja desconectada nao pode publicar.");
assert(level(disconnected, "connection") === "BLOCKED", "Conexao deveria estar bloqueada.");
console.log("✅ Loja desconectada bloqueada");

console.log("=== CONECTADA SEM ANALISE ===");
const unscanned = evaluateStoreCompatibility({
  ...base,
  status: "ACTIVE",
  connectionType: "GENERIC_API",
  connectorCapabilities: null,
});
assert(level(unscanned, "connection") === "AVAILABLE", "Conexao deveria estar disponivel.");
assert(level(unscanned, "read") === "AVAILABLE", "Leitura deveria estar disponivel.");
assert(level(unscanned, "intelligence") === "LIMITED", "Inteligencia deveria aguardar scan.");
assert(unscanned.publishable === false, "Sem contrato nao pode publicar.");
console.log("✅ Loja conectada sem scan fica limitada");

console.log("=== ANALISADA SEM PUBLICATION TARGET ===");
const scannedReadOnly = evaluateStoreCompatibility({
  ...base,
  status: "ACTIVE",
  connectionType: "GITHUB_VERCEL",
  githubOwner: "example",
  githubRepo: "fixture-store",
  githubBranch: "main",
  intelligenceSource: "manifest",
  lastScannedAt: "2026-08-08T05:00:00.000Z",
  connectorCapabilities: {
    seo: true,
    variants: true,
    githubManagedCatalog: true,
  },
});
assert(level(scannedReadOnly, "intelligence") === "AVAILABLE", "Scan deveria estar disponivel.");
assert(level(scannedReadOnly, "catalog") === "AVAILABLE", "Catalogo gerenciado deveria estar disponivel.");
assert(level(scannedReadOnly, "publication") === "BLOCKED", "Publicacao sem contrato deve bloquear.");
assert(scannedReadOnly.publishable === false, "Manager nao pode inventar publicationTarget.");
console.log("✅ Leitura e catalogo disponiveis sem inventar publicacao");

console.log("=== GITHUB PUBLICATION TARGET VALIDO ===");
const githubReady = evaluateStoreCompatibility({
  ...base,
  status: "ACTIVE",
  connectionType: "GITHUB_VERCEL",
  githubOwner: "example",
  githubRepo: "fixture-store",
  githubBranch: "main",
  intelligenceSource: "manifest",
  lastScannedAt: "2026-08-08T05:00:00.000Z",
  connectorCapabilities: {
    githubManagedCatalog: true,
    publicationTarget: {
      contractVersion: "1",
      kind: "github-catalog",
      adapter: "github-json-catalog-v1",
      catalogPath: "data/products.json",
      editorialAssetsDir: "public/store-manager/products",
    },
  },
});
assert(githubReady.publishable === true, "GitHub contract valido deveria permitir publicacao.");
assert(level(githubReady, "publication") === "AVAILABLE", "Publicacao GitHub deveria estar disponivel.");
assert(githubReady.publicationTarget.valid === true, "Contrato deveria ser valido.");
assert(githubReady.publicationTarget.adapter === "github-json-catalog-v1", "Adapter GitHub incorreto.");
console.log("✅ GitHub compatível para publicacao");

console.log("=== HTTP PUBLICATION TARGET VALIDO ===");
const httpReady = evaluateStoreCompatibility({
  ...base,
  status: "ACTIVE",
  connectionType: "GENERIC_API",
  intelligenceSource: "connector",
  lastScannedAt: "2026-08-08T05:00:00.000Z",
  connectorCapabilities: {
    publicationTarget: {
      contractVersion: "1",
      kind: "http-api",
      adapter: "store-product-api-v1",
      endpointPath: "/products/upsert",
    },
  },
});
assert(httpReady.publishable === true, "HTTP contract valido deveria permitir publicacao.");
assert(level(httpReady, "publication") === "AVAILABLE", "Publicacao HTTP deveria estar disponivel.");
assert(httpReady.publicationTarget.adapter === "store-product-api-v1", "Adapter HTTP incorreto.");
console.log("✅ HTTP compatível para publicacao");

console.log("=== CONTRATO INVALIDO ===");
const invalid = evaluateStoreCompatibility({
  ...base,
  status: "ACTIVE",
  connectionType: "GITHUB_VERCEL",
  githubOwner: "example",
  githubRepo: "fixture-store",
  githubBranch: "main",
  intelligenceSource: "manifest",
  lastScannedAt: "2026-08-08T05:00:00.000Z",
  connectorCapabilities: {
    githubManagedCatalog: true,
    publicationTarget: {
      contractVersion: "999",
      kind: "github-catalog",
      adapter: "github-json-catalog-v1",
      catalogPath: "../products.json",
    },
  },
});
assert(invalid.publishable === false, "Contrato invalido nao pode publicar.");
assert(level(invalid, "publication") === "BLOCKED", "Contrato invalido deveria bloquear publicacao.");
assert(invalid.publicationTarget.valid === false, "Contrato invalido foi aceito.");
assert(invalid.publicationTarget.issues.length > 0, "Motivos do bloqueio deveriam estar presentes.");
console.log("✅ Contrato invalido bloqueado com motivo");

console.log("");
console.log("====================================================");
console.log(" STORE COMPATIBILITY CHECKER: PASS");
console.log("====================================================");
