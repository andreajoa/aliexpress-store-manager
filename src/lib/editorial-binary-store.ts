import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { prisma } from "./prisma";

export type EditorialStoredBinary = {
  bytes: Buffer;
  mimeType: string;
  sha256: string;
  byteSize: number;
  source: "database" | "local-file";
};

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function mimeFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

function validMime(value: string | null | undefined) {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

function safeStorageKey(value: string) {
  const key = value.trim();
  if (!key || key.length > 2000 || key.includes("\0")) {
    throw new Error("Invalid editorial storage key.");
  }
  return key;
}

function safeLocalEditorialPath(value: string) {
  const root = path.resolve(process.cwd(), ".data", "editorials");
  const candidate = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(process.cwd(), value);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return candidate;
}

export async function persistEditorialBinary(input: {
  storageKey: string;
  bytes: Uint8Array;
  mimeType?: string | null;
}) {
  const storageKey = safeStorageKey(input.storageKey);
  if (!input.bytes.length) throw new Error("Editorial binary is empty.");
  const bytes = Buffer.from(input.bytes);
  const sha256 = digest(bytes);
  const mimeType = validMime(input.mimeType) ? input.mimeType : mimeFromPath(storageKey);

  await prisma.editorialBinary.upsert({
    where: { storageKey },
    create: {
      storageKey,
      content: bytes,
      mimeType,
      sha256,
      byteSize: bytes.length,
    },
    update: {
      content: bytes,
      mimeType,
      sha256,
      byteSize: bytes.length,
    },
  });

  return { storageKey, mimeType, sha256, byteSize: bytes.length };
}

export async function readEditorialBinary(storageKeyValue: string): Promise<EditorialStoredBinary | null> {
  const storageKey = safeStorageKey(storageKeyValue);
  const stored = await prisma.editorialBinary.findUnique({
    where: { storageKey },
    select: { content: true, mimeType: true, sha256: true, byteSize: true },
  });

  if (stored) {
    const bytes = Buffer.from(stored.content);
    const sha256 = digest(bytes);
    if (sha256 !== stored.sha256 || bytes.length !== stored.byteSize) {
      throw new Error(`Editorial binary integrity check failed for ${storageKey}.`);
    }
    return {
      bytes,
      mimeType: validMime(stored.mimeType) ? stored.mimeType : "image/png",
      sha256,
      byteSize: bytes.length,
      source: "database",
    };
  }

  const localPath = safeLocalEditorialPath(storageKey);
  if (!localPath) return null;
  try {
    await access(localPath);
    const info = await stat(localPath);
    if (!info.isFile() || info.size <= 0) return null;
    const bytes = await readFile(localPath);
    return {
      bytes,
      mimeType: mimeFromPath(localPath),
      sha256: digest(bytes),
      byteSize: bytes.length,
      source: "local-file",
    };
  } catch {
    return null;
  }
}

export async function ensureEditorialBinary(storageKeyValue: string) {
  const resolved = await readEditorialBinary(storageKeyValue);
  if (!resolved) return null;
  if (resolved.source === "local-file") {
    await persistEditorialBinary({
      storageKey: storageKeyValue,
      bytes: resolved.bytes,
      mimeType: resolved.mimeType,
    });
  }
  return resolved;
}

export async function editorialBinaryExists(storageKeyValue: string) {
  return Boolean(await readEditorialBinary(storageKeyValue));
}
