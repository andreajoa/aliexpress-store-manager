export type AmbCatalogProduct = {
  slug: string;
  name: string;
  color: string;
  sizes: string[];
  stock: number | null;
  unitCostUsd: number | null;
  sourceProductId: string | null;
  sourceColor: string | null;
};

export type AmbSupplierVariantSnapshot = {
  sourceProductId: string;
  color: string;
  size: string;
  stock: number;
  cost: number | null;
};

export type AmbDetectedBinding = {
  sourceProductId: string;
  color: string;
};

export type AmbBindingCandidate = AmbDetectedBinding & {
  score: number;
  evidence: {
    colorMatch: boolean;
    sizesMatch: boolean;
    stockMatch: boolean;
    costMatch: boolean;
  };
};

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function normalizeAmbValue(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAmbColor(value: unknown) {
  return normalizeAmbValue(value)
    .replace(/^[a-z]{2,}\d{2,}-/, "")
    .replace(/\boff[ -]?white\b/g, "off-white")
    .trim();
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.map(normalizeAmbValue).filter(Boolean))].sort();
}

function sameSet(left: string[], right: string[]) {
  const a = uniqueSorted(left);
  const b = uniqueSorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function extractJsonArrayAssignment(source: string, names: string[]) {
  for (const name of names) {
    const marker = new RegExp(`(?:const|export\\s+const)\\s+${name}\\s*:\\s*Product\\[\\]\\s*=\\s*\\[`, "m");
    const match = marker.exec(source);
    if (!match) continue;

    const start = match.index + match[0].lastIndexOf("[");
    if (start < match.index) continue;

    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const ch = source[index];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          quote = "";
        }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "[") depth += 1;
      if (ch === "]") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(start, index + 1);
        }
      }
    }
  }
  return null;
}

export function parseAmbGeneratedProductsSource(source: string): AmbCatalogProduct[] {
  const literal = extractJsonArrayAssignment(source, ["generatedProducts", "allGeneratedProducts"]);
  if (!literal) throw new Error("Não foi possível localizar generatedProducts ou allGeneratedProducts no catálogo AMB.");

  const jsonLiteral = literal.replace(/^\s*\.\.\.[A-Za-z0-9_$]+\s*,?\s*$/gm, "");

  let rows: unknown;
  try {
    rows = JSON.parse(jsonLiteral);
  } catch {
    throw new Error("generated-products.ts não contém um array JSON compatível com o scanner.");
  }
  if (!Array.isArray(rows)) throw new Error("Catálogo AMB inválido.");

  return rows.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const slug = text(row.slug);
    const name = text(row.name);
    const colorNames = Array.isArray(row.colorNames) ? row.colorNames.map(text).filter(Boolean) : [];
    const sizes = Array.isArray(row.sizes) ? row.sizes.map(text).filter(Boolean) : [];
    if (!slug || !name || colorNames.length !== 1 || sizes.length === 0) return [];
    return [{
      slug,
      name,
      color: colorNames[0],
      sizes,
      stock: numberOrNull(row.stock),
      unitCostUsd: numberOrNull(row.unitCostUsd),
      sourceProductId: text(row.sourceProductId) || null,
      sourceColor: text(row.sourceColor) || null,
    }];
  });
}

type SupplierGroup = {
  sourceProductId: string;
  color: string;
  sizes: string[];
  stock: number;
  costs: number[];
};

function supplierGroups(rows: AmbSupplierVariantSnapshot[]) {
  const groups = new Map<string, SupplierGroup>();
  for (const row of rows) {
    const key = `${row.sourceProductId}::${normalizeAmbColor(row.color)}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        sourceProductId: row.sourceProductId,
        color: row.color,
        sizes: [],
        stock: 0,
        costs: [],
      };
      groups.set(key, group);
    }
    group.sizes.push(row.size);
    group.stock += Math.max(0, Math.trunc(row.stock));
    if (row.cost != null && Number.isFinite(row.cost)) group.costs.push(row.cost);
  }
  return [...groups.values()];
}

export function rankAmbBindingCandidates(
  product: AmbCatalogProduct,
  supplierRows: AmbSupplierVariantSnapshot[],
): AmbBindingCandidate[] {
  return supplierGroups(supplierRows)
    .map((group) => {
      const colorMatch = normalizeAmbColor(product.color) === normalizeAmbColor(group.color);
      const sizesMatch = sameSet(product.sizes, group.sizes);
      const stockMatch = product.stock != null && Math.trunc(product.stock) === group.stock;
      const costMatch = product.unitCostUsd != null && group.costs.some((cost) => Math.abs(cost - product.unitCostUsd!) <= 0.03);
      const score =
        (colorMatch ? 5 : 0) +
        (sizesMatch ? 4 : 0) +
        (stockMatch ? 4 : 0) +
        (costMatch ? 3 : 0);
      return {
        sourceProductId: group.sourceProductId,
        color: group.color,
        score,
        evidence: { colorMatch, sizesMatch, stockMatch, costMatch },
      };
    })
    .filter((candidate) => candidate.score >= 7)
    .sort((a, b) => b.score - a.score || a.sourceProductId.localeCompare(b.sourceProductId));
}

export function inferAmbBinding(
  product: AmbCatalogProduct,
  supplierRows: AmbSupplierVariantSnapshot[],
) {
  const candidates = rankAmbBindingCandidates(product, supplierRows);
  const best = candidates[0] || null;
  const runnerUp = candidates[1] || null;
  const safe = Boolean(best && best.score >= 11 && (!runnerUp || best.score - runnerUp.score >= 3));
  return {
    safe,
    binding: safe && best ? { sourceProductId: best.sourceProductId, color: best.color } : null,
    candidates: candidates.slice(0, 5),
  };
}
