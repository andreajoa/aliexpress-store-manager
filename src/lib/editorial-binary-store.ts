import { createHash } from "node:crypto";

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

function mimeFromStorageKey(storageKey: string) {
  const lower = storageKey.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
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

function r2Config() {
  const baseUrl = process.env.R2_GATEWAY_URL?.trim().replace(/\/+$/, "");
  const token = process.env.R2_GATEWAY_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

function r2ObjectUrl(baseUrl: string, storageKey: string) {
  const normalized = storageKey.replace(/^\/+/, "");
  return `${baseUrl}/objects/${encodeURIComponent(`editorials/${normalized}`)}`;
}

async function putToR2(storageKey: string, bytes: Buffer, mimeType: string, sha256: string) {
  const cfg = r2Config();
  if (!cfg) return false;
  const response = await fetch(r2ObjectUrl(cfg.baseUrl, storageKey), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": mimeType,
      "x-content-sha256": sha256,
    },
    body: new Uint8Array(bytes),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`R2 editorial upload failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return true;
}

async function getFromR2(storageKey: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const cfg = r2Config();
  if (!cfg) return null;
  const response = await fetch(r2ObjectUrl(cfg.baseUrl, storageKey), {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`R2 editorial read failed (${response.status}).`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type");
  return {
    bytes: Buffer.from(arrayBuffer),
    mimeType: validMime(contentType) ? contentType : mimeFromStorageKey(storageKey),
  };
}

async function headFromR2(storageKey: string): Promise<boolean> {
  const cfg = r2Config();
  if (!cfg) return false;
  const response = await fetch(r2ObjectUrl(cfg.baseUrl, storageKey), {
    method: "HEAD",
    headers: { Authorization: `Bearer ${cfg.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return response.status === 200;
}

async function removeFromR2(storageKey: string) {
  const cfg = r2Config();
  if (!cfg) return;
  const response = await fetch(r2ObjectUrl(cfg.baseUrl, storageKey), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${cfg.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 editorial delete failed (${response.status}).`);
  }
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
  const mimeType = validMime(input.mimeType) ? input.mimeType : mimeFromStorageKey(storageKey);

  const storedInR2 = await putToR2(storageKey, bytes, mimeType, sha256);
  const dbContent = storedInR2 ? Buffer.alloc(0) : bytes;

  await prisma.editorialBinary.upsert({
    where: { storageKey },
    create: {
      storageKey,
      content: dbContent,
      mimeType,
      sha256,
      byteSize: bytes.length,
    },
    update: {
      content: dbContent,
      mimeType,
      sha256,
      byteSize: bytes.length,
    },
  });

  return { storageKey, mimeType, sha256, byteSize: bytes.length };
}

export async function deleteEditorialBinary(storageKeyValue: string) {
  const storageKey = safeStorageKey(storageKeyValue);
  await removeFromR2(storageKey);
  await prisma.editorialBinary.deleteMany({ where: { storageKey } });
}

export async function readEditorialBinary(storageKeyValue: string): Promise<EditorialStoredBinary | null> {
  const storageKey = safeStorageKey(storageKeyValue);
  const stored = await prisma.editorialBinary.findUnique({
    where: { storageKey },
    select: { content: true, mimeType: true, sha256: true, byteSize: true },
  });

  if (stored && stored.content.length > 0) {
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

  const r2Stored = await getFromR2(storageKey);
  if (r2Stored && r2Stored.bytes.length > 0) {
    const sha256 = digest(r2Stored.bytes);
    if (stored && (sha256 !== stored.sha256 || r2Stored.bytes.length !== stored.byteSize)) {
      throw new Error(`Editorial R2 binary integrity check failed for ${storageKey}.`);
    }
    return {
      bytes: r2Stored.bytes,
      mimeType: stored && validMime(stored.mimeType) ? stored.mimeType : r2Stored.mimeType,
      sha256,
      byteSize: r2Stored.bytes.length,
      source: "database",
    };
  }

  if (process.env.NODE_ENV === "production") return null;

  const { readLocalEditorial } = await import("./editorial-local-fallback");
  const localBytes = await readLocalEditorial(storageKey);
  if (!localBytes?.length) return null;
  return {
    bytes: Buffer.from(localBytes),
    mimeType: mimeFromStorageKey(storageKey),
    sha256: digest(localBytes),
    byteSize: localBytes.length,
    source: "local-file",
  };
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
  const storageKey = safeStorageKey(storageKeyValue);
  const stored = await prisma.editorialBinary.findUnique({
    where: { storageKey },
    select: { content: true, byteSize: true },
  });
  if (stored && stored.content.length > 0) return true;
  if (r2Config()) {
    const existsInR2 = await headFromR2(storageKey);
    if (existsInR2) return true;
  }
  if (process.env.NODE_ENV === "production") return false;
  return Boolean(await readEditorialBinary(storageKey));
}
