export const PUBLICATION_TARGET_CONTRACT_VERSION = "1";

export type GitHubCatalogPublicationTarget = {
  contractVersion: "1";
  kind: "github-catalog";
  adapter: "github-json-catalog-v1";
  catalogPath: string;
  editorialAssetsDir?: string;
};

export type HttpApiPublicationTarget = {
  contractVersion: "1";
  kind: "http-api";
  adapter: "store-product-api-v1";
  endpointPath: string;
};

export type PublicationTargetContract =
  | GitHubCatalogPublicationTarget
  | HttpApiPublicationTarget;

export type PublicationTargetContractIssue = {
  code: string;
  detail: string;
};

export type PublicationTargetContractResult = {
  present: boolean;
  valid: boolean;
  target: PublicationTargetContract | null;
  issues: PublicationTargetContractIssue[];
};

function objectValue(
  value: unknown
): Record<string, unknown> {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as Record<string, unknown>
    : {};
}

function stringValue(
  value: unknown
) {
  return (
    typeof value === "string" &&
    value.trim()
  )
    ? value.trim()
    : null;
}

export function safeRelativeRepositoryPath(
  value: string | null
) {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0")
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

function safeEndpointPath(
  value: string | null
) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("://") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    return false;
  }

  const parts =
    value
      .split("/")
      .filter(Boolean);

  return !parts.some(
    part =>
      part === "." ||
      part === ".."
  );
}

export function parsePublicationTargetContract(
  capabilities: unknown
): PublicationTargetContractResult {
  const root =
    objectValue(capabilities);

  const raw =
    root.publicationTarget;

  if (
    raw === undefined ||
    raw === null
  ) {
    return {
      present: false,
      valid: false,
      target: null,
      issues: [
        {
          code: "PUBLICATION_TARGET_MISSING",
          detail:
            "O conector não declara connectorCapabilities.publicationTarget.",
        },
      ],
    };
  }

  if (
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return {
      present: true,
      valid: false,
      target: null,
      issues: [
        {
          code: "PUBLICATION_TARGET_INVALID",
          detail:
            "publicationTarget precisa ser um objeto.",
        },
      ],
    };
  }

  const target =
    objectValue(raw);

  const issues:
    PublicationTargetContractIssue[] =
    [];

  const contractVersion =
    stringValue(
      target.contractVersion
    );

  const kind =
    stringValue(
      target.kind
    );

  const adapter =
    stringValue(
      target.adapter
    );

  if (
    contractVersion !==
    PUBLICATION_TARGET_CONTRACT_VERSION
  ) {
    issues.push({
      code:
        "PUBLICATION_TARGET_VERSION_UNSUPPORTED",
      detail:
        `contractVersion precisa ser "${PUBLICATION_TARGET_CONTRACT_VERSION}".`,
    });
  }

  if (!kind) {
    issues.push({
      code:
        "PUBLICATION_TARGET_KIND_MISSING",
      detail:
        "publicationTarget.kind é obrigatório.",
    });
  }

  if (!adapter) {
    issues.push({
      code:
        "PUBLICATION_TARGET_ADAPTER_MISSING",
      detail:
        "publicationTarget.adapter é obrigatório.",
    });
  }

  if (
    kind === "github-catalog"
  ) {
    if (
      adapter !==
      "github-json-catalog-v1"
    ) {
      issues.push({
        code:
          "PUBLICATION_TARGET_ADAPTER_UNSUPPORTED",
        detail:
          "github-catalog requer adapter github-json-catalog-v1.",
      });
    }

    const catalogPath =
      stringValue(
        target.catalogPath
      );

    const editorialAssetsDir =
      stringValue(
        target.editorialAssetsDir
      );

    if (
      !safeRelativeRepositoryPath(
        catalogPath
      )
    ) {
      issues.push({
        code:
          "PUBLICATION_TARGET_CATALOG_PATH_INVALID",
        detail:
          "catalogPath precisa ser um caminho relativo seguro dentro do repositório.",
      });
    }

    if (
      editorialAssetsDir &&
      !safeRelativeRepositoryPath(
        editorialAssetsDir
      )
    ) {
      issues.push({
        code:
          "PUBLICATION_TARGET_EDITORIAL_DIR_INVALID",
        detail:
          "editorialAssetsDir precisa ser um caminho relativo seguro.",
      });
    }

    if (
      issues.length > 0 ||
      !catalogPath
    ) {
      return {
        present: true,
        valid: false,
        target: null,
        issues,
      };
    }

    return {
      present: true,
      valid: true,
      target: {
        contractVersion: "1",
        kind: "github-catalog",
        adapter:
          "github-json-catalog-v1",
        catalogPath,
        ...(editorialAssetsDir
          ? {
              editorialAssetsDir,
            }
          : {}),
      },
      issues: [],
    };
  }

  if (
    kind === "http-api"
  ) {
    if (
      adapter !==
      "store-product-api-v1"
    ) {
      issues.push({
        code:
          "PUBLICATION_TARGET_ADAPTER_UNSUPPORTED",
        detail:
          "http-api requer adapter store-product-api-v1.",
      });
    }

    const endpointPath =
      stringValue(
        target.endpointPath
      );

    if (
      !safeEndpointPath(
        endpointPath
      )
    ) {
      issues.push({
        code:
          "PUBLICATION_TARGET_ENDPOINT_INVALID",
        detail:
          "endpointPath precisa ser uma rota relativa segura iniciada por /.",
      });
    }

    if (
      issues.length > 0 ||
      !endpointPath
    ) {
      return {
        present: true,
        valid: false,
        target: null,
        issues,
      };
    }

    return {
      present: true,
      valid: true,
      target: {
        contractVersion: "1",
        kind: "http-api",
        adapter:
          "store-product-api-v1",
        endpointPath,
      },
      issues: [],
    };
  }

  if (kind) {
    issues.push({
      code:
        "PUBLICATION_TARGET_KIND_UNSUPPORTED",
      detail:
        `Tipo de publicationTarget não suportado: ${kind}.`,
    });
  }

  return {
    present: true,
    valid: false,
    target: null,
    issues,
  };
}
