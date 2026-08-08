import {
  parsePublicationTargetContract,
} from "../src/lib/publication-target-contract.ts";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function hasIssue(
  result: ReturnType<typeof parsePublicationTargetContract>,
  code: string
) {
  return result.issues.some(
    item => item.code === code
  );
}

console.log("");
console.log("=== CONTRATO AUSENTE ===");

const missing =
  parsePublicationTargetContract({
    seo: true,
  });

assert(
  missing.present === false,
  "Contrato ausente deveria ter present=false."
);

assert(
  missing.valid === false,
  "Contrato ausente deveria ser invalido."
);

assert(
  hasIssue(
    missing,
    "PUBLICATION_TARGET_MISSING"
  ),
  "Issue de contrato ausente nao encontrada."
);

console.log("✅ Ausencia bloqueada");

console.log("");
console.log("=== GITHUB CONTRACT VALIDO ===");

const github =
  parsePublicationTargetContract({
    publicationTarget: {
      contractVersion: "1",
      kind: "github-catalog",
      adapter: "github-json-catalog-v1",
      catalogPath: "data/products.json",
      editorialAssetsDir:
        "public/store-manager/products",
    },
  });

assert(
  github.valid === true,
  JSON.stringify(github)
);

assert(
  github.target?.kind ===
    "github-catalog",
  "Target GitHub nao normalizado."
);

console.log("✅ GitHub contract valido");

console.log("");
console.log("=== GITHUB + VERCEL PREVIEW VALIDO ===");

const githubPreview = parsePublicationTargetContract({
  publicationTarget: {
    contractVersion: "1",
    kind: "github-catalog",
    adapter: "github-json-catalog-v1",
    catalogPath: "data/products.json",
    preview: {
      provider: "vercel",
      projectId: "prj_Abc123",
      teamId: "team_Xyz789",
    },
  },
});

assert(githubPreview.valid === true, JSON.stringify(githubPreview));
assert(
  githubPreview.target?.kind === "github-catalog" &&
    githubPreview.target.preview?.provider === "vercel" &&
    githubPreview.target.preview.projectId === "prj_Abc123",
  "Preview Vercel nao normalizado.",
);
console.log("✅ Preview Vercel normalizado");

console.log("");
console.log("=== VERCEL PREVIEW INVALIDO ===");

const invalidPreview = parsePublicationTargetContract({
  publicationTarget: {
    contractVersion: "1",
    kind: "github-catalog",
    adapter: "github-json-catalog-v1",
    catalogPath: "data/products.json",
    preview: {
      provider: "vercel",
      projectId: "project-sem-prefixo",
      teamId: "team_Xyz789",
    },
  },
});

assert(invalidPreview.valid === false, "Preview Vercel invalido foi aceito.");
assert(
  hasIssue(invalidPreview, "PUBLICATION_TARGET_PREVIEW_PROJECT_INVALID"),
  "Issue de projectId Vercel ausente.",
);
console.log("✅ Preview Vercel invalido bloqueado");

console.log("");
console.log("=== PATH TRAVERSAL ===");

const traversal =
  parsePublicationTargetContract({
    publicationTarget: {
      contractVersion: "1",
      kind: "github-catalog",
      adapter: "github-json-catalog-v1",
      catalogPath: "../products.json",
    },
  });

assert(
  traversal.valid === false,
  "Path traversal foi aceito."
);

assert(
  hasIssue(
    traversal,
    "PUBLICATION_TARGET_CATALOG_PATH_INVALID"
  ),
  "Issue de path traversal ausente."
);

console.log("✅ Path traversal bloqueado");

console.log("");
console.log("=== VERSAO DESCONHECIDA ===");

const wrongVersion =
  parsePublicationTargetContract({
    publicationTarget: {
      contractVersion: "999",
      kind: "github-catalog",
      adapter: "github-json-catalog-v1",
      catalogPath: "data/products.json",
    },
  });

assert(
  wrongVersion.valid === false,
  "Versao desconhecida foi aceita."
);

assert(
  hasIssue(
    wrongVersion,
    "PUBLICATION_TARGET_VERSION_UNSUPPORTED"
  ),
  "Issue de versao ausente."
);

console.log("✅ Versao desconhecida bloqueada");

console.log("");
console.log("=== ADAPTER DESCONHECIDO ===");

const wrongAdapter =
  parsePublicationTargetContract({
    publicationTarget: {
      contractVersion: "1",
      kind: "github-catalog",
      adapter: "unknown-adapter",
      catalogPath: "data/products.json",
    },
  });

assert(
  wrongAdapter.valid === false,
  "Adapter desconhecido foi aceito."
);

assert(
  hasIssue(
    wrongAdapter,
    "PUBLICATION_TARGET_ADAPTER_UNSUPPORTED"
  ),
  "Issue de adapter ausente."
);

console.log("✅ Adapter desconhecido bloqueado");

console.log("");
console.log("=== HTTP CONTRACT VALIDO ===");

const http =
  parsePublicationTargetContract({
    publicationTarget: {
      contractVersion: "1",
      kind: "http-api",
      adapter: "store-product-api-v1",
      endpointPath: "/products/upsert",
    },
  });

assert(
  http.valid === true,
  JSON.stringify(http)
);

assert(
  http.target?.kind === "http-api",
  "Target HTTP nao normalizado."
);

console.log("✅ HTTP contract valido");

console.log("");
console.log("=== HTTP ENDPOINT INSEGURO ===");

const unsafeHttp =
  parsePublicationTargetContract({
    publicationTarget: {
      contractVersion: "1",
      kind: "http-api",
      adapter: "store-product-api-v1",
      endpointPath:
        "//evil.example/write",
    },
  });

assert(
  unsafeHttp.valid === false,
  "Endpoint HTTP inseguro foi aceito."
);

assert(
  hasIssue(
    unsafeHttp,
    "PUBLICATION_TARGET_ENDPOINT_INVALID"
  ),
  "Issue de endpoint inseguro ausente."
);

console.log("✅ Endpoint inseguro bloqueado");

console.log("");
console.log("====================================================");
console.log(" PUBLICATION TARGET CONTRACT: PASS");
console.log("====================================================");
