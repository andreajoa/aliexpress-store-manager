import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export function safeName(
  value: string
) {
  return (
    value
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      )
      .replace(
        /[^a-zA-Z0-9-_ ]+/g,
        ""
      )
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .toLowerCase() ||
    "item"
  );
}

export function downloadsRoot() {
  return path.join(
    os.homedir(),
    "Downloads",
    "Store Manager"
  );
}

export function csvEscape(
  value: unknown
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  let text =
    typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  text = text.replace(
    /"/g,
    '""'
  );

  return `"${text}"`;
}

export function csvFromRows(
  rows: Record<
    string,
    unknown
  >[]
) {
  if (
    rows.length === 0
  ) {
    return "";
  }

  const keys =
    Array.from(
      new Set(
        rows.flatMap(
          row =>
            Object.keys(row)
        )
      )
    );

  const lines = [
    keys
      .map(csvEscape)
      .join(","),

    ...rows.map(
      row =>
        keys
          .map(
            key =>
              csvEscape(
                row[key]
              )
          )
          .join(",")
    ),
  ];

  /*
   * BOM UTF-8 para Excel/Numbers
   * reconhecer acentos corretamente.
   */
  return (
    "\uFEFF" +
    lines.join("\n")
  );
}

export async function ensureDir(
  directory: string
) {
  await fs.mkdir(
    directory,
    {
      recursive: true,
    }
  );
}

function extensionFromType(
  contentType: string
) {
  if (
    contentType.includes(
      "png"
    )
  ) {
    return ".png";
  }

  if (
    contentType.includes(
      "webp"
    )
  ) {
    return ".webp";
  }

  return ".jpg";
}

export async function saveRemoteImage({
  url,
  targetBase,
}: {
  url: string;
  targetBase: string;
}) {
  const response =
    await fetch(url, {
      headers: {
        Accept:
          "image/*",

        "User-Agent":
          "Store-Manager/1.0",
      },

      signal:
        AbortSignal.timeout(
          30000
        ),
    });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) ||
    "image/jpeg";

  const extension =
    extensionFromType(
      contentType
    );

  const finalPath =
    targetBase +
    extension;

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  await fs.writeFile(
    finalPath,
    buffer
  );

  return finalPath;
}

export async function writeText(
  filepath: string,
  content: string
) {
  await ensureDir(
    path.dirname(
      filepath
    )
  );

  await fs.writeFile(
    filepath,
    content,
    "utf8"
  );
}
