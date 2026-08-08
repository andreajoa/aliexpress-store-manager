import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

function root() {
  return path.join(process.cwd(), ".data", "editorials");
}

export function editorialLocalStorageKey(id: string) {
  return `.data/editorials/${id}.png`;
}

function safeLocalPath(storageKey: string) {
  const base = root();
  const candidate = path.resolve(process.cwd(), storageKey);
  const relative = path.relative(base, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return candidate;
}

export async function writeLocalEditorial(storageKey: string, bytes: Uint8Array) {
  const filePath = safeLocalPath(storageKey);
  if (!filePath) throw new Error("Invalid local editorial path.");
  await mkdir(root(), { recursive: true });
  await writeFile(filePath, bytes);
}

export async function readLocalEditorial(storageKey: string) {
  const filePath = safeLocalPath(storageKey);
  if (!filePath) return null;
  try {
    await access(filePath);
    const info = await stat(filePath);
    if (!info.isFile() || info.size <= 0) return null;
    return readFile(filePath);
  } catch {
    return null;
  }
}

export async function removeLocalEditorial(storageKey: string) {
  const filePath = safeLocalPath(storageKey);
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    // Development cache may already be absent.
  }
}
