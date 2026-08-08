import {
  parsePublicationTargetContract,
} from "./publication-target-contract.ts";

export type CompatibilityLevel =
  | "AVAILABLE"
  | "LIMITED"
  | "BLOCKED";

export type StoreCompatibilityInput = {
  status: string;
  connectionType: string;
  baseUrl: string;
  apiEndpoint: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
  connectorVersion: string | null;
  connectorCapabilities: unknown;
  intelligenceSource: string | null;
  lastScannedAt: Date | string | null;
};

export type CompatibilityItem = {
  key: "connection" | "read" | "intelligence" | "catalog" | "publication";
  label: string;
  level: CompatibilityLevel;
  summary: string;
  detail: string;
};

export type StoreCompatibilityReport = {
  overall: CompatibilityLevel;
  publishable: boolean;
  items: CompatibilityItem[];
  publicationTarget: {
    present: boolean;
    valid: boolean;
    kind: string | null;
    adapter: string | null;
    issues: string[];
  };
};

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function item(
  key: CompatibilityItem["key"],
  label: string,
  level: CompatibilityLevel,
  summary: string,
  detail: string
): CompatibilityItem {
  return { key, label, level, summary, detail };
}

export function evaluateStoreCompatibility(
  store: StoreCompatibilityInput
): StoreCompatibilityReport {
  const capabilities = objectValue(store.connectorCapabilities);
  const contract = parsePublicationTargetContract(capabilities);
  const items: CompatibilityItem[] = [];

  const active = store.status === "ACTIVE";

  items.push(
    active
      ? item("connection", "Conexão", "AVAILABLE", "Conectada", "O Store Connector foi validado.")
      : item("connection", "Conexão", "BLOCKED", "Desconectada", "Valide o Store Connector antes de usar esta loja.")
  );

  items.push(
    active
      ? item(
          "read",
          "Leitura",
          "AVAILABLE",
          "Disponível",
          store.connectorVersion
            ? `Conector ${store.connectorVersion} validado para leitura.`
            : "Conector validado para leitura; versão não informada."
        )
      : item("read", "Leitura", "BLOCKED", "Indisponível", "A conexão precisa estar ativa.")
  );

  if (!active) {
    items.push(item("intelligence", "Inteligência", "BLOCKED", "Indisponível", "A conexão precisa estar ativa."));
  } else if (store.lastScannedAt) {
    items.push(item("intelligence", "Inteligência", "AVAILABLE", "Analisada", store.intelligenceSource ? `Fonte: ${store.intelligenceSource}.` : "Análise da loja disponível."));
  } else {
    items.push(item("intelligence", "Inteligência", "LIMITED", "Aguardando análise", "Execute a análise da loja para descobrir identidade, categorias e capabilities."));
  }

  if (!active) {
    items.push(item("catalog", "Catálogo", "BLOCKED", "Indisponível", "A conexão precisa estar ativa."));
  } else if (capabilities.githubManagedCatalog === true) {
    items.push(item("catalog", "Catálogo", "AVAILABLE", "Gerenciamento declarado", "O conector declara catálogo gerenciado. Isso não implica endpoint HTTP de catálogo."));
  } else if (Object.keys(capabilities).length > 0) {
    items.push(item("catalog", "Catálogo", "LIMITED", "Capability não declarada", "O conector não declarou um modo de gerenciamento de catálogo reconhecido pelo Manager."));
  } else {
    items.push(item("catalog", "Catálogo", "LIMITED", "Aguardando análise", "As capabilities da loja ainda não foram carregadas."));
  }

  let publicationLevel: CompatibilityLevel = "BLOCKED";
  let publicationSummary = "Bloqueada";
  let publicationDetail = "A loja não possui contrato de publicação compatível.";

  if (!active) {
    publicationDetail = "A conexão precisa estar ativa antes da publicação.";
  } else if (!contract.valid) {
    publicationDetail = contract.issues.map((issue) => issue.detail).join(" ");
  } else if (contract.target?.kind === "github-catalog") {
    if (
      store.connectionType === "GITHUB_VERCEL" &&
      store.githubOwner &&
      store.githubRepo &&
      store.githubBranch
    ) {
      publicationLevel = "AVAILABLE";
      publicationSummary = "Compatível";
      publicationDetail = `Adapter ${contract.target.adapter} com destino GitHub declarado.`;
    } else {
      publicationDetail = "O contrato GitHub é válido, mas faltam owner, repositório, branch ou tipo de conexão compatível.";
    }
  } else if (contract.target?.kind === "http-api") {
    if (store.apiEndpoint) {
      publicationLevel = "AVAILABLE";
      publicationSummary = "Compatível";
      publicationDetail = `Adapter ${contract.target.adapter} com endpoint de publicação declarado.`;
    } else {
      publicationDetail = "O contrato HTTP é válido, mas a loja não possui apiEndpoint configurado.";
    }
  }

  items.push(item("publication", "Publicação", publicationLevel, publicationSummary, publicationDetail));

  const connectionBlocked = items.some((entry) => entry.key === "connection" && entry.level === "BLOCKED");
  const hasLimitation = items.some((entry) => entry.level !== "AVAILABLE");

  const overall: CompatibilityLevel =
    connectionBlocked
      ? "BLOCKED"
      : hasLimitation
        ? "LIMITED"
        : "AVAILABLE";

  return {
    overall,
    publishable: publicationLevel === "AVAILABLE",
    items,
    publicationTarget: {
      present: contract.present,
      valid: contract.valid,
      kind: contract.target?.kind ?? null,
      adapter: contract.target?.adapter ?? null,
      issues: contract.issues.map((issue) => issue.detail),
    },
  };
}
