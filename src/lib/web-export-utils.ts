export function safeExportName(
  value: string
) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9-_ ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .toLowerCase() ||
    "item"
  );
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  let text =
    typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  text = text.replace(/"/g, '""');
  return `"${text}"`;
}

export function csvFromExportRows(
  rows: Record<string, unknown>[]
) {
  if (rows.length === 0) {
    return "";
  }

  const keys = Array.from(
    new Set(
      rows.flatMap((row) => Object.keys(row))
    )
  );

  const lines = [
    keys.map(csvEscape).join(","),
    ...rows.map((row) =>
      keys
        .map((key) => csvEscape(row[key]))
        .join(",")
    ),
  ];

  return "\uFEFF" + lines.join("\n");
}

function extensionFromContentType(
  contentType: string
) {
  const normalized = contentType.toLowerCase();

  if (normalized.includes("png")) return ".png";
  if (normalized.includes("webp")) return ".webp";
  if (normalized.includes("gif")) return ".gif";
  if (normalized.includes("avif")) return ".avif";
  return ".jpg";
}

export async function fetchExportImage({
  url,
  fetchImpl = fetch,
}: {
  url: string;
  fetchImpl?: typeof fetch;
}) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "image/*",
      "User-Agent": "Store-Manager/1.0",
    },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType =
    response.headers.get("content-type") ||
    "image/jpeg";
  const bytes = new Uint8Array(
    await response.arrayBuffer()
  );

  if (!bytes.length) {
    throw new Error("Imagem vazia.");
  }

  return {
    bytes,
    extension:
      extensionFromContentType(contentType),
    contentType,
  };
}

export function jsonObject(
  value: unknown
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
}

export function benefitText(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is string =>
            typeof item === "string"
        )
        .join(" | ")
    : "";
}

export function attachmentHeaders(
  filename: string
) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "-");

  return {
    "Content-Type": "application/zip",
    "Content-Disposition":
      `attachment; filename="${safe}"`,
    "Cache-Control": "private, no-store",
  };
}
