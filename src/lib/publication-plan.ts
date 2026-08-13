import {
  parsePublicationTargetContract,
} from "./publication-target-contract.ts";

export const PUBLICATION_PROTOCOL =
  "2026-08-01";

export type PublicationPlanStore = {
  id: string;
  name: string;
  baseUrl: string;
  connectionType: string;
  apiEndpoint: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
  status: string;
  connectorVersion: string | null;
  connectorCapabilities: unknown;
};

export type PublicationPlanDraft = {
  id: string;
  status: string;

  externalProductId:
    string | null;

  externalSlug:
    string | null;

  externalUrl:
    string | null;

  targetCategory:
    string | null;

  targetAgeRange:
    string | null;

  targetAgeSource:
    string | null;

  targetAgeEvidence:
    string | null;

  targetAgeVerifiedAt:
    string | null;

  payload: unknown;
};

export type PublicationPlanEditorial = {
  id: string;
  type: string;
  generatedPath: string | null;
  auditPassed: boolean;
  fileExists: boolean;
};

export type PublicationPlanInput = {
  store:
    PublicationPlanStore;

  publication:
    PublicationPlanDraft;

  editorials:
    PublicationPlanEditorial[];
};

export type PublicationPlanCheck = {
  code: string;

  status:
    | "pass"
    | "block"
    | "warning";

  label: string;
  detail: string;
};

export type PublicationPlanOperation = {
  order: number;

  kind:
    | "git.branch.create"
    | "catalog.product.upsert"
    | "editorial.asset.copy"
    | "git.commit.create"
    | "github.pull-request.open"
    | "preview.verify"
    | "http.product.upsert";

  target: string;

  path:
    | string
    | null;

  description: string;

  remoteWriteRequired:
    boolean;

  content?: unknown;
};

export type PublicationPlan = {
  dryRun: true;

  ready: boolean;

  protocolVersion:
    string;

  adapter: {
    transport:
      | "github"
      | "http"
      | "unsupported";

    kind:
      string | null;

    id:
      string | null;

    contractResolved:
      boolean;
  };

  target: {
    storeId: string;
    storeName: string;

    repository:
      string | null;

    baseBranch:
      string | null;

    futureBranch:
      string | null;

    futureUrl:
      string | null;
  };

  summary: {
    productId:
      string | null;

    title:
      string | null;

    variants:
      number;

    totalStock:
      number;

    galleryImages:
      number;

    editorialAssets:
      number;
  };

  checks:
    PublicationPlanCheck[];

  blockers:
    Array<{
      code: string;
      detail: string;
    }>;

  warnings:
    Array<{
      code: string;
      detail: string;
    }>;

  operations:
    PublicationPlanOperation[];

  execution: {
    mode: "dry-run";

    performed: {
      githubWrites: 0;
      commits: 0;
      pullRequests: 0;
      vercelDeployments: 0;
      productionWrites: 0;
    };

    planned: {
      githubWrites: number;
      commits: number;
      pullRequests: number;
      previewVerifications:
        number;
      httpWrites: number;
    };
  };
};

function objectValue(
  value: unknown
): Record<
  string,
  unknown
> {
  return value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
    ? value as Record<
        string,
        unknown
      >
    : {};
}

function stringValue(
  value: unknown
) {
  return typeof value ===
      "string" &&
    value.trim()
    ? value.trim()
    : null;
}

function booleanCapability(
  capabilities:
    Record<
      string,
      unknown
    >,

  key:
    string
) {
  return capabilities[
    key
  ] === true;
}

function safeRepoPath(
  value: string | null
) {
  if (!value) {
    return false;
  }

  if (
    value.startsWith(
      "/"
    ) ||
    value.includes(
      "\\"
    )
  ) {
    return false;
  }

  const parts =
    value.split("/");

  if (
    parts.some(
      part =>
        !part ||
        part === "." ||
        part === ".."
    )
  ) {
    return false;
  }

  return true;
}

