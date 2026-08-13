import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import type { StoreProductPayload } from "@/lib/publication-contract";
import { parsePublicationTargetContract } from "@/lib/publication-target-contract";
import {
  discoverReadyVercelPreview,
  verifyVercelProductPreview,
} from "@/lib/vercel-preview-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function storePayload(value: unknown): StoreProductPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const product = root.product;
  if (root.protocolVersion !== "2026-08-01") return null;
  if (!product || typeof product !== "object" || Array.isArray(product)) return null;
  const data = product as Record<string, unknown>;
  if (typeof data.id !== "string" || typeof data.title !== "string") return null;
  if (!Array.isArray(data.variants)) return null;
  if (!data.seo || typeof data.seo !== "object" || Array.isArray(data.seo)) return null;
  return value as StoreProductPayload;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const vercelToken = process.env.VERCEL_API_TOKEN?.trim();
  if (!vercelToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "VERCEL_API_TOKEN não está configurado no ambiente do Store Manager.",
      },
      { status: 503 },
    );
  }

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

  if (!publication.githubCommitSha || !publication.pullRequestNumber) {
    return NextResponse.json(
      {
        ok: false,
        error: "A Publication ainda não possui commit e Pull Request para verificar.",
      },
      { status: 409 },
    );
  }

  if (!publication.externalUrl) {
    return NextResponse.json(
      { ok: false, error: "Publication sem URL pública esperada." },
      { status: 409 },
    );
  }

  const payload = storePayload(publication.payload);
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "Payload de publicação inválido ou ausente." },
      { status: 409 },
    );
  }

  const contract = parsePublicationTargetContract(
    publication.store.connectorCapabilities,
  );
  if (!contract.valid || contract.target?.kind !== "github-catalog") {
    return NextResponse.json(
      {
        ok: false,
        error: "Contrato GitHub de publicação ausente ou inválido.",
        issues: contract.issues,
      },
      { status: 409 },
    );
  }

  const previewTarget = contract.target.preview;
  if (!previewTarget || previewTarget.provider !== "vercel") {
    return NextResponse.json(
      {
        ok: false,
        error: "A loja não declara publicationTarget.preview para Vercel.",
      },
      { status: 409 },
    );
  }

  try {
    const deployment = await discoverReadyVercelPreview({
      token: vercelToken,
      target: previewTarget,
      commitSha: publication.githubCommitSha,
    });

    if (!deployment) {
      return NextResponse.json(
        {
          ok: false,
          pending: true,
          error: "O Preview Vercel desse commit ainda não está READY.",
        },
        { status: 425 },
      );
    }

    const verification = await verifyVercelProductPreview({
      deployment,
      payload,
      productionUrl: publication.externalUrl,
      bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET || null,
    });

    if (!verification.ok) {
      const failed = verification.checks.filter((check) => !check.pass);
      await prisma.publication.update({
        where: { id: publication.id },
        data: {
          lastError: `Preview reprovado: ${failed.map((item) => item.code).join(", ")}`,
        },
      });
      return NextResponse.json(
        {
          ok: false,
          error: "O Preview foi encontrado, mas não passou em todas as verificações.",
          verification,
        },
        { status: 409 },
      );
    }

    await prisma.publication.update({
      where: { id: publication.id },
      data: {
        previewUrl: verification.previewProductUrl,
        lastError: null,
      },
    });

    return NextResponse.json({
      ok: true,
      verification,
      publication: {
        id: publication.id,
        status: publication.status,
        previewUrl: verification.previewProductUrl,
        pullRequestNumber: publication.pullRequestNumber,
      },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Falha inesperada ao verificar Preview.";

    await prisma.publication.update({
      where: { id: publication.id },
      data: { lastError: message },
    }).catch(() => undefined);

    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
