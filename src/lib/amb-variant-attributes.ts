function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/** Keep canonical Size unchanged; official formalwear SKUs can use US Size. */
export function ambVariantSize(attributes: Record<string, unknown>): string {
  return text(attributes.Size) || text(attributes["US Size"]);
}

function normalized(value: unknown): string {
  return text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function matchesAmbVariantSelection(
  attributes: Record<string, unknown>, color: string, size: string,
): boolean {
  return normalized(attributes.Color) === normalized(color)
    && normalized(ambVariantSize(attributes)) === normalized(size);
}
