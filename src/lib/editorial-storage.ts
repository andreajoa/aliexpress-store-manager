import {
  deleteEditorialBinary,
  persistEditorialBinary,
  readEditorialBinary,
} from "./editorial-binary-store";

function storageKey(id: string) {
  const safeId = id.trim();
  if (!safeId || safeId.includes("/") || safeId.includes("\\") || safeId.includes("\0")) {
    throw new Error("Invalid editorial image id.");
  }
  return `.data/editorials/${safeId}.png`;
}

export async function saveEditorialImage(
  id: string,
  buffer: Buffer,
) {
  const key = storageKey(id);

  // Durable storage is authoritative. If this fails, the editorial must not
  // be marked as generated; a transient local file is never enough online.
  await persistEditorialBinary({
    storageKey: key,
    bytes: buffer,
    mimeType: "image/png",
  });

  if (process.env.NODE_ENV !== "production") {
    const { writeLocalEditorial } = await import("./editorial-local-fallback");
    await writeLocalEditorial(key, buffer);
  }

  return key;
}

export async function readEditorialImage(
  storageKeyValue: string,
) {
  const resolved = await readEditorialBinary(storageKeyValue);
  if (!resolved) throw new Error(`Editorial content is unavailable: ${storageKeyValue}`);
  return resolved.bytes;
}

export async function removeEditorialImage(
  storageKeyValue: string | null | undefined,
) {
  if (!storageKeyValue) return;

  await deleteEditorialBinary(storageKeyValue);

  if (process.env.NODE_ENV !== "production") {
    const { removeLocalEditorial } = await import("./editorial-local-fallback");
    await removeLocalEditorial(storageKeyValue);
  }
}
