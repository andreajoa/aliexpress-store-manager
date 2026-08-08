import {
  buildRepositoryDryRun,
  type RepositoryDryRunResult,
  type RepositoryFileContent,
  type RepositorySnapshot,
} from "./repository-dry-run";
import type { PublicationPlan } from "./publication-plan";

export type GitHubRepositoryRef = {
  commitSha: string;
  treeSha: string;
};

export type GitHubTreeEntry = {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string;
};

export type GitHubPullRequestResult = {
  number: number;
  url: string;
};

export interface GitHubPublicationTransport {
  getRef(repository: string, branch: string): Promise<GitHubRepositoryRef | null>;
  getFile(
    repository: string,
    path: string,
    ref: string,
  ): Promise<RepositoryFileContent | null>;
  createBlob(repository: string, content: RepositoryFileContent): Promise<string>;
  createTree(
    repository: string,
    baseTreeSha: string,
    entries: GitHubTreeEntry[],
  ): Promise<string>;
  createCommit(
    repository: string,
    message: string,
    treeSha: string,
    parentSha: string,
  ): Promise<string>;
  createBranch(repository: string, branch: string, commitSha: string): Promise<void>;
  openPullRequest(input: {
    repository: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<GitHubPullRequestResult>;
}

export type GitHubPublicationExecutionInput = {
  plan: PublicationPlan;
  assetSources?: Record<string, RepositoryFileContent>;
  transport: GitHubPublicationTransport;
  commitMessage?: string;
  pullRequestTitle?: string;
  pullRequestBody?: string;
};

export type GitHubPublicationExecutionBlocker = {
  code: string;
  detail: string;
};

export type GitHubPublicationExecutionResult = {
  mode: "github-publication-execution";
  ready: boolean;
  outcome: "blocked" | "noop" | "pull-request-open";
  blockers: GitHubPublicationExecutionBlocker[];
  repositoryDryRun: RepositoryDryRunResult | null;
  repository: string | null;
  baseBranch: string | null;
  publicationBranch: string | null;
  commitSha: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  execution: {
    performed: {
      gitObjects: number;
      branchCreates: number;
      commits: number;
      pullRequests: number;
      productionWrites: 0;
      baseBranchWrites: 0;
    };
  };
};

function blocked(
  input: Pick<GitHubPublicationExecutionResult, "repository" | "baseBranch" | "publicationBranch">,
  blockers: GitHubPublicationExecutionBlocker[],
  repositoryDryRun: RepositoryDryRunResult | null = null,
): GitHubPublicationExecutionResult {
  return {
    mode: "github-publication-execution",
    ready: false,
    outcome: "blocked",
    blockers,
    repositoryDryRun,
    repository: input.repository,
    baseBranch: input.baseBranch,
    publicationBranch: input.publicationBranch,
    commitSha: null,
    pullRequestNumber: null,
    pullRequestUrl: null,
    execution: {
      performed: {
        gitObjects: 0,
        branchCreates: 0,
        commits: 0,
        pullRequests: 0,
        productionWrites: 0,
        baseBranchWrites: 0,
      },
    },
  };
}

function safePublicationBranch(branch: string | null, baseBranch: string | null) {
  if (!branch || !baseBranch) return false;
  if (branch === baseBranch || branch === "main" || branch === "master") return false;
  if (!branch.startsWith("store-manager/")) return false;
  if (branch.startsWith("/") || branch.endsWith("/")) return false;
  if (branch.includes("\\") || branch.includes("..") || branch.includes("//")) return false;
  if (branch.includes("@{") || branch.includes("~") || branch.includes("^") || branch.includes(":")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(branch);
}

function catalogOperation(plan: PublicationPlan) {
  return plan.operations.find((operation) => operation.kind === "catalog.product.upsert") || null;
}

function editorialOperations(plan: PublicationPlan) {
  return plan.operations.filter((operation) => operation.kind === "editorial.asset.copy");
}

function utf8(value: RepositoryFileContent) {
  return typeof value === "string" ? value : Buffer.from(value).toString("utf8");
}

function productTitle(plan: PublicationPlan) {
  const operation = catalogOperation(plan);
  const content = operation?.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return "produto";
  const title = (content as Record<string, unknown>).title;
  return typeof title === "string" && title.trim() ? title.trim() : "produto";
}

export async function executeGitHubPublication(
  input: GitHubPublicationExecutionInput,
): Promise<GitHubPublicationExecutionResult> {
  const { plan, transport } = input;
  const repository = plan.target.repository;
  const baseBranch = plan.target.baseBranch;
  const publicationBranch = plan.target.futureBranch;
  const target = { repository, baseBranch, publicationBranch };
  const blockers: GitHubPublicationExecutionBlocker[] = [];

  if (!plan.ready) {
    blockers.push({
      code: "PUBLICATION_PLAN_NOT_READY",
      detail: "O Publication Plan possui bloqueios e não pode ser executado.",
    });
    for (const item of plan.blockers) {
      blockers.push({ code: `PLAN_${item.code}`, detail: item.detail });
    }
  }

  if (plan.adapter.transport !== "github" || plan.adapter.id !== "github-json-catalog-v1") {
    blockers.push({
      code: "GITHUB_EXECUTOR_ADAPTER_UNSUPPORTED",
      detail: `Executor GitHub suporta somente github-json-catalog-v1; recebido ${plan.adapter.id || "ausente"}.`,
    });
  }

  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    blockers.push({
      code: "GITHUB_REPOSITORY_INVALID",
      detail: "O repositório de destino precisa estar no formato owner/repo.",
    });
  }

  if (!safePublicationBranch(publicationBranch, baseBranch)) {
    blockers.push({
      code: "PUBLICATION_BRANCH_UNSAFE",
      detail: "A branch de publicação precisa ser exclusiva store-manager/* e nunca pode ser main/master ou a branch base.",
    });
  }

  if (blockers.length || !repository || !baseBranch || !publicationBranch) {
    return blocked(target, blockers);
  }

  const baseRef = await transport.getRef(repository, baseBranch);
  if (!baseRef) {
    return blocked(target, [{
      code: "BASE_BRANCH_NOT_FOUND",
      detail: `A branch base ${baseBranch} não existe no repositório ${repository}.`,
    }]);
  }

  const existingPublicationRef = await transport.getRef(repository, publicationBranch);
  if (existingPublicationRef) {
    return blocked(target, [{
      code: "PUBLICATION_BRANCH_ALREADY_EXISTS",
      detail: `A branch ${publicationBranch} já existe. O executor não sobrescreve branches existentes para evitar duplicidade.`,
    }]);
  }

  const catalog = catalogOperation(plan);
  const catalogPath = catalog?.path || null;
  if (!catalogPath) {
    return blocked(target, [{
      code: "CATALOG_PATH_MISSING",
      detail: "O Publication Plan não contém caminho de catálogo.",
    }]);
  }

  const catalogContent = await transport.getFile(repository, catalogPath, baseBranch);
  if (catalogContent === null) {
    return blocked(target, [{
      code: "CATALOG_FILE_NOT_FOUND",
      detail: `O catálogo ${catalogPath} não existe na branch ${baseBranch}.`,
    }]);
  }

  const snapshot: RepositorySnapshot = { files: { [catalogPath]: catalogContent } };
  for (const operation of editorialOperations(plan)) {
    if (!operation.path) continue;
    const existing = await transport.getFile(repository, operation.path, baseBranch);
    if (existing !== null) snapshot.files[operation.path] = existing;
  }

  const repositoryDryRun = buildRepositoryDryRun({
    plan,
    snapshot,
    assetSources: input.assetSources,
  });

  if (!repositoryDryRun.ready) {
    return blocked(
      target,
      repositoryDryRun.blockers.map((item) => ({ code: item.code, detail: item.detail })),
      repositoryDryRun,
    );
  }

  const materialChanges = repositoryDryRun.changes.filter((change) => change.kind !== "unchanged");
  if (materialChanges.length === 0) {
    return {
      ...blocked(target, [], repositoryDryRun),
      ready: true,
      outcome: "noop",
    };
  }

  const treeEntries: GitHubTreeEntry[] = [];
  let gitObjects = 0;
  for (const change of materialChanges) {
    const content = repositoryDryRun.resultingSnapshot.files[change.path];
    if (content === undefined) {
      return blocked(target, [{
        code: "RESULTING_FILE_MISSING",
        detail: `O repository dry-run não materializou ${change.path}.`,
      }], repositoryDryRun);
    }
    const blobSha = await transport.createBlob(repository, content);
    gitObjects += 1;
    treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: blobSha });
  }