function cleanDirectory(
  value: string
) {
  return value.replace(
    /\/+$/,
    ""
  );
}

function safeBranchPart(
  value: string
) {
  return value
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9._-]+/g,
      "-"
    )
    .replace(
      /^[-.]+|[-.]+$/g,
      ""
    )
    .slice(
      0,
      70
    ) ||
    "product";
}

function uniqueNumericValues(
  values:
    unknown[]
) {
  const result =
    new Set<number>();

  for (
    const value
    of values
  ) {
    const numeric =
      Number(value);

    if (
      Number.isFinite(
        numeric
      )
    ) {
      result.add(
        numeric
      );
    }
  }

  return result;
}

function absoluteHttpUrl(
  baseUrl:
    string,

  pathname:
    string
) {
  const base =
    baseUrl.replace(
      /\/+$/,
      ""
    );

  const path =
    pathname.startsWith(
      "/"
    )
      ? pathname
      : `/${pathname}`;

  return `${base}${path}`;
}

export function buildPublicationPlan(
  input:
    PublicationPlanInput
): PublicationPlan {
  const checks:
    PublicationPlanCheck[] =
    [];

  const blockers:
    Array<{
      code: string;
      detail: string;
    }> = [];

  const warnings:
    Array<{
      code: string;
      detail: string;
    }> = [];

  const operations:
    PublicationPlanOperation[] =
    [];

  function pass(
    code:
      string,

    label:
      string,

    detail:
      string
  ) {
    checks.push({
      code,
      status:
        "pass",
      label,
      detail,
    });
  }

  function block(
    code:
      string,

    label:
      string,

    detail:
      string
  ) {
    checks.push({
      code,
      status:
        "block",
      label,
      detail,
    });

    blockers.push({
      code,
      detail,
    });
  }

  function warning(
    code:
      string,

    label:
      string,

    detail:
      string
  ) {
    checks.push({
      code,
      status:
        "warning",
      label,
      detail,
    });

    warnings.push({
      code,
      detail,
    });
  }

  const {
    store,
    publication,
  } = input;

  const capabilities =
    objectValue(
      store
        .connectorCapabilities
    );

  const publicationTarget =
    objectValue(
      capabilities
        .publicationTarget
    );

  const publicationTargetContract =
    parsePublicationTargetContract(
      capabilities
    );

  const targetKind =
    stringValue(
      publicationTarget
        .kind
    );

  const targetAdapter =
    stringValue(
      publicationTarget
        .adapter
    );

  const payload =
    objectValue(
      publication.payload
    );

  const product =
    objectValue(
      payload.product
    );

  const payloadAvailable =
    Object.keys(
      product
    ).length >
    0;

  const productId =
    stringValue(
      product.id
    );

  const productTitle =
    stringValue(
      product.title
    );

  const gallery =
    Array.isArray(
      product.gallery
    )
      ? product.gallery
      : [];

  const variants =
    Array.isArray(
      product.variants
    )
      ? product.variants
      : [];

  const editorialRefs =
    Array.isArray(
      product.editorialAssets
    )
      ? product
          .editorialAssets
      : [];

  const totalStockValue =
    Number(
      product.stock
    );

  const totalStock =
    Number.isFinite(
      totalStockValue
    )
      ? totalStockValue
      : 0;

  const variantPrices =
    uniqueNumericValues(
      variants.map(
        variant =>
          objectValue(
            variant
          ).price
      )
    );

  const repository =
    store.githubOwner &&
    store.githubRepo
      ? `${store.githubOwner}/${store.githubRepo}`
      : null;

  const baseBranch =
    store.githubBranch ||
    null;

  const branchSeed =
    publication
      .externalProductId ||
    productId ||
    publication.id;

  const futureBranch =
    store.connectionType ===
      "GITHUB_VERCEL"
      ? `store-manager/product-${safeBranchPart(
          branchSeed
        )}`
      : null;

  if (
    store.status ===
    "ACTIVE"
  ) {
    pass(
      "STORE_ACTIVE",
      "Loja ativa",
      "A loja está ativa no Store Manager."
    );
  } else {
    block(
      "STORE_NOT_ACTIVE",
      "Loja ativa",
      `A loja está com status ${store.status}.`
    );
  }

  if (
    publication.status ===
    "DRAFT"
  ) {
    pass(
      "PUBLICATION_DRAFT",
      "Publication em DRAFT",
      "O dry-run opera somente sobre uma publicação em preparação."
    );
  } else {
    block(
      "PUBLICATION_NOT_DRAFT",
      "Publication em DRAFT",
      `Status atual: ${publication.status}.`
    );
  }

  const ageProvenanceValid =
    Boolean(
      publication
        .targetAgeRange &&
      publication
        .targetAgeSource &&
      publication
        .targetAgeEvidence &&
      publication
        .targetAgeVerifiedAt
    );

  if (
    ageProvenanceValid
  ) {
    pass(
      "AGE_PROVENANCE_VALID",
      "Faixa etária verificada",
      "Faixa etária, fonte, evidência e data de verificação estão registradas."
    );
  } else {
    block(
      "AGE_PROVENANCE_MISSING",
      "Faixa etária verificada",
      "A publicação não possui faixa etária com proveniência completa."
    );
  }

  if (
    publication
      .targetCategory
  ) {
    pass(
      "TARGET_CATEGORY_SET",
      "Categoria definida",
      publication
        .targetCategory
    );
  } else {
    block(
      "TARGET_CATEGORY_MISSING",
      "Categoria definida",
      "Nenhuma categoria de destino foi definida."
    );
  }

  if (
    payloadAvailable
  ) {
    pass(
      "PUBLICATION_PAYLOAD_PRESENT",
      "Payload disponível",
      "Existe payload preparado para o produto."
    );
  } else {
    block(
      "PUBLICATION_PAYLOAD_MISSING",
      "Payload disponível",
      "O DRAFT não possui payload de publicação válido."
    );
  }

  if (
    payloadAvailable
  ) {
    const protocol =
      stringValue(
        payload
          .protocolVersion
      );

    if (
      protocol ===
      PUBLICATION_PROTOCOL
    ) {
      pass(
        "PROTOCOL_SUPPORTED",
        "Protocolo compatível",
        PUBLICATION_PROTOCOL
      );
    } else {
      block(
        "PROTOCOL_UNSUPPORTED",
        "Protocolo compatível",
        `Recebido: ${protocol || "ausente"}. Esperado: ${PUBLICATION_PROTOCOL}.`
      );
    }

    if (
      productId &&
      productId ===
        publication
          .externalProductId
    ) {
      pass(
        "PRODUCT_ID_MATCH",
        "ID externo consistente",
        productId
      );
    } else {
      block(
        "PRODUCT_ID_MISMATCH",
        "ID externo consistente",
        "O ID do payload não corresponde ao ID externo da Publication."
      );
    }

    const payloadCategory =
      stringValue(
        product.category
      );

    if (
      payloadCategory &&
      payloadCategory ===
        publication
          .targetCategory
    ) {
      pass(
        "CATEGORY_MATCH",
        "Categoria consistente",
        payloadCategory
      );
    } else {
      block(
        "CATEGORY_MISMATCH",
        "Categoria consistente",
        "A categoria do payload não corresponde à categoria registrada na Publication."
      );
    }

    const payloadAgeRange =
      stringValue(
        product.ageRange
      );

    if (
      payloadAgeRange &&
      payloadAgeRange ===
        publication
          .targetAgeRange
    ) {
      pass(
        "AGE_RANGE_MATCH",
        "Faixa etária consistente",
        payloadAgeRange
      );
    } else {
      block(
        "AGE_RANGE_MISMATCH",
        "Faixa etária consistente",
        "A faixa etária do payload não corresponde à faixa etária verificada da Publication."
      );
    }

    if (
      variants.length >
      0
    ) {
      if (
        booleanCapability(
          capabilities,
          "variants"
        )
      ) {
        pass(
          "CAP_VARIANTS",
          "Suporte a variantes",
          `${variants.length} variante(s).`
        );
      } else {
        block(
          "CAP_VARIANTS_MISSING",
          "Suporte a variantes",
          "O produto possui variantes, mas a loja não declara suporte a variantes."
        );
      }

      if (
        booleanCapability(
          capabilities,
          "inventoryByVariant"
        )
      ) {
        pass(
          "CAP_VARIANT_INVENTORY",
          "Estoque por variante",
          "A loja declara inventoryByVariant."
        );
      } else {
        block(
          "CAP_VARIANT_INVENTORY_MISSING",
          "Estoque por variante",
          "A loja não declara suporte a estoque por variante."
        );
      }
    }

    if (
      variantPrices.size >
      1
    ) {
      if (
        booleanCapability(
          capabilities,
          "variantPricing"
        )
      ) {
        pass(
          "CAP_VARIANT_PRICING",
          "Preço por variante",
          `${variantPrices.size} preços distintos encontrados.`
        );
      } else {
        block(
          "CAP_VARIANT_PRICING_MISSING",
          "Preço por variante",
          "O produto possui preços distintos entre variantes, mas a loja não declara variantPricing."
        );
      }
    }

    if (
      editorialRefs.length >
      0
    ) {
      if (
        booleanCapability(
          capabilities,
          "editorialAssets"
        )
      ) {
        pass(
          "CAP_EDITORIAL_ASSETS",
          "Assets editoriais",
          `${editorialRefs.length} asset(s) editorial(is).`
        );
      } else {
        block(
          "CAP_EDITORIAL_ASSETS_MISSING",
          "Assets editoriais",
          "O payload contém imagens editoriais, mas a loja não declara editorialAssets."
        );
      }
    }

    const seo =
      objectValue(
        product.seo
      );

    if (
      stringValue(
        seo.title
      ) ||
      stringValue(
        seo.description
      )
    ) {
      if (
        booleanCapability(
          capabilities,
          "seo"
        )
      ) {
        pass(
          "CAP_SEO",
          "SEO",
          "A loja declara suporte a SEO."
        );
      } else {
        block(
          "CAP_SEO_MISSING",
          "SEO",
          "O payload contém SEO, mas a loja não declara suporte."
        );
      }
    }

    if (
      booleanCapability(
        capabilities,
        "previewPublication"
      )
    ) {
      pass(
        "CAP_PREVIEW_PUBLICATION",
        "Preview antes da produção",
        "A loja declara previewPublication."
      );
    } else {
      block(
        "CAP_PREVIEW_PUBLICATION_MISSING",
        "Preview antes da produção",
        "O fluxo seguro exige previewPublication."
      );
    }

    const editorialSourceMap =
      new Map(
        input.editorials.map(
          asset => [
            asset.id,
            asset,
          ]
        )
      );

    for (
      const reference
      of editorialRefs
    ) {
      const item =
        objectValue(
          reference
        );

      const id =
        stringValue(
          item.id
        );

      if (!id) {
        block(
          "EDITORIAL_REFERENCE_INVALID",
          "Referência editorial",
          "Há um asset editorial sem ID válido no payload."
        );

        continue;
      }

      const source =
        editorialSourceMap.get(
          id
        );

      if (!source) {
        block(
          "EDITORIAL_SOURCE_MISSING",
          "Arquivo editorial disponível",
          `Asset ${id}: registro selecionado não encontrado.`
        );

        continue;
      }

      if (
        !source
          .auditPassed
      ) {
        block(
          "EDITORIAL_AUDIT_FAILED",
          "Auditoria editorial",
          `Asset ${id}: auditoria não aprovada.`
        );
      }

      if (
        !source
          .generatedPath
      ) {
        block(
          "EDITORIAL_PATH_MISSING",
          "Arquivo editorial disponível",
          `Asset ${id}: generatedPath ausente.`
        );
      }

      if (
        !source
          .fileExists
      ) {
        block(
          "EDITORIAL_FILE_MISSING",
          "Arquivo editorial disponível",
          `Asset ${id}: arquivo físico ausente.`
        );
      }
    }
  }

  let transport:
    "github" |
    "http" |
    "unsupported" =
    "unsupported";

  if (
    store.connectionType ===
    "GITHUB_VERCEL"
  ) {
    transport =
      "github";

    if (
      repository
    ) {
      pass(
        "GITHUB_REPOSITORY_SET",
        "Repositório configurado",
        repository
      );
    } else {
      block(
        "GITHUB_REPOSITORY_MISSING",
        "Repositório configurado",
        "githubOwner/githubRepo ausentes."
      );
    }

    if (
      baseBranch
    ) {
      pass(
        "GITHUB_BASE_BRANCH_SET",
        "Branch base configurada",
        baseBranch
      );
    } else {
      block(
        "GITHUB_BASE_BRANCH_MISSING",
        "Branch base configurada",
        "Nenhuma branch base foi configurada."
      );
    }

    if (
      booleanCapability(
        capabilities,
        "githubManagedCatalog"
      )
    ) {
      pass(
        "CAP_GITHUB_MANAGED_CATALOG",
        "Catálogo gerenciado por GitHub",
        "A capability githubManagedCatalog está ativa."
      );
    } else {
      block(
        "CAP_GITHUB_MANAGED_CATALOG_MISSING",
        "Catálogo gerenciado por GitHub",
        "A loja não declara githubManagedCatalog."
      );
    }
  } else if (
    store.connectionType ===
    "GENERIC_API"
  ) {
    transport =
      "http";

    if (
      store.apiEndpoint
    ) {
      pass(
        "API_ENDPOINT_SET",
        "Endpoint de publicação",
        store.apiEndpoint
      );
    } else {
      block(
        "API_ENDPOINT_MISSING",
        "Endpoint de publicação",
        "A loja GENERIC_API não possui apiEndpoint."
      );
    }
  } else {
    block(
      "CONNECTION_TYPE_UNSUPPORTED",
      "Tipo de conexão",
      `Tipo não suportado: ${store.connectionType}.`
    );
  }

  const contractResolved =
    publicationTargetContract
      .valid;

  if (
    contractResolved
  ) {
    pass(
      "PUBLICATION_TARGET_CONTRACT",
      "Contrato de escrita",
      `${targetKind} / ${targetAdapter} — contrato v1`
    );
  } else {
    const detail =
      publicationTargetContract
        .issues
        .map(
          issue =>
            issue.detail
        )
        .join(" ");

    block(
      publicationTargetContract
        .present
        ? "PUBLICATION_TARGET_CONTRACT_INVALID"
        : "PUBLICATION_TARGET_CONTRACT_MISSING",

      "Contrato de escrita",

      detail ||
        "O contrato de escrita do conector é inválido."
    );
  }

  let catalogPath:
    string | null =
    null;

  let editorialAssetsDir:
    string | null =
    null;

  let endpointPath:
    string | null =
    null;

  if (
    contractResolved &&
    transport ===
      "github"
  ) {
    if (
      targetKind !==
      "github-catalog"
    ) {
      block(
        "PUBLICATION_TARGET_KIND_MISMATCH",
        "Contrato GitHub",
        `Esperado kind=github-catalog; recebido ${targetKind}.`
      );
    }

    if (
      targetAdapter !==
      "github-json-catalog-v1"
    ) {
      block(
        "PUBLICATION_ADAPTER_UNSUPPORTED",
        "Adapter suportado",
        `Adapter não implementado pelo planner: ${targetAdapter}.`
      );
    }

    catalogPath =
      stringValue(
        publicationTarget
          .catalogPath
      );

    if (
      catalogPath &&
      safeRepoPath(
        catalogPath
      )
    ) {
      pass(
        "CATALOG_PATH_VALID",
        "Caminho do catálogo",
        catalogPath
      );
    } else {
      block(
        "CATALOG_PATH_INVALID",
        "Caminho do catálogo",
        "publicationTarget.catalogPath está ausente ou não é um caminho relativo seguro."
      );
    }

    if (
      editorialRefs.length >
      0
    ) {
      editorialAssetsDir =
        stringValue(
          publicationTarget
            .editorialAssetsDir
        );

      if (
        editorialAssetsDir &&
        safeRepoPath(
          editorialAssetsDir
        )
      ) {
        pass(
          "EDITORIAL_DIR_VALID",
          "Diretório editorial",
          editorialAssetsDir
        );
      } else {
        block(
          "EDITORIAL_DIR_INVALID",
          "Diretório editorial",
          "Há editoriais no payload, mas publicationTarget.editorialAssetsDir está ausente ou inválido."
        );
      }
    }
  }

  if (
    contractResolved &&
    transport ===
      "http"
  ) {
    if (
      targetKind !==
      "http-api"
    ) {
      block(
        "PUBLICATION_TARGET_KIND_MISMATCH",
        "Contrato HTTP",
        `Esperado kind=http-api; recebido ${targetKind}.`
      );
    }

    if (
      targetAdapter !==
      "store-product-api-v1"
    ) {
      block(
        "PUBLICATION_ADAPTER_UNSUPPORTED",
        "Adapter suportado",
        `Adapter não implementado pelo planner: ${targetAdapter}.`
      );
    }

    endpointPath =
      stringValue(
        publicationTarget
          .endpointPath
      );

    if (
      endpointPath &&
      endpointPath.startsWith(
        "/"
      )
    ) {
      pass(
        "HTTP_PUBLICATION_PATH_VALID",
        "Rota HTTP de publicação",
        endpointPath
      );
    } else {
      block(
        "HTTP_PUBLICATION_PATH_INVALID",
        "Rota HTTP de publicação",
        "publicationTarget.endpointPath precisa começar com /."
      );
    }
  }

  if (
    !publication.externalUrl
  ) {
    block(
      "FUTURE_URL_MISSING",
      "URL futura",
      "Publication.externalUrl está ausente."
    );
  } else {
    pass(
      "FUTURE_URL_SET",
      "URL futura",
      publication
        .externalUrl
    );
  }

  if (
    transport ===
      "github" &&
    contractResolved
  ) {
    warning(
      "REPOSITORY_SNAPSHOT_NOT_LOADED",
      "Snapshot do repositório",
      "Este V1 planeja a mutação lógica. O diff final do arquivo de catálogo dependerá de um snapshot local do repositório na próxima etapa."
    );
  }

  const ready =
    blockers.length ===
    0;

  if (
    ready &&
    payloadAvailable
  ) {
    let order =
      1;

    if (
      transport ===
        "github" &&
      repository &&
      baseBranch &&
      futureBranch &&
      catalogPath
    ) {
      operations.push({
        order:
          order++,

        kind:
          "git.branch.create",

        target:
          `${repository}:${futureBranch}`,

        path:
          null,

        description:
          `Criar branch futura a partir de ${baseBranch}.`,

        remoteWriteRequired:
          true,
      });

      operations.push({
        order:
          order++,

        kind:
          "catalog.product.upsert",

        target:
          repository,

        path:
          catalogPath,

        description:
          `Inserir ou atualizar o produto ${productId}.`,

        remoteWriteRequired:
          true,

        content:
          product,
      });

      if (
        editorialAssetsDir
      ) {
        const directory =
          cleanDirectory(
            editorialAssetsDir
          );

        for (
          const reference
          of editorialRefs
        ) {
          const ref =
            objectValue(
              reference
            );

          const id =
            stringValue(
              ref.id
            );

          if (!id) {
            continue;
          }

          const source =
            input.editorials.find(
              asset =>
                asset.id ===
                id
            );

          operations.push({
            order:
              order++,

            kind:
              "editorial.asset.copy",

            target:
              repository,

            path:
              `${directory}/${productId}/${id}.png`,

            description:
              `Copiar asset editorial ${id} para o repositório.`,

            remoteWriteRequired:
              true,

            content: {
              sourcePath:
                source
                  ?.generatedPath ||
                null,

              assetType:
                source
                  ?.type ||
                null,
            },
          });
        }
      }

      operations.push({
        order:
          order++,

        kind:
          "git.commit.create",

        target:
          repository,

        path:
          null,

        description:
          `Criar commit para ${productTitle || productId || "produto"}.`,

        remoteWriteRequired:
          true,
      });

      operations.push({
        order:
          order++,

        kind:
          "github.pull-request.open",

        target:
          repository,

        path:
          null,

        description:
          `Abrir PR de ${futureBranch} para ${baseBranch}.`,

        remoteWriteRequired:
          true,
      });

      operations.push({
        order:
          order++,

        kind:
          "preview.verify",

        target:
          publication
            .externalUrl ||
          store.baseUrl,

        path:
          null,

        description:
          "Validar futura página, variantes, preços, imagens e SEO no Preview antes de qualquer merge.",

        remoteWriteRequired:
          false,
      });
    }

    if (
      transport ===
        "http" &&
      store.apiEndpoint &&
      endpointPath
    ) {
      operations.push({
        order:
          order++,

        kind:
          "http.product.upsert",

        target:
          absoluteHttpUrl(
            store.apiEndpoint,
            endpointPath
          ),

        path:
          endpointPath,

        description:
          `Enviar payload do produto ${productId} para o endpoint declarado pelo conector.`,

        remoteWriteRequired:
          true,

        content:
          payload,
      });

      operations.push({
        order:
          order++,

        kind:
          "preview.verify",

        target:
          publication
            .externalUrl ||
          store.baseUrl,

        path:
          null,

        description:
          "Validar a publicação em ambiente de preview antes da produção.",

        remoteWriteRequired:
          false,
      });
    }
  }

  const plannedGithubWrites =
    operations.filter(
      operation =>
        operation
          .remoteWriteRequired &&
        (
          operation.kind
            .startsWith(
              "git."
            ) ||
          operation.kind
            .startsWith(
              "github."
            ) ||
          operation.kind ===
            "catalog.product.upsert" ||
          operation.kind ===
            "editorial.asset.copy"
        )
    ).length;

  const plannedCommits =
    operations.filter(
      operation =>
        operation.kind ===
        "git.commit.create"
    ).length;

  const plannedPullRequests =
    operations.filter(
      operation =>
        operation.kind ===
        "github.pull-request.open"
    ).length;

  const plannedPreviewVerifications =
    operations.filter(
      operation =>
        operation.kind ===
        "preview.verify"
    ).length;

  const plannedHttpWrites =
    operations.filter(
      operation =>
        operation.kind ===
        "http.product.upsert"
    ).length;

  return {
    dryRun:
      true,

    ready,

    protocolVersion:
      PUBLICATION_PROTOCOL,

    adapter: {
      transport,

      kind:
        targetKind,

      id:
        targetAdapter,

      contractResolved,
    },

    target: {
      storeId:
        store.id,

      storeName:
        store.name,

      repository,

      baseBranch,

      futureBranch,

      futureUrl:
        publication
          .externalUrl,
    },

    summary: {
      productId,

      title:
        productTitle,

      variants:
        variants.length,

      totalStock,

      galleryImages:
        gallery.length,

      editorialAssets:
        editorialRefs.length,
    },

    checks,

    blockers,

    warnings,

    operations,

    execution: {
      mode:
        "dry-run",

      performed: {
        githubWrites:
          0,

        commits:
          0,

        pullRequests:
          0,

        vercelDeployments:
          0,

        productionWrites:
          0,
      },

      planned: {
        githubWrites:
          plannedGithubWrites,

        commits:
          plannedCommits,

        pullRequests:
          plannedPullRequests,

        previewVerifications:
          plannedPreviewVerifications,

        httpWrites:
          plannedHttpWrites,
      },
    },
  };
}
