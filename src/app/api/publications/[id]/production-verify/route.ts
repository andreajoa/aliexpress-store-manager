import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import type { StoreProductPayload } from "@/lib/publication-contract";
import { getGitHubPullRequestStatus } from "@/lib/github-pr-lifecycle";
import { verifyStoreProductPage } from "@/lib/vercel-preview-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function storePayload(value: unknown): StoreProductPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const product = root.product;
  if (root.protocolVersion !== "2026-08-01") return null;
  if (!product || typeof product !== "object" || Array.isArray(product)) return null;
  const data = product as Record<string, unknown>;
  if (typeof data.id !== "string" || typeof data.title !== "string" || !Array.isArray(data.variants)) {
    return null;
  }
  return value as StoreProductPayload;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const githubToken = process.env.GITHUB_PUBLISH_TOKEN?.trim();
  if (!githubToken) {
    return NextResponse.json(
      { ok: false, error: "GITHUB_PUBLISH_TOKEN não está configurado." },
      { status: 503 },
    );
  }

  const publication = await prisma.publication.findUnique({
    where: { id },
    include: { store: true },
  });
  if (!publication) {
    return NextResponse.json({ ok: false, error: "Publication não encontrada." }, { status: 404 });
  }

  const payload = storePayload(publication.payload);
  if (!payload || !publication.externalUrl || !publication.pullRequestNumber) {
    return NextResponse.json(
      { ok: false, error: "Publication sem payload, URL pública ou Pull Request válidos." },
      { status: 409 },
    );
  }

  const repository =
    publication.store.githubOwner && publication.store.githubRepo
      ? `${publication.store.githubOwner}/${publication.store.githubRepo}`
      : null;
  if (!repository) {
    return NextResponse.json(
      { ok: false, error: "Loja sem repositório GitHub configurado." },
      { status: 409 },
    );
  }

  try {
    const pullRequest = await getGitHubPullRequestStatus({
      token: githubToken,
      repository,
      pullRequestNumber: publication.pullRequestNumber,
    });

    if (!pullRequest.merged) {
      return NextResponse.json(
        {
          ok: false,
          pending: true,
          error: "O Pull Request ainda não foi incorporado à branch base.",
          pullRequest,
        },
        { status: 425 },
      );
    }

    const verification = await verifyStoreProductPage({
      pageUrl: publication.externalUrl,
      payload,
      productionUrl: publication.externalUrl,
    });

    if (!verification.ok) {
      const failed = verification.checks.filter((check) => !check.pass);
      await prisma.publication.update({
        where: { id: publication.id },
        data: {
          lastError: `Produção ainda não validada: ${failed.map((item) => item.code).join(", ")}`,
        },
      });
      return NextResponse.json(
        {
          ok: false,
          pending: true,
          error: "O merge foi concluído, mas a página de produção ainda não passou na verificação.",
          pullRequest,
          verification,
        },
        { status: 425 },
      );
    }

    const now = new Date();
    await prisma.publication.update({
      where: { id: publication.id },
      data: {
        status: "PUBLISHED",
        publishedAt: publication.publishedAt || now,
        lastSyncedAt: now,
        lastError: null,
      },
    });

    return NextResponse.json({
      ok: true,
      pullRequest,
      verification,
      publication: {
        id: publication.id,
        status: "PUBLISHED",
        externalUrl: publication.externalUrl,
        publishedAt: publication.publishedAt?.toISOString() || now.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao verificar produção.";
    await prisma.publication.update({
      where: { id: publication.id },
      data: { lastError: message },
    }).catch(() => undefined);

    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
