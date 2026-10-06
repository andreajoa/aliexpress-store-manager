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
  if (normalized(attributes.Color) !== normalized(color)) return false;
  // Bags are sold as "One Size" in the store; the supplier may carry a single
  // descriptive Size ("Luxury Bag", "29x23x10cm") or none. Colour decides, and
  // the bridge still blocks the order unless exactly one variant matches.
  if (normalized(size) === "one size") return true;
  return normalized(ambVariantSize(attributes)) === normalized(size);
}
