import { NextResponse } from "next/server";

import { readEditorialPersistentFile } from "@/lib/editorial-persistent-access";
import { prisma } from "@/lib/prisma";
import type { PublicationPlan } from "@/lib/publication-plan";
import {
  buildRepositoryDryRun,
  type RepositorySnapshot,
} from "@/lib/repository-dry-run";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 500;

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseSnapshot(value: unknown): RepositorySnapshot | null {
  const root = objectValue(value);
  const filesValue = objectValue(root.files);
  const entries = Object.entries(filesValue);

  if (entries.length === 0 || entries.length > MAX_FILES) {
    return null;
  }

  const files: Record<string, string> = {};

  for (const [path, content] of entries) {
    if (!path.trim() || typeof content !== "string") {
      return null;
    }
    files[path] = content;
  }

  return { files };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const contentLength = Number(request.headers.get("content-length") || "0");

  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "O snapshot excede o limite local de 5 MB." },
      { status: 413 },
    );
  }

  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "O snapshot excede o limite local de 5 MB." },
      { status: 413 },
    );
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Snapshot JSON inválido." },
      { status: 400 },
    );
  }

  const snapshot = parseSnapshot(objectValue(body).snapshot);

  if (!snapshot) {
    return NextResponse.json(
      {
        ok: false,
        error: "Informe snapshot.files com pelo menos um arquivo textual válido.",
      },
      { status: 400 },
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

  const publication = await prisma.publication.findUnique({
    where: { id },
    select: {
      id: true,
      productId: true,
      storeId: true,
    },
  });

  if (!publication) {
    return NextResponse.json(
      { ok: false, error: "Publication não encontrada." },
      { status: 404 },
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
      // The dry-run engine will remain fail-closed if a planned asset source
      // is missing; never invent bytes or silently read a server filesystem.
    }
  }

  const result = buildRepositoryDryRun({
    plan,
    snapshot,
    assetSources,
  });

  const {
    resultingSnapshot: _resultingSnapshot,
    ...safeResult
  } = result;

  void _resultingSnapshot;

  return NextResponse.json({
    ok: true,
    result: safeResult,
  });
}
