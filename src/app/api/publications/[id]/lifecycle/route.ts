import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getGitHubPullRequestStatus } from "@/lib/github-pr-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const publication = await prisma.publication.findUnique({
    where: { id },
    include: { store: true },
  });

  if (!publication) {
    return NextResponse.json(
      { ok: false, error: "Publication não encontrada." },
      { status: 404 },
    );
  }

  const repository =
    publication.store.githubOwner && publication.store.githubRepo
      ? `${publication.store.githubOwner}/${publication.store.githubRepo}`
      : null;
  const token = process.env.GITHUB_PUBLISH_TOKEN?.trim();
  let pullRequest = null;
  let githubError: string | null = null;

  if (repository && publication.pullRequestNumber && token) {
    try {
      pullRequest = await getGitHubPullRequestStatus({
        token,
        repository,
        pullRequestNumber: publication.pullRequestNumber,
      });
    } catch (error) {
      githubError = error instanceof Error ? error.message : "Falha ao consultar Pull Request.";
    }
  }

  return NextResponse.json({
    ok: true,
    configuration: {
      githubToken: Boolean(token),
      vercelToken: Boolean(process.env.VERCEL_API_TOKEN?.trim()),
    },
    publication: {
      id: publication.id,
      status: publication.status,
      externalUrl: publication.externalUrl,
      githubBranch: publication.githubBranch,
      githubCommitSha: publication.githubCommitSha,
      pullRequestNumber: publication.pullRequestNumber,
      previewUrl: publication.previewUrl,
      lastError: publication.lastError,
      publishedAt: publication.publishedAt?.toISOString() || null,
      lastSyncedAt: publication.lastSyncedAt?.toISOString() || null,
      updatedAt: publication.updatedAt.toISOString(),
    },
    repository,
    pullRequest,
    githubError,
  });
}
