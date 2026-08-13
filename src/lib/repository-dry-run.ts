import {
  createHash,
} from "node:crypto";

import type {
  PublicationPlan,
  PublicationPlanOperation,
} from "./publication-plan";

export type RepositoryFileContent =
  | string
  | Uint8Array;

export type RepositorySnapshot = {
  files: Record<
    string,
    RepositoryFileContent
  >;
};

export type RepositoryDryRunInput = {
  plan:
    PublicationPlan;

  snapshot:
    RepositorySnapshot;

  assetSources?: Record<
    string,
    RepositoryFileContent
  >;
};

export type RepositoryDryRunChange = {
  path: string;

  kind:
    | "add"
    | "modify"
    | "unchanged";

  contentType:
    | "json"
    | "binary";

  beforeSha256:
    string | null;

  afterSha256:
    string;

  beforeBytes:
    number;

  afterBytes:
    number;
};

export type RepositoryDryRunResult = {
  mode:
    "repository-dry-run";

  ready:
    boolean;

  adapter: {
    transport:
      string;

    id:
      string | null;
  };

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

  changes:
    RepositoryDryRunChange[];

  workflowOperations:
    PublicationPlanOperation[];

  summary: {
    added:
      number;

    modified:
      number;

    unchanged:
      number;

    totalFiles:
      number;
  };

  execution: {
    performed: {
      filesystemWrites:
        0;

      gitWrites:
        0;

      commits:
        0;

      pullRequests:
        0;

      remoteWrites:
        0;
    };
  };

  resultingSnapshot:
    RepositorySnapshot;
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

function safeSnapshotPath(
  value:
    string | null
) {
  if (
    !value ||
    value.startsWith(
      "/"
    ) ||
    value.includes(
      "\\"
    ) ||
    value.includes(
      "\0"
    )
  ) {
    return false;
  }

  const parts =
    value.split("/");

  return !parts.some(
    part =>
      !part ||
      part === "." ||
      part === ".."
  );
}

function cloneContent(
  value:
    RepositoryFileContent
): RepositoryFileContent {
  if (
    typeof value ===
    "string"
  ) {
    return value;
  }

  return new Uint8Array(
    value
  );
}

function cloneSnapshot(
  snapshot:
    RepositorySnapshot
): RepositorySnapshot {
  const files:
    Record<
      string,
      RepositoryFileContent
    > = {};

  for (
    const [
      path,
      content,
    ]
    of Object.entries(
      snapshot.files
    )
  ) {
    files[path] =
      cloneContent(
        content
      );
  }

  return {
    files,
  };
}

function toBuffer(
  value:
    RepositoryFileContent
) {
  return typeof value ===
    "string"
    ? Buffer.from(
        value,
        "utf8"
      )
    : Buffer.from(
        value
      );
}

function toText(
  value:
    RepositoryFileContent
) {
  return typeof value ===
    "string"
    ? value
    : Buffer.from(
        value
      ).toString(
        "utf8"
      );
}

function sha256(
  value:
    RepositoryFileContent
) {
  return createHash(
    "sha256"
  )
    .update(
      toBuffer(
        value
      )
    )
    .digest(
      "hex"
    );
}

function sameContent(
  a:
    RepositoryFileContent,

  b:
    RepositoryFileContent
) {
  const aBuffer =
    toBuffer(a);

  const bBuffer =
    toBuffer(b);

  return (
    aBuffer.length ===
      bBuffer.length &&
    aBuffer.equals(
      bBuffer
    )
  );
}

function fileChange(
  path:
    string,

  before:
    RepositoryFileContent |
    undefined,

  after:
    RepositoryFileContent,

  contentType:
    "json" |
    "binary"
): RepositoryDryRunChange {
  const kind =
    before === undefined
      ? "add"
      : sameContent(
          before,
          after
        )
        ? "unchanged"
        : "modify";

  return {
    path,

    kind,

    contentType,

    beforeSha256:
      before === undefined
        ? null
        : sha256(
            before
          ),

    afterSha256:
      sha256(
        after
      ),

    beforeBytes:
      before === undefined
        ? 0
        : toBuffer(
            before
          ).length,

    afterBytes:
      toBuffer(
        after
      ).length,
  };
}

function emptyResult(
  input:
    RepositoryDryRunInput,

  blockers:
    Array<{
      code: string;
      detail: string;
    }>,

  warnings:
    Array<{
      code: string;
      detail: string;
    }>
): RepositoryDryRunResult {
  return {
    mode:
      "repository-dry-run",

    ready:
      false,

    adapter: {
      transport:
        input.plan
          .adapter
          .transport,

      id:
        input.plan
          .adapter
          .id,
    },

    blockers,

    warnings,

    changes: [],

    workflowOperations:
      [],

    summary: {
      added:
        0,

      modified:
        0,

      unchanged:
        0,

      totalFiles:
        0,
    },

    execution: {
      performed: {
        filesystemWrites:
          0,

        gitWrites:
          0,

        commits:
          0,

        pullRequests:
          0,

        remoteWrites:
          0,
      },
    },

    resultingSnapshot:
      cloneSnapshot(
        input.snapshot
      ),
  };
}

export function buildRepositoryDryRun(
  input:
    RepositoryDryRunInput
): RepositoryDryRunResult {
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

  function block(
    code:
      string,

    detail:
      string
  ) {
    blockers.push({
      code,
      detail,
    });
  }

  function warning(
    code:
      string,

    detail:
      string
  ) {
    warnings.push({
      code,
      detail,
    });
  }

  /*
   * Fail closed:
   * se o Publication Plan já estiver bloqueado,
   * o adapter não produz nenhuma mutação de arquivos.
   */
  if (
    !input.plan.ready
  ) {
    block(
      "PUBLICATION_PLAN_NOT_READY",
      "O Publication Plan possui bloqueios e não pode ser materializado."
    );

    for (
      const blocker
      of input.plan
        .blockers
    ) {
      block(
        `PLAN_${blocker.code}`,
        blocker.detail
      );
    }

    return emptyResult(
      input,
      blockers,
      warnings
    );
  }

  if (
    input.plan
      .adapter
      .transport !==
    "github"
  ) {
    block(
      "REPOSITORY_TRANSPORT_UNSUPPORTED",
      `Este adapter opera somente com transport=github. Recebido: ${input.plan.adapter.transport}.`
    );
  }

  if (
    input.plan
      .adapter
      .id !==
    "github-json-catalog-v1"
  ) {
    block(
      "REPOSITORY_ADAPTER_UNSUPPORTED",
      `Adapter não suportado: ${input.plan.adapter.id || "ausente"}.`
    );
  }

  const catalogOperations =
    input.plan
      .operations
      .filter(
        operation =>
          operation.kind ===
          "catalog.product.upsert"
      );

  if (
    catalogOperations.length !==
    1
  ) {
    block(
      "CATALOG_OPERATION_INVALID",
      `Esperada exatamente 1 operação catalog.product.upsert; recebidas ${catalogOperations.length}.`
    );
  }

  const catalogOperation =
    catalogOperations[0];

  const catalogPath =
    catalogOperation
      ?.path ||
    null;

  if (
    !safeSnapshotPath(
      catalogPath
    )
  ) {
    block(
      "CATALOG_PATH_INVALID",
      "O caminho do catálogo não é um caminho relativo seguro."
    );
  }

  const hasCatalogFile =
    catalogPath
      ? Object.prototype
          .hasOwnProperty
          .call(
            input.snapshot
              .files,
            catalogPath
          )
      : false;

  if (
    catalogPath &&
    !hasCatalogFile
  ) {
    block(
      "CATALOG_FILE_MISSING",
      `O snapshot não contém o arquivo de catálogo ${catalogPath}.`
    );
  }

  const product =
    objectValue(
      catalogOperation
        ?.content
    );

  const productId =
    stringValue(
      product.id
    );

  if (!productId) {
    block(
      "CATALOG_PRODUCT_ID_MISSING",
      "A operação de catálogo não contém um product.id válido."
    );
  }

  let parsedCatalog:
    unknown =
    null;

  let catalogRoot:
    "array" |
    "object-products" |
    null =
    null;

  let catalogProducts:
    unknown[] =
    [];

  if (
    catalogPath &&
    hasCatalogFile
  ) {
    try {
      parsedCatalog =
        JSON.parse(
          toText(
            input.snapshot
              .files[
                catalogPath
              ]
          )
        );

      if (
        Array.isArray(
          parsedCatalog
        )
      ) {
        catalogRoot =
          "array";

        catalogProducts =
          parsedCatalog;
      } else {
        const object =
          objectValue(
            parsedCatalog
          );

        if (
          Array.isArray(
            object.products
          )
        ) {
          catalogRoot =
            "object-products";

          catalogProducts =
            object.products;
        } else {
          block(
            "CATALOG_SHAPE_UNSUPPORTED",
            "O JSON do catálogo precisa ser um array ou um objeto contendo products[]."
          );
        }
      }
    } catch (
      error
    ) {
      block(
        "CATALOG_JSON_INVALID",
        error instanceof Error
          ? `JSON inválido em ${catalogPath}: ${error.message}`
          : `JSON inválido em ${catalogPath}.`
      );
    }
  }

  if (
    productId &&
    catalogRoot
  ) {
    const occurrences =
      catalogProducts
        .filter(
          item =>
            stringValue(
              objectValue(
                item
              ).id
            ) ===
            productId
        )
        .length;

    if (
      occurrences >
      1
    ) {
      block(
        "CATALOG_DUPLICATE_PRODUCT_ID",
        `O catálogo contém ${occurrences} produtos com id=${productId}.`
      );
    }
  }

  const assetOperations =
    input.plan
      .operations
      .filter(
        operation =>
          operation.kind ===
          "editorial.asset.copy"
      );

  const assetSources =
    input.assetSources ||
    {};

  for (
    const operation
    of assetOperations
  ) {
    const targetPath =
      operation.path;

    if (
      !safeSnapshotPath(
        targetPath
      )
    ) {
      block(
        "EDITORIAL_TARGET_PATH_INVALID",
        `Caminho editorial inválido: ${targetPath || "ausente"}.`
      );

      continue;
    }

    const content =
      objectValue(
        operation.content
      );

    const sourcePath =
      stringValue(
        content.sourcePath
      );

    if (!sourcePath) {
      block(
        "EDITORIAL_SOURCE_PATH_MISSING",
        `A operação para ${targetPath} não possui sourcePath.`
      );

      continue;
    }

    if (
      !Object.prototype
        .hasOwnProperty
        .call(
          assetSources,
          sourcePath
        )
    ) {
      block(
        "EDITORIAL_SOURCE_CONTENT_MISSING",
        `O conteúdo do asset ${sourcePath} não foi fornecido ao repository dry-run.`
      );
    }
  }

  /*
   * Nenhuma transformação acontece
   * enquanto existir um único blocker.
   */
  if (
    blockers.length >
    0
  ) {
    return emptyResult(
      input,
      blockers,
      warnings
    );
  }

  if (
    !catalogOperation ||
    !catalogPath ||
    !productId ||
    !catalogRoot
  ) {
    block(
      "REPOSITORY_PRECONDITION_FAILED",
      "As pré-condições do repository dry-run não foram satisfeitas."
    );

    return emptyResult(
      input,
      blockers,
      warnings
    );
  }

  const resultingSnapshot =
    cloneSnapshot(
      input.snapshot
    );

  const changes:
    RepositoryDryRunChange[] =
    [];

  let replaced =
    false;

  const nextProducts =
    catalogProducts.map(
      item => {
        const id =
          stringValue(
            objectValue(
              item
            ).id
          );

        if (
          id ===
          productId
        ) {
          replaced =
            true;

          return product;
        }

        return item;
      }
    );

  if (!replaced) {
    nextProducts.push(
      product
    );
  }

  let nextCatalog:
    unknown;

  if (
    catalogRoot ===
    "array"
  ) {
    nextCatalog =
      nextProducts;
  } else {
    nextCatalog = {
      ...objectValue(
        parsedCatalog
      ),

      products:
        nextProducts,
    };
  }

  const nextCatalogText =
    `${JSON.stringify(
      nextCatalog,
      null,
      2
    )}\n`;

  const previousCatalog =
    resultingSnapshot
      .files[
        catalogPath
      ];

  changes.push(
    fileChange(
      catalogPath,
      previousCatalog,
      nextCatalogText,
      "json"
    )
  );

  resultingSnapshot
    .files[
      catalogPath
    ] =
    nextCatalogText;

  for (
    const operation
    of assetOperations
  ) {
    const targetPath =
      operation.path;

    if (!targetPath) {
      continue;
    }

    const content =
      objectValue(
        operation.content
      );

    const sourcePath =
      stringValue(
        content.sourcePath
      );

    if (!sourcePath) {
      continue;
    }

    const source =
      assetSources[
        sourcePath
      ];

    if (
      source === undefined
    ) {
      continue;
    }

    const previous =
      resultingSnapshot
        .files[
          targetPath
        ];

    changes.push(
      fileChange(
        targetPath,
        previous,
        source,
        "binary"
      )
    );

    resultingSnapshot
      .files[
        targetPath
      ] =
      cloneContent(
        source
      );
  }

  const workflowOperations =
    input.plan
      .operations
      .filter(
        operation =>
          operation.kind !==
            "catalog.product.upsert" &&
          operation.kind !==
            "editorial.asset.copy"
      );

  if (
    workflowOperations.some(
      operation =>
        operation
          .remoteWriteRequired
    )
  ) {
    warning(
      "REMOTE_WORKFLOW_NOT_EXECUTED",
      "Branch, commit, PR e demais ações remotas permanecem apenas planejadas."
    );
  }

  const added =
    changes.filter(
      item =>
        item.kind ===
        "add"
    ).length;

  const modified =
    changes.filter(
      item =>
        item.kind ===
        "modify"
    ).length;

  const unchanged =
    changes.filter(
      item =>
        item.kind ===
        "unchanged"
    ).length;

  return {
    mode:
      "repository-dry-run",

    ready:
      true,

    adapter: {
      transport:
        input.plan
          .adapter
          .transport,

      id:
        input.plan
          .adapter
          .id,
    },

    blockers,

    warnings,

    changes,

    workflowOperations,

    summary: {
      added,
      modified,
      unchanged,

      totalFiles:
        changes.length,
    },

    execution: {
      performed: {
        filesystemWrites:
          0,

        gitWrites:
          0,

        commits:
          0,

        pullRequests:
          0,

        remoteWrites:
          0,
      },
    },

    resultingSnapshot,
  };
}
