import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import type { StoreProductPayload } from "@/lib/publication-contract";
import { parsePublicationTargetContract } from "@/lib/publication-target-contract";
import { mergeGitHubPullRequest } from "@/lib/github-pr-lifecycle";
import { verifyStoreProductPage } from "@/lib/vercel-preview-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function confirmed(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).confirm === true,
  );
}

function storePayload(value: unknown): StoreProductPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const product = root.product;
  if (root.protocolVersion !== "2026-08-01") return null;
  if (!product || typeof product !== "object" || Array.isArray(product)) return null;
  const data = product as Record<string, unknown>;
  if (typeof data.id !== "string" || typeof data.title !== "string") return null;
  if (!Array.isArray(data.variants)) return null;
  return value as StoreProductPayload;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON inválido." }, { status: 400 });
  }

  if (!confirmed(body)) {
    return NextResponse.json(
      { ok: false, error: "O merge exige confirmação explícita confirm=true." },
      { status: 400 },
    );
  }

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
  if (!payload || !publication.externalUrl) {
    return NextResponse.json(
      { ok: false, error: "Publication sem payload ou URL pública válidos." },
      { status: 409 },
    );
  }

  if (!publication.previewUrl) {
    return NextResponse.json(
      { ok: false, error: "O Preview ainda não foi verificado e aprovado pelo verificador automático." },
      { status: 409 },
    );
  }

  if (!publication.githubBranch || !publication.githubCommitSha || !publication.pullRequestNumber) {
    return NextResponse.json(
      { ok: false, error: "Publication sem branch, commit ou Pull Request completos." },
      { status: 409 },
    );
  }

  const contract = parsePublicationTargetContract(publication.store.connectorCapabilities);
  if (!contract.valid || contract.target?.kind !== "github-catalog") {
    return NextResponse.json(
      { ok: false, error: "Contrato GitHub de publicação inválido.", issues: contract.issues },
      { status: 409 },
    );
  }

  const repository =
    publication.store.githubOwner && publication.store.githubRepo
      ? `${publication.store.githubOwner}/${publication.store.githubRepo}`
      : null;
  const baseBranch = publication.store.githubBranch;
  if (!repository || !baseBranch) {
    return NextResponse.json(
      { ok: false, error: "Loja sem repositório ou branch base configurados." },
      { status: 409 },
    );
  }

  try {
    const previewVerification = await verifyStoreProductPage({
      pageUrl: publication.previewUrl,
      payload,
      productionUrl: publication.externalUrl,
      bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET || null,
    });

    if (!previewVerification.ok) {
      const failed = previewVerification.checks.filter((check) => !check.pass);
      await prisma.publication.update({
        where: { id: publication.id },
        data: {
          previewUrl: null,
          lastError: `Preview deixou de ser válido: ${failed.map((item) => item.code).join(", ")}`,
        },
      });
      return NextResponse.json(
        {
          ok: false,
          error: "O Preview não passou na revalidação imediatamente anterior ao merge.",
          verification: previewVerification,
        },
        { status: 409 },
      );
    }

    const merge = await mergeGitHubPullRequest({
      token: githubToken,
      repository,
      pullRequestNumber: publication.pullRequestNumber,
      expectedHeadSha: publication.githubCommitSha,
      expectedHeadRef: publication.githubBranch,
      expectedBaseRef: baseBranch,
      commitTitle: `Store Manager: publicar ${payload.product.title}`,
    });

    await prisma.publication.update({
      where: { id: publication.id },
      data: {
        status: "PUBLISHING",
        lastError: null,
      },
    });

    return NextResponse.json({
      ok: true,
      merge,
      previewVerification,
      publication: {
        id: publication.id,
        status: "PUBLISHING",
        externalUrl: publication.externalUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao aprovar merge.";
    await prisma.publication.update({
      where: { id: publication.id },
      data: { lastError: message },
    }).catch(() => undefined);

    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
