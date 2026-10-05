import { loadAmbRepositoryCatalog } from "./amb-catalog-repository.ts";

/** Pin all catalog modules to one commit so concurrent releases cannot mix rows. */
export async function loadAmbGitHubCatalog(input: {
  owner: string;
  repo: string;
  branch: string;
  token?: string;
  fetcher?: typeof fetch;
}) {
  const fetcher = input.fetcher || fetch;
  const repository = `${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
  async function get(path: string) {
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "aliexpress-store-manager",
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
      },
      cache: "no-store",
    });
    const raw: unknown = await response.json().catch(() => null);
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : `GitHub HTTP ${response.status}.`);
    return body;
  }
  const commit = await get(`commits/${encodeURIComponent(input.branch)}`);
  if (typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/i.test(commit.sha)) throw new Error("GitHub não retornou um commit válido para o catálogo AMB.");
  const revision = commit.sha;
  return loadAmbRepositoryCatalog(async (path) => {
    const body = await get(`contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${revision}`);
    if (typeof body.content !== "string" || !body.content || body.encoding !== "base64"
      || typeof body.sha !== "string" || !/^[a-f0-9]{40}$/i.test(body.sha)) throw new Error(`GitHub não retornou ${path} em base64 com SHA válido.`);
    return { source: Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8"), blobSha: body.sha };
  });
}
