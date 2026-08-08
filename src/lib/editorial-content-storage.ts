import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "./prisma";

export type EditorialContentRecord = {
  id: string;
  generatedPath: string | null;
  content: Uint8Array | null;
  mimeType: string | null;
  contentSha256: string | null;
  contentBytes: number | null;
};

export type EditorialBinary = {
  bytes: Buffer;
  mimeType: string;
  sha256: string;
  byteSize: number;
  source: "database" | "local-file";
};

function mimeFromPath(filePath: string | null | undefined) {
  const extension = path.extname(filePath || "").toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validImageMime(value: string | null | undefined) {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

function localEditorialPath(generatedPath: string | null | undefined) {
  if (!generatedPath || generatedPath.includes("\0")) return null;
  const root = path.resolve(process.cwd(), ".data", "editorials");
  const candidate = path.isAbsolute(generatedPath)
    ? path.resolve(generatedPath)
    : path.resolve(process.cwd(), generatedPath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return candidate;
}

async function readLocalFallback(generatedPath: string | null | undefined) {
  const candidate = localEditorialPath(generatedPath);
  if (!candidate) return null;
  try {
    await access(candidate);
    const bytes = await readFile(candidate);
    if (!bytes.length) return null;
    return {
      bytes,
      mimeType: mimeFromPath(candidate),
      sha256: sha256(bytes),
      byteSize: bytes.length,
      source: "local-file" as const,
    };
  } catch {
    return null;
  }
}

export async function persistEditorialContent(input: {
  assetId: string;
  bytes: Uint8Array;
  mimeType?: string | null;
}) {
  if (!input.bytes.length) throw new Error("Editorial binary is empty.");
  const mimeType = validImageMime(input.mimeType) ? input.mimeType : "image/png";
  const digest = sha256(input.bytes);

  return prisma.editorialAsset.update({
    where: { id: input.assetId },
    data: {
      content: Buffer.from(input.bytes),
      mimeType,
      contentSha256: digest,
      contentBytes: input.bytes.length,
    },
    select: {
      id: true,
      mimeType: true,
      contentSha256: true,
      contentBytes: true,
    },
  });
}

export async function persistEditorialContentFromLocalPath(input: {
  assetId: string;
  generatedPath: string;
}) {
  const local = await readLocalFallback(input.generatedPath);
  if (!local) {
    throw new Error("Editorial local file is unavailable for persistence.");
  }
  await persistEditorialContent({
    assetId: input.assetId,
    bytes: local.bytes,
    mimeType: local.mimeType,
  });
  return local;
}

export async function readEditorialContent(asset: EditorialContentRecord): Promise<EditorialBinary | null> {
  if (asset.content && asset.content.length > 0) {
    const bytes = Buffer.from(asset.content);
    const digest = sha256(bytes);
    if (asset.contentSha256 && asset.contentSha256 !== digest) {
      throw new Error(`Editorial content checksum mismatch for ${asset.id}.`);
    }
    if (asset.contentBytes !== null && asset.contentBytes !== bytes.length) {
      throw new Error(`Editorial content byte-size mismatch for ${asset.id}.`);
    }
    return {
      bytes,
      mimeType: validImageMime(asset.mimeType) ? asset.mimeType : "image/png",
      sha256: digest,
      byteSize: bytes.length,
      source: "database",
    };
  }

  return readLocalFallback(asset.generatedPath);
}

export async function ensureEditorialContent(asset: EditorialContentRecord): Promise<EditorialBinary | null> {
  const resolved = await readEditorialContent(asset);
  if (!resolved) return null;
  if (resolved.source === "local-file") {
    await persistEditorialContent({
      assetId: asset.id,
      bytes: resolved.bytes,
      mimeType: resolved.mimeType,
    });
  }
  return resolved;
}

export function editorialContentMetadata(asset: EditorialContentRecord) {
  return {
    persistent: Boolean(asset.content && asset.content.length > 0),
    mimeType: asset.mimeType,
    sha256: asset.contentSha256,
    byteSize: asset.contentBytes,
  };
}
