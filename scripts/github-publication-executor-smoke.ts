import type { PublicationPlan } from "../src/lib/publication-plan.ts";
import type { RepositoryFileContent } from "../src/lib/repository-dry-run.ts";
import {
  executeGitHubPublication,
  type GitHubPublicationTransport,
  type GitHubRepositoryRef,
  type GitHubTreeEntry,
} from "../src/lib/github-publication-executor.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const product = {
  id: "ae-fixture-001",
  sourceProductId: "fixture-001",
  title: "Produto Fixture",
  slug: "produto-fixture",
  headline: "Fixture",
  description: "Produto sintético.",
  benefits: ["Teste"],
  cta: "Comprar",
  price: 4990,
  compareAtPrice: 6990,
  currency: "BRL",
  image: "https://example.test/image.jpg",
  gallery: ["https://example.test/image.jpg"],
  editorialAssets: [{ id: "editorial-fixture", type: "AI_LIFESTYLE" }],
  category: "Sensorial",
  ageRange: "8 anos ou mais",
  stock: 10,
  variants: [],
  shipping: { weightGrams: 200, lengthCm: 10, widthCm: 10, heightCm: 5 },
  seo: { title: "Produto Fixture", description: "SEO fixture." },
  source: { provider: "ALIEXPRESS", productId: "fixture-001", url: "https://example.test/source" },
};

function fixturePlan(futureBranch = "store-manager/product-ae-fixture-001"): PublicationPlan {
  return {
    dryRun: true,
    ready: true,
    protocolVersion: "2026-08-01",
    adapter: {
      transport: "github",
      kind: "github-catalog",
      id: "github-json-catalog-v1",
      contractResolved: true,
    },
    target: {
      storeId: "store-fixture",
      storeName: "Fixture Store",
      repository: "example/fixture-store",
      baseBranch: "main",
      futureBranch,
      futureUrl: "https://fixture.test/produto/ae-fixture-001",
    },
    summary: {
      productId: product.id,
      title: product.title,
      variants: 0,
      totalStock: 10,
      galleryImages: 1,
      editorialAssets: 1,
    },
    checks: [],
    blockers: [],
    warnings: [],
    operations: [
      {
        order: 1,
        kind: "git.branch.create",
        target: "example/fixture-store:store-manager/product-ae-fixture-001",
        path: null,
        description: "Criar branch futura a partir de main.",
        remoteWriteRequired: true,
      },
      {
        order: 2,
        kind: "catalog.product.upsert",
        target: "example/fixture-store",
        path: "data/products.json",
        description: "Upsert do produto.",
        remoteWriteRequired: true,
        content: product,
      },
      {
        order: 3,
        kind: "editorial.asset.copy",
        target: "example/fixture-store",
        path: "public/store-manager/products/ae-fixture-001/editorial-fixture.png",
        description: "Copiar editorial.",
        remoteWriteRequired: true,
        content: { sourcePath: "/tmp/editorial-fixture.png" },
      },
      {
        order: 4,
        kind: "git.commit.create",
        target: "example/fixture-store",
        path: null,
        description: "Criar commit.",
        remoteWriteRequired: true,
      },
      {
        order: 5,
        kind: "github.pull-request.open",
        target: "example/fixture-store",
        path: null,
        description: "Abrir PR.",
        remoteWriteRequired: true,
      },
      {
        order: 6,
        kind: "preview.verify",
        target: "https://fixture.test/produto/ae-fixture-001",
        path: null,
        description: "Verificar Preview.",
        remoteWriteRequired: false,
      },
    ],
    execution: {
      mode: "dry-run",
      performed: {
        githubWrites: 0,
        commits: 0,
        pullRequests: 0,
        vercelDeployments: 0,
        productionWrites: 0,
      },
      planned: {
        githubWrites: 1,
        commits: 1,
        pullRequests: 1,
        previewVerifications: 1,
        httpWrites: 0,
      },
    },
  };
}

class FakeTransport implements GitHubPublicationTransport {
  refs = new Map<string, GitHubRepositoryRef>([
    ["main", { commitSha: "base-commit", treeSha: "base-tree" }],
  ]);
  files = new Map<string, RepositoryFileContent>([
    ["data/products.json", "{\n  \"version\": 1,\n  \"products\": []\n}\n"],
  ]);
  blobs: Array<{ sha: string; content: RepositoryFileContent }> = [];
  trees: Array<{ base: string; entries: GitHubTreeEntry[] }> = [];
  commits: Array<{ sha: string; parent: string; tree: string }> = [];
  branches: Array<{ branch: string; sha: string }> = [];
  prs: Array<{ head: string; base: string }> = [];

