import { mergeGitHubPullRequest } from "../src/lib/github-pr-lifecycle.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function prPayload(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    node_id: "PR_fixture_node",
    state: "open",
    draft: true,
    merged: false,
    merged_at: null,
    merge_commit_sha: null,
    html_url: "https://github.test/pull/42",
    head: { sha: "head-123", ref: "store-manager/product-fixture" },
    base: { ref: "main" },
    ...overrides,
  };
}

console.log("=== MERGE SEGURO ===");
const calls: string[] = [];
const safeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  calls.push(`${init?.method || "GET"} ${url}`);
  if (url.endsWith("/pulls/42") && (init?.method || "GET") === "GET") {
    return new Response(JSON.stringify(prPayload()), { status: 200 });
  }
  if (url.endsWith("/graphql")) {
    return new Response(JSON.stringify({
      data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } },
    }), { status: 200 });
  }
  if (url.endsWith("/pulls/42/merge")) {
    const body = JSON.parse(String(init?.body || "{}"));
    assert(body.sha === "head-123", "merge sem expected SHA");
    assert(body.merge_method === "squash", "merge method precisa ser squash");
    return new Response(JSON.stringify({ merged: true, sha: "merge-456", message: "merged" }), { status: 200 });
  }
  throw new Error(`URL inesperada: ${url}`);
};

const safe = await mergeGitHubPullRequest({
  token: "token",
  repository: "example/store",
  pullRequestNumber: 42,
  expectedHeadSha: "head-123",
  expectedHeadRef: "store-manager/product-fixture",
  expectedBaseRef: "main",
  commitTitle: "Store Manager fixture",
  fetcher: safeFetch,
});
assert(safe.merged && safe.sha === "merge-456", "merge seguro falhou");
assert(calls.some((call) => call.includes("graphql")), "PR draft deveria ser promovido antes do merge");
assert(calls.at(-1)?.endsWith("/pulls/42/merge"), "merge deve ser a última mutação");
console.log("✅ draft promovido + SHA/base/head validados + squash merge");

console.log("=== SHA ALTERADO ===");
let writes = 0;
const changedFetch: typeof fetch = async (input, init) => {
  if ((init?.method || "GET") !== "GET") writes += 1;
  return new Response(JSON.stringify(prPayload({ head: { sha: "head-diferente", ref: "store-manager/product-fixture" } })), { status: 200 });
};
let changedBlocked = false;
try {
  await mergeGitHubPullRequest({
    token: "token",
    repository: "example/store",
    pullRequestNumber: 42,
    expectedHeadSha: "head-123",
    expectedHeadRef: "store-manager/product-fixture",
    expectedBaseRef: "main",
    commitTitle: "Fixture",
    fetcher: changedFetch,
  });
} catch (error) {
  changedBlocked = error instanceof Error && error.message.includes("head SHA");
}
assert(changedBlocked, "SHA alterado deveria bloquear");
assert(writes === 0, "SHA alterado não pode causar writes");
console.log("✅ head alterado bloqueado antes de qualquer mutação");

console.log("====================================================");
console.log("GITHUB PR LIFECYCLE: PASS");
console.log("====================================================");
