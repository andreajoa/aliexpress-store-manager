import { NextResponse } from "next/server";

import { readEditorialPersistentFile } from "@/lib/editorial-persistent-access";
import { prisma } from "@/lib/prisma";
import type { PublicationPlan } from "@/lib/publication-plan";
import { executeGitHubPublication } from "@/lib/github-publication-executor";
import { GitHubRestPublicationTransport } from "@/lib/github-rest-publication-transport";

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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body JSON inválido." },
      { status: 400 },
    );
  }

  if (!confirmed(body)) {
    return NextResponse.json(
      {
        ok: false,
        error: "A execução real exige confirmação explícita confirm=true.",
      },
      { status: 400 },
    );
  }

  const token = process.env.GITHUB_PUBLISH_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error: "GITHUB_PUBLISH_TOKEN não está configurado no ambiente do Store Manager.",
      },
      { status: 503 },
    );
  }

  const publication = await prisma.publication.findUnique({
    where: { id },
    select: {
      id: true,
      productId: true,
      storeId: true,
      status: true,
      githubBranch: true,
      githubCommitSha: true,
      pullRequestNumber: true,
    },
  });

  if (!publication) {
    return NextResponse.json(
      { ok: false, error: "Publication não encontrada." },
      { status: 404 },
    );
  }

  if (
    publication.githubBranch ||
    publication.githubCommitSha ||
    publication.pullRequestNumber
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Esta Publication já possui execução GitHub registrada. O endpoint não duplica branch, commit ou PR.",
        publication: {
          status: publication.status,
          githubBranch: publication.githubBranch,
          githubCommitSha: publication.githubCommitSha,
          pullRequestNumber: publication.pullRequestNumber,
        },
      },
      { status: 409 },
    );
  }

  const planUrl = new URL(`/api/publications/${id}/dry-run`, request.url);
  const planResponse = await fetch(planUrl, {
    method: "GET",
    cache: "no-store",
  });
  const planData = await planResponse.json();

  if (!planResponse.ok || !planData.plan) {
    return NextResponse.json(
      {
        ok: false,
        error: planData.error || "Não foi possível carregar o Publication Plan.",
      },
      { status: planResponse.status || 500 },
    );
  }

  const plan = planData.plan as PublicationPlan;
  if (!plan.ready) {
    return NextResponse.json(
      {
        ok: false,
        error: "Publication Plan bloqueado. Nenhuma escrita GitHub foi executada.",
        blockers: plan.blockers,
      },
      { status: 409 },
    );
  }

  const selectedEditorials = await prisma.editorialAsset.findMany({
    where: {
      productId: publication.productId,
      storeId: publication.storeId,
      selected: true,
    },
    select: {
      generatedPath: true,
    },
  });

  const assetSources: Record<string, Uint8Array> = {};
  for (const asset of selectedEditorials) {
    if (!asset.generatedPath) continue;
    try {
      assetSources[asset.generatedPath] = new Uint8Array(
        await readEditorialPersistentFile(asset.generatedPath),
      );
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: `Asset editorial selecionado não está disponível: ${asset.generatedPath}`,
        },
        { status: 409 },
      );
    }
  }

  try {
    const result = await executeGitHubPublication({
      plan,
      assetSources,
      transport: new GitHubRestPublicationTransport(token),
    });

    if (!result.ready || result.outcome === "blocked") {
      return NextResponse.json(
        {
          ok: false,
          error: "Executor GitHub bloqueou a publicação antes de criar PR.",
          result,
        },
        { status: 409 },
      );
    }

    if (result.outcome === "noop") {
      return NextResponse.json({
        ok: true,
        result,
        publication: {
          id: publication.id,
          status: publication.status,
        },
      });
    }

    await prisma.publication.update({
      where: { id: publication.id },
      data: {
        status: "PUBLISHING",
        githubBranch: result.publicationBranch,
        githubCommitSha: result.commitSha,
        pullRequestNumber: result.pullRequestNumber,
      },
    });

    return NextResponse.json({
      ok: true,
      result,
      publication: {
        id: publication.id,
        status: "PUBLISHING",
        githubBranch: result.publicationBranch,
        githubCommitSha: result.commitSha,
        pullRequestNumber: result.pullRequestNumber,
        pullRequestUrl: result.pullRequestUrl,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Falha inesperada no executor GitHub.",
      },
      { status: 502 },
    );
  }
}