  async getRef(_repository: string, branch: string) {
    return this.refs.get(branch) || null;
  }

  async getFile(_repository: string, path: string, _ref: string) {
    return this.files.get(path) ?? null;
  }

  async createBlob(_repository: string, content: RepositoryFileContent) {
    const sha = `blob-${this.blobs.length + 1}`;
    this.blobs.push({ sha, content });
    return sha;
  }

  async createTree(_repository: string, baseTreeSha: string, entries: GitHubTreeEntry[]) {
    this.trees.push({ base: baseTreeSha, entries });
    return "tree-new";
  }

  async createCommit(_repository: string, _message: string, treeSha: string, parentSha: string) {
    const sha = "commit-new";
    this.commits.push({ sha, parent: parentSha, tree: treeSha });
    return sha;
  }

  async createBranch(_repository: string, branch: string, commitSha: string) {
    this.branches.push({ branch, sha: commitSha });
    this.refs.set(branch, { commitSha, treeSha: "tree-new" });
  }

  async openPullRequest(input: { repository: string; title: string; body: string; head: string; base: string }) {
    this.prs.push({ head: input.head, base: input.base });
    return { number: 42, url: "https://github.test/pr/42" };
  }
}

console.log("=== EXECUCAO SEGURA ===");
const transport = new FakeTransport();
const result = await executeGitHubPublication({
  plan: fixturePlan(),
  assetSources: {
    "/tmp/editorial-fixture.png": new TextEncoder().encode("fixture-image"),
  },
  transport,
});
assert(result.ready, "execução deveria estar pronta");
assert(result.outcome === "pull-request-open", "deveria abrir PR");
assert(result.pullRequestNumber === 42, "PR incorreto");
assert(result.execution.performed.productionWrites === 0, "produção não pode receber write");
assert(result.execution.performed.baseBranchWrites === 0, "branch base não pode receber write");
assert(transport.branches.length === 1, "deveria criar uma branch");
assert(transport.branches[0].branch.startsWith("store-manager/"), "branch deve ser store-manager/*");
assert(transport.branches[0].branch !== "main", "main jamais pode ser escrita");
assert(transport.commits[0].parent === "base-commit", "commit precisa herdar da base");
assert(transport.prs.length === 1 && transport.prs[0].base === "main", "PR deve apontar para main sem alterá-la");
assert(transport.trees[0].entries.length === 2, "catálogo e asset devem entrar na tree");
console.log("✅ branch isolada + commit + PR");
console.log("✅ ZERO writes em main/produção");

console.log("=== IDEMPOTENCIA DE BRANCH ===");
const second = await executeGitHubPublication({
  plan: fixturePlan(),
  assetSources: { "/tmp/editorial-fixture.png": new TextEncoder().encode("fixture-image") },
  transport,
});
assert(!second.ready, "segunda execução precisa bloquear branch existente");
assert(second.blockers.some((item) => item.code === "PUBLICATION_BRANCH_ALREADY_EXISTS"), "blocker de branch existente ausente");
assert(transport.prs.length === 1, "não pode abrir PR duplicado");
console.log("✅ retry cego bloqueado");

console.log("=== BRANCH INSEGURA ===");
const unsafeTransport = new FakeTransport();
const unsafe = await executeGitHubPublication({
  plan: fixturePlan("main"),
  assetSources: { "/tmp/editorial-fixture.png": new TextEncoder().encode("fixture-image") },
  transport: unsafeTransport,
});
assert(!unsafe.ready, "branch main deve bloquear");
assert(unsafe.blockers.some((item) => item.code === "PUBLICATION_BRANCH_UNSAFE"), "blocker de segurança ausente");
assert(unsafeTransport.blobs.length === 0, "branch insegura não pode criar objetos Git");
assert(unsafeTransport.prs.length === 0, "branch insegura não pode abrir PR");
console.log("✅ main/master/base protegidas");

console.log("====================================================");
console.log("GITHUB PUBLICATION EXECUTOR: PASS");
console.log("ZERO BASE BRANCH WRITES");
console.log("ZERO PRODUCTION WRITES");
console.log("====================================================");
