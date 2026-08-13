function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type AmbExportVariantInput = {
  sourceSkuId: string;
  attributes: unknown;
  stock: number | null;
  costPrice: { toString(): string } | null;
};

export type AmbExportLineageEntry = {
  exportId: string;
  productId: string;
  sourceProductId: string;
  sourceUrl: string;
  exportedAt: string;
  colors: Array<{
    color: string;
    sizes: string[];
    sourceSkuIds: string[];
    stock: number;
    costs: number[];
  }>;
};

export function buildAmbExportLineageEntry(input: {
  productId: string;
  sourceProductId: string;
  sourceUrl: string;
  variants: AmbExportVariantInput[];
  now?: Date;
}): AmbExportLineageEntry {
  const byColor = new Map<string, AmbExportLineageEntry["colors"][number]>();

  for (const variant of input.variants) {
    const attributes = record(variant.attributes);
    const color = text(attributes.Color);
    const size = text(attributes.Size);
    if (!color || !size) continue;

    let group = byColor.get(color);
    if (!group) {
      group = { color, sizes: [], sourceSkuIds: [], stock: 0, costs: [] };
      byColor.set(color, group);
    }
    group.sizes.push(size);
    group.sourceSkuIds.push(variant.sourceSkuId);
    group.stock += Math.max(0, Math.trunc(variant.stock || 0));
    const cost = numberOrNull(variant.costPrice?.toString());
    if (cost != null) group.costs.push(cost);
  }

  const exportedAt = (input.now || new Date()).toISOString();
  return {
    exportId: `${input.productId}:${exportedAt}`,
    productId: input.productId,
    sourceProductId: input.sourceProductId,
    sourceUrl: input.sourceUrl,
    exportedAt,
    colors: [...byColor.values()].map((group) => ({
      ...group,
      sizes: [...new Set(group.sizes)],
      sourceSkuIds: [...new Set(group.sourceSkuIds)],
      costs: [...new Set(group.costs.map((value) => Number(value.toFixed(4))))],
    })),
  };
}

export function parseAmbExportLineage(value: unknown): AmbExportLineageEntry[] {
  const capabilities = record(value);
  const lineage = record(capabilities.ambExportLineage);
  if (Number(lineage.version) !== 1 || !Array.isArray(lineage.exports)) return [];

  return lineage.exports.flatMap((raw) => {
    const row = record(raw);
    const productId = text(row.productId);
    const sourceProductId = text(row.sourceProductId);
    const sourceUrl = text(row.sourceUrl);
    const exportedAt = text(row.exportedAt);
    const exportId = text(row.exportId);
    const rawColors = Array.isArray(row.colors) ? row.colors : [];
    const colors = rawColors.flatMap((rawColor) => {
      const colorRow = record(rawColor);
      const color = text(colorRow.color);
      if (!color) return [];
      return [{
        color,
        sizes: Array.isArray(colorRow.sizes) ? colorRow.sizes.map(text).filter(Boolean) : [],
        sourceSkuIds: Array.isArray(colorRow.sourceSkuIds) ? colorRow.sourceSkuIds.map(text).filter(Boolean) : [],
        stock: Math.max(0, Math.trunc(numberOrNull(colorRow.stock) || 0)),
        costs: Array.isArray(colorRow.costs)
          ? colorRow.costs.map(numberOrNull).filter((candidate): candidate is number => candidate != null)
          : [],
      }];
    });
    if (!productId || !sourceProductId || colors.length === 0) return [];
    return [{ exportId, productId, sourceProductId, sourceUrl, exportedAt, colors }];
  });
}
