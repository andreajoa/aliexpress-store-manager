export type GitHubPullRequestStatus = {
  number: number;
  state: string;
  draft: boolean;
  merged: boolean;
  mergedAt: string | null;
  mergeCommitSha: string | null;
  headSha: string;
  headRef: string;
  baseRef: string;
  url: string;
};

function headers(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "aliexpress-store-manager",
  };
}

export async function getGitHubPullRequestStatus(input: {
  token: string;
  repository: string;
  pullRequestNumber: number;
  fetcher?: typeof fetch;
}): Promise<GitHubPullRequestStatus> {
  const fetcher = input.fetcher || fetch;
  const response = await fetcher(
    `https://api.github.com/repos/${input.repository}/pulls/${input.pullRequestNumber}`,
    {
      method: "GET",
      cache: "no-store",
      headers: headers(input.token),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub ${response.status} ao consultar PR: ${body.slice(0, 500)}`);
  }

  const data = await response.json() as {
    number?: number;
    state?: string;
    draft?: boolean;
    merged?: boolean;
    merged_at?: string | null;
    merge_commit_sha?: string | null;
    html_url?: string;
    head?: { sha?: string; ref?: string };
    base?: { ref?: string };
  };

  if (!data.number || !data.head?.sha || !data.head.ref || !data.base?.ref || !data.html_url) {
    throw new Error("GitHub retornou PR incompleto.");
  }

  return {
    number: data.number,
    state: data.state || "unknown",
    draft: data.draft === true,
    merged: data.merged === true || Boolean(data.merged_at),
    mergedAt: data.merged_at || null,
    mergeCommitSha: data.merge_commit_sha || null,
    headSha: data.head.sha,
    headRef: data.head.ref,
    baseRef: data.base.ref,
    url: data.html_url,
  };
}

export async function mergeGitHubPullRequest(input: {
  token: string;
  repository: string;
  pullRequestNumber: number;
  expectedHeadSha: string;
  expectedHeadRef: string;
  expectedBaseRef: string;
  commitTitle: string;
  fetcher?: typeof fetch;
}) {
  const fetcher = input.fetcher || fetch;
  const status = await getGitHubPullRequestStatus({
    token: input.token,
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    fetcher,
  });

  if (status.merged) {
    return {
      merged: true,
      alreadyMerged: true,
      sha: status.mergeCommitSha,
      status,
    };
  }

  if (status.state !== "open") {
    throw new Error(`PR #${status.number} não está aberto.`);
  }
  if (status.headSha !== input.expectedHeadSha) {
    throw new Error("O head SHA do PR mudou desde a criação da Publication. Revalide o Preview antes do merge.");
  }
  if (status.headRef !== input.expectedHeadRef) {
    throw new Error("A branch head do PR não corresponde à Publication.");
  }
  if (status.baseRef !== input.expectedBaseRef) {
    throw new Error("A branch base do PR não corresponde ao contrato da Publication.");
  }

  const response = await fetcher(
    `https://api.github.com/repos/${input.repository}/pulls/${input.pullRequestNumber}/merge`,
    {
      method: "PUT",
      cache: "no-store",
      headers: {
        ...headers(input.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sha: input.expectedHeadSha,
        merge_method: "squash",
        commit_title: input.commitTitle,
      }),
    },
  );

  const data = await response.json().catch(() => ({})) as {
    merged?: boolean;
    sha?: string;
    message?: string;
  };

  if (!response.ok || data.merged !== true) {
    throw new Error(
      `GitHub não realizou o merge: ${data.message || `HTTP ${response.status}`}`,
    );
  }

  return {
    merged: true,
    alreadyMerged: false,
    sha: data.sha || null,
    status,
  };
}
