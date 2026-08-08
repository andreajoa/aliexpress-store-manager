import fs from "node:fs/promises";
import path from "node:path";

function root() {
  return path.join(
    process.cwd(),
    ".data",
    "editorials"
  );
}

export async function saveEditorialImage(
  id: string,
  buffer: Buffer
) {
  await fs.mkdir(
    root(),
    {
      recursive: true,
    }
  );

  const filepath =
    path.join(
      root(),
      `${id}.png`
    );

  await fs.writeFile(
    filepath,
    buffer
  );

  return filepath;
}

export async function readEditorialImage(
  filepath: string
) {
  return fs.readFile(
    filepath
  );
}

export async function removeEditorialImage(
  filepath:
    | string
    | null
    | undefined
) {
  if (!filepath) return;

  try {
    await fs.unlink(
      filepath
    );
  } catch {
    // Arquivo pode já não existir.
  }
}
