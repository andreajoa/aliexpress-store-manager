import {
  buildPublicationPlan,
} from "../src/lib/publication-plan.ts";

import {
  buildRepositoryDryRun,
} from "../src/lib/repository-dry-run.ts";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(
      message
    );
  }
}

const assetBytes =
  new TextEncoder()
    .encode(
      "synthetic-editorial-fixture"
    );

const payload = {
  protocolVersion:
    "2026-08-01",

  product: {
    id:
      "ae-fixture-001",

    sourceProductId:
      "fixture-001",

    title:
      "Produto Fixture",

    slug:
      "produto-fixture",

    headline:
      "Fixture",

    description:
      "Produto sintético.",

    benefits: [
      "Teste",
    ],

    cta:
      "Comprar",

    price:
      4990,

    compareAtPrice:
      6990,

    currency:
      "BRL",

    image:
      "https://example.test/image.jpg",

    gallery: [
      "https://example.test/image.jpg",
    ],

    editorialAssets: [
      {
        id:
          "editorial-fixture",

        type:
          "AI_LIFESTYLE",
      },
    ],

    category:
      "Sensorial",

    ageRange:
      "8 anos ou mais",

    stock:
      15,

    variants: [
      {
        sourceSkuId:
          "sku-1",

        name:
          "Kit 1",

        price:
          4990,

        stock:
          10,

        attributes: {
          Kit:
            "1",
        },

        imageUrl:
          null,
      },

      {
        sourceSkuId:
          "sku-2",

        name:
          "Kit 2",

        price:
          5990,

        stock:
          5,

        attributes: {
          Kit:
            "2",
        },

        imageUrl:
          null,
      },
    ],

    shipping: {
      weightGrams:
        200,

      lengthCm:
        10,

      widthCm:
        10,

      heightCm:
        5,
    },

    seo: {
      title:
        "Produto Fixture",

      description:
        "SEO fixture.",
    },

    source: {
      provider:
        "ALIEXPRESS",

      productId:
        "fixture-001",

      url:
        "https://example.test/source",
    },
  },
};

const plan =
  buildPublicationPlan({
    store: {
      id:
        "store-fixture",

      name:
        "Loja Fixture",

      baseUrl:
        "https://fixture.test",

      connectionType:
        "GITHUB_VERCEL",

      apiEndpoint:
        "https://fixture.test/api/store-connector",

      githubOwner:
        "example",

      githubRepo:
        "fixture-store",

      githubBranch:
        "main",

      status:
        "ACTIVE",

      connectorVersion:
        "1.1.0",

      connectorCapabilities: {
        seo:
          true,

        variants:
          true,

        variantPricing:
          true,

        editorialAssets:
          true,

        inventoryByVariant:
          true,

        previewPublication:
          true,

        githubManagedCatalog:
          true,

        publicationTarget: {
          contractVersion:
            "1",

          kind:
            "github-catalog",

          adapter:
            "github-json-catalog-v1",

          catalogPath:
            "data/products.json",

          editorialAssetsDir:
            "public/store-manager/products",
        },
      },
    },

    publication: {
      id:
        "publication-fixture",

      status:
        "DRAFT",

      externalProductId:
        "ae-fixture-001",

      externalSlug:
        "produto-fixture",

      externalUrl:
        "https://fixture.test/produto/ae-fixture-001",

      targetCategory:
        "Sensorial",

      targetAgeRange:
        "8 anos ou mais",

      targetAgeSource:
        "PACKAGE_LABEL",

      targetAgeEvidence:
        "Fixture sintético.",

      targetAgeVerifiedAt:
        "2026-08-08T03:00:00.000Z",

      payload,
    },

    editorials: [
      {
        id:
          "editorial-fixture",

        type:
          "AI_LIFESTYLE",

        generatedPath:
          "/tmp/editorial-fixture.png",

        auditPassed:
          true,

        fileExists:
          true,
      },
    ],
  });

assert(
  plan.ready,
  "Publication Plan fixture deveria estar ready."
);

const initialCatalog =
  `${JSON.stringify(
    {
      version:
        1,

      products: [
        {
          id:
            "existing-product",

          title:
            "Produto existente",
        },
      ],
    },
    null,
    2
  )}\n`;

const originalSnapshot = {
  files: {
    "data/products.json":
      initialCatalog,
  },
};

const assetSources = {
  "/tmp/editorial-fixture.png":
    assetBytes,
};

console.log("");
console.log(
  "=== PRIMEIRA EXECUCAO ==="
);

const first =
  buildRepositoryDryRun({
    plan,

    snapshot:
      originalSnapshot,

    assetSources,
  });

console.dir(
  first,
  {
    depth: 7,
  }
);

assert(
  first.ready,
  `Primeiro repository dry-run bloqueado: ${JSON.stringify(
    first.blockers
  )}`
);

