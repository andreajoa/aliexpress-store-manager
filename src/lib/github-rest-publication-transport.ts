import type {
  GitHubPublicationTransport,
  GitHubPullRequestResult,
  GitHubRepositoryRef,
  GitHubTreeEntry,
} from "./github-publication-executor";
import type { RepositoryFileContent } from "./repository-dry-run";

const API_VERSION = "2022-11-28";

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function encodeBranch(branch: string) {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function toBase64(content: RepositoryFileContent) {
  return Buffer.from(
    typeof content === "string" ? Buffer.from(content, "utf8") : content,
  ).toString("base64");
}

export class GitHubRestPublicationTransport implements GitHubPublicationTransport {
  constructor(private readonly token: string) {
    if (!token.trim()) throw new Error("GitHub token ausente.");
  }

  private async request(
    path: string,
    init: RequestInit = {},
    allowNotFound = false,
  ) {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "aliexpress-store-manager",
        ...(init.headers || {}),
      },
    });

    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`GitHub ${response.status} em ${path}: ${body.slice(0, 500)}`);
    }
    return response;
  }

  async getRef(repository: string, branch: string): Promise<GitHubRepositoryRef | null> {
    const refResponse = await this.request(
      `/repos/${repository}/git/ref/heads/${encodeBranch(branch)}`,
      {},
      true,
    );
    if (!refResponse) return null;
    const ref = await refResponse.json() as { object?: { sha?: string } };
    const commitSha = ref.object?.sha || "";
    if (!commitSha) throw new Error(`GitHub não retornou SHA para ${repository}:${branch}.`);

    const commitResponse = await this.request(`/repos/${repository}/git/commits/${commitSha}`);
    if (!commitResponse) throw new Error("Commit GitHub indisponível.");
    const commit = await commitResponse.json() as { tree?: { sha?: string } };
    const treeSha = commit.tree?.sha || "";
    if (!treeSha) throw new Error(`GitHub não retornou tree SHA para ${commitSha}.`);
    return { commitSha, treeSha };
  }

  async getFile(
    repository: string,
    path: string,
    ref: string,
  ): Promise<RepositoryFileContent | null> {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github.raw",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": API_VERSION,
          "User-Agent": "aliexpress-store-manager",
        },
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`GitHub ${response.status} ao ler ${path}: ${body.slice(0, 500)}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async createBlob(repository: string, content: RepositoryFileContent) {
    const response = await this.request(`/repos/${repository}/git/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: toBase64(content), encoding: "base64" }),
    });
    if (!response) throw new Error("GitHub blob não criado.");
    const data = await response.json() as { sha?: string };
    if (!data.sha) throw new Error("GitHub blob sem SHA.");
    return data.sha;
  }

  async createTree(
    repository: string,
    baseTreeSha: string,
    entries: GitHubTreeEntry[],
  ) {
    const response = await this.request(`/repos/${repository}/git/trees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
    });
    if (!response) throw new Error("GitHub tree não criada.");
    const data = await response.json() as { sha?: string };
    if (!data.sha) throw new Error("GitHub tree sem SHA.");
    return data.sha;
  }

  async createCommit(
    repository: string,
    message: string,
    treeSha: string,
    parentSha: string,
  ) {
    const response = await this.request(`/repos/${repository}/git/commits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
    });
    if (!response) throw new Error("GitHub commit não criado.");
    const data = await response.json() as { sha?: string };
    if (!data.sha) throw new Error("GitHub commit sem SHA.");
    return data.sha;
  }

  async createBranch(repository: string, branch: string, commitSha: string) {
    await this.request(`/repos/${repository}/git/refs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
    });
  }

  async openPullRequest(input: {
    repository: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<GitHubPullRequestResult> {
    const response = await this.request(`/repos/${input.repository}/pulls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: true,
        maintainer_can_modify: false,
      }),
    });
    if (!response) throw new Error("GitHub PR não criado.");
    const data = await response.json() as { number?: number; html_url?: string };
    if (!data.number || !data.html_url) throw new Error("GitHub PR retornou resposta incompleta.");
    return { number: data.number, url: data.html_url };
  }
}