  const treeSha = await transport.createTree(repository, baseRef.treeSha, treeEntries);
  gitObjects += 1;
  const title = productTitle(plan);
  const commitSha = await transport.createCommit(
    repository,
    input.commitMessage || `Store Manager: publicar ${title}`,
    treeSha,
    baseRef.commitSha,
  );
  gitObjects += 1;

  // O primeiro movimento de ref acontece somente depois de todos os objetos Git estarem prontos.
  // A branch base nunca é atualizada por este executor.
  await transport.createBranch(repository, publicationBranch, commitSha);

  const pullRequest = await transport.openPullRequest({
    repository,
    title: input.pullRequestTitle || `Store Manager: publicar ${title}`,
    body: input.pullRequestBody || [
      "Publicação criada automaticamente pelo AliExpress Store Manager.",
      "",
      `Produto: ${title}`,
      `Branch base: ${baseBranch}`,
      `Branch de publicação: ${publicationBranch}`,
      "",
      "Segurança: nenhuma escrita foi realizada diretamente na branch base. O merge deve ocorrer somente após Preview e validação.",
    ].join("\n"),
    head: publicationBranch,
    base: baseBranch,
  });

  return {
    mode: "github-publication-execution",
    ready: true,
    outcome: "pull-request-open",
    blockers: [],
    repositoryDryRun,
    repository,
    baseBranch,
    publicationBranch,
    commitSha,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.url,
    execution: {
      performed: {
        gitObjects,
        branchCreates: 1,
        commits: 1,
        pullRequests: 1,
        productionWrites: 0,
        baseBranchWrites: 0,
      },
    },
  };
}

export function repositoryTextContent(value: RepositoryFileContent) {
  return utf8(value);
}