assert(
  first.summary.modified ===
    1,
  "O catálogo deveria ser modificado."
);

assert(
  first.summary.added ===
    1,
  "O asset deveria ser adicionado."
);

assert(
  first.execution
    .performed
    .filesystemWrites ===
    0 &&
  first.execution
    .performed
    .gitWrites ===
    0 &&
  first.execution
    .performed
    .commits ===
    0 &&
  first.execution
    .performed
    .pullRequests ===
    0 &&
  first.execution
    .performed
    .remoteWrites ===
    0,
  "Repository dry-run executou write real."
);

assert(
  originalSnapshot
    .files[
      "data/products.json"
    ] ===
    initialCatalog,
  "O snapshot de entrada foi mutado."
);

const resultingCatalogRaw =
  first
    .resultingSnapshot
    .files[
      "data/products.json"
    ];

assert(
  typeof resultingCatalogRaw ===
    "string",
  "Catálogo resultante deveria ser texto."
);

const resultingCatalog =
  JSON.parse(
    resultingCatalogRaw
  );

assert(
  Array.isArray(
    resultingCatalog
      .products
  ),
  "products[] ausente."
);

assert(
  resultingCatalog
    .products
    .length ===
    2,
  "O produto existente deveria ser preservado e o fixture adicionado."
);

assert(
  resultingCatalog
    .products
    .some(
      (
        product: {
          id?: string;
        }
      ) =>
        product.id ===
        "existing-product"
    ),
  "Produto existente foi perdido."
);

assert(
  resultingCatalog
    .products
    .some(
      (
        product: {
          id?: string;
        }
      ) =>
        product.id ===
        "ae-fixture-001"
    ),
  "Produto fixture não entrou no catálogo."
);

assert(
  Object.prototype
    .hasOwnProperty
    .call(
      first
        .resultingSnapshot
        .files,
      "public/store-manager/products/ae-fixture-001/editorial-fixture.png"
    ),
  "Asset editorial resultante ausente."
);

console.log("");
console.log(
  "✅ Catálogo recebeu upsert sem perder produto existente"
);

console.log(
  "✅ Asset editorial foi materializado apenas no snapshot resultante"
);

console.log(
  "✅ Entrada permaneceu imutável"
);

console.log(
  "✅ ZERO filesystem/Git/GitHub writes"
);


console.log("");
console.log(
  "=== SEGUNDA EXECUCAO / IDEMPOTENCIA ==="
);

const second =
  buildRepositoryDryRun({
    plan,

    snapshot:
      first
        .resultingSnapshot,

    assetSources,
  });

console.dir(
  second.summary
);

assert(
  second.ready,
  "Segunda execução deveria continuar ready."
);

assert(
  second.summary.added ===
    0 &&
  second.summary.modified ===
    0 &&
  second.summary.unchanged ===
    2,
  "Segunda execução deveria ser totalmente idempotente."
);

console.log(
  "✅ Segunda execução: ZERO add / ZERO modify"
);

console.log(
  "✅ Adapter idempotente"
);


console.log("");
console.log(
  "=== FAIL CLOSED — CATALOGO AUSENTE ==="
);

const missingCatalog =
  buildRepositoryDryRun({
    plan,

    snapshot: {
      files: {},
    },

    assetSources,
  });

assert(
  !missingCatalog.ready,
  "Snapshot sem catálogo deveria ser bloqueado."
);

assert(
  missingCatalog
    .blockers
    .some(
      item =>
        item.code ===
        "CATALOG_FILE_MISSING"
    ),
  "Blocker CATALOG_FILE_MISSING ausente."
);

assert(
  missingCatalog
    .changes
    .length ===
    0,
  "Fluxo bloqueado não deveria gerar alterações."
);

console.log(
  "✅ Catálogo ausente bloqueado sem alteração parcial"
);


console.log("");
console.log(
  "=== FAIL CLOSED — ASSET AUSENTE ==="
);

const missingAsset =
  buildRepositoryDryRun({
    plan,

    snapshot:
      originalSnapshot,

    assetSources: {},
  });

assert(
  !missingAsset.ready,
  "Asset ausente deveria bloquear."
);

assert(
  missingAsset
    .blockers
    .some(
      item =>
        item.code ===
        "EDITORIAL_SOURCE_CONTENT_MISSING"
    ),
  "Blocker EDITORIAL_SOURCE_CONTENT_MISSING ausente."
);

assert(
  missingAsset
    .changes
    .length ===
    0,
  "Asset ausente não pode gerar alteração parcial."
);

console.log(
  "✅ Asset ausente bloqueado sem alteração parcial"
);


console.log("");
console.log(
  "===================================================="
);

console.log(
  " REPOSITORY DRY-RUN SMOKE: PASS"
);

console.log(
  " ZERO WRITES REAIS"
);

console.log(
  "===================================================="
);
