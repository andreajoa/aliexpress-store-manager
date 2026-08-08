import {
  ensureEditorialBinary,
  readEditorialBinary,
} from "./editorial-binary-store";

export async function readEditorialPersistentFile(storageKey: string) {
  const resolved = await ensureEditorialBinary(storageKey);
  if (!resolved) {
    throw new Error(`Editorial content is unavailable: ${storageKey}`);
  }
  return resolved.bytes;
}

export async function editorialPersistentFileInfo(storageKey: string) {
  const resolved = await readEditorialBinary(storageKey);
  if (!resolved) return null;
  return {
    isFile: () => true,
    size: resolved.byteSize,
    mimeType: resolved.mimeType,
    sha256: resolved.sha256,
    source: resolved.source,
  };
}

export async function editorialPersistentFileExists(storageKey: string) {
  return Boolean(await readEditorialBinary(storageKey));
}
