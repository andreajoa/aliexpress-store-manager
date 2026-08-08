export type CanonicalVariantForMapping = {
  id: string;
  sourceSkuId?: string | null;
  name: string;
  attributes?: unknown;
};

export type SupplierVariantForMapping = {
  id: string;
  sourceSkuId: string;
  name: string;
  attributes?: unknown;
  price?: number | null;
  stock?: number | null;
};

export type VariantMappingCandidate = {
  canonicalVariantId: string;
  supplierVariantId: string;
  supplierSourceSkuId: string;
  confidence: number;
  status: "exact" | "high" | "review" | "unsafe";
  reasons: string[];
};

export type VariantMappingSuggestion = {
  canonicalVariantId: string;
  canonicalVariantName: string;
  selected: VariantMappingCandidate | null;
  alternatives: VariantMappingCandidate[];
  requiresReview: boolean;
  blocker: string | null;
};

export type VariantMappingReport = {
  readyForAutomaticConfirmation: boolean;
  suggestions: VariantMappingSuggestion[];
  unmatchedCanonicalVariantIds: string[];
  ambiguousCanonicalVariantIds: string[];
};

const COLOR_ALIASES: Record<string, string> = {
  violet: "purple",
  lilac: "purple",
  lilas: "purple",
  roxo: "purple",
  roxa: "purple",
  preto: "black",
  preta: "black",
  negro: "black",
  negra: "black",
  verde: "green",
  rosa: "pink",
  pink: "pink",
  vermelho: "red",
  vermelha: "red",
  azul: "blue",
  branco: "white",
  branca: "white",
  amarelo: "yellow",
  amarela: "yellow",
  cinza: "gray",
  grey: "gray",
};

function normalizedText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/([0-9]+)\s*(pieces|piece|pcs|pc|pecas|peca)/g, "$1pcs")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedToken(token: string) {
  return COLOR_ALIASES[token] || token;
}

function tokens(value: unknown) {
  return new Set(
    normalizedText(value)
      .split(/\s+/)
      .filter(Boolean)
      .map(normalizedToken),
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function attributesTokens(value: unknown) {
  const result = new Set<string>();
  for (const [key, raw] of Object.entries(objectValue(value))) {
    for (const token of tokens(key)) result.add(token);
    for (const token of tokens(raw)) result.add(token);
  }
  return result;
}

function intersectionSize(a: Set<string>, b: Set<string>) {
  let count = 0;
  for (const value of a) if (b.has(value)) count += 1;
  return count;
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = intersectionSize(a, b);
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function extractQuantityTokens(value: Set<string>) {
  return new Set([...value].filter((token) => /^\d+pcs$/.test(token)));
}

function extractColorTokens(value: Set<string>) {
  const known = new Set([
    "purple", "black", "green", "pink", "red", "blue", "white", "yellow", "gray",
  ]);
  return new Set([...value].filter((token) => known.has(token)));
}

function conflictingSingleton(a: Set<string>, b: Set<string>) {
  return a.size > 0 && b.size > 0 && intersectionSize(a, b) === 0;
}

function scoreCandidate(
  canonical: CanonicalVariantForMapping,
  supplier: SupplierVariantForMapping,
): VariantMappingCandidate {
  const canonicalName = tokens(canonical.name);
  const supplierName = tokens(supplier.name);
  const canonicalAttrs = attributesTokens(canonical.attributes);
  const supplierAttrs = attributesTokens(supplier.attributes);
  const canonicalAll = new Set([...canonicalName, ...canonicalAttrs]);
  const supplierAll = new Set([...supplierName, ...supplierAttrs]);
  const reasons: string[] = [];

  const canonicalQuantity = extractQuantityTokens(canonicalAll);
  const supplierQuantity = extractQuantityTokens(supplierAll);
  const canonicalColors = extractColorTokens(canonicalAll);
  const supplierColors = extractColorTokens(supplierAll);

  if (conflictingSingleton(canonicalQuantity, supplierQuantity)) {
    return {
      canonicalVariantId: canonical.id,
      supplierVariantId: supplier.id,
      supplierSourceSkuId: supplier.sourceSkuId,
      confidence: 0,
      status: "unsafe",
      reasons: ["Quantidade/kit conflitante"],
    };
  }

  if (conflictingSingleton(canonicalColors, supplierColors)) {
    return {
      canonicalVariantId: canonical.id,
      supplierVariantId: supplier.id,
      supplierSourceSkuId: supplier.sourceSkuId,
      confidence: 0,
      status: "unsafe",
      reasons: ["Cor conflitante"],
    };
  }

  const nameSimilarity = jaccard(canonicalName, supplierName);
  const attributeSimilarity = jaccard(canonicalAttrs, supplierAttrs);
  const combinedSimilarity = jaccard(canonicalAll, supplierAll);
  const quantityMatches =
    canonicalQuantity.size > 0 &&
    supplierQuantity.size > 0 &&
    intersectionSize(canonicalQuantity, supplierQuantity) > 0;
  const colorMatches =
    canonicalColors.size > 0 &&
    supplierColors.size > 0 &&
    intersectionSize(canonicalColors, supplierColors) > 0;

  let confidence = combinedSimilarity * 0.45 + nameSimilarity * 0.35 + attributeSimilarity * 0.20;

  if (quantityMatches) {
    confidence += 0.18;
    reasons.push("Kit/quantidade correspondente");
  }
  if (colorMatches) {
    confidence += 0.18;
    reasons.push("Cor correspondente");
  }
  if (normalizedText(canonical.name) === normalizedText(supplier.name)) {
    confidence += 0.18;
    reasons.push("Nome normalizado idêntico");
  }
  if (attributeSimilarity >= 0.75 && canonicalAttrs.size > 0) {
    confidence += 0.10;
    reasons.push("Atributos fortemente correspondentes");
  }

  if (quantityMatches && colorMatches) {
    confidence = Math.max(confidence, 0.90);
    reasons.push("Cor e quantidade confirmadas explicitamente");
  }

  confidence = Math.max(0, Math.min(1, confidence));
  const rounded = Math.round(confidence * 1000) / 1000;
  const status = rounded >= 0.97
    ? "exact"
    : rounded >= 0.88
      ? "high"
      : rounded >= 0.62
        ? "review"
        : "unsafe";

  if (reasons.length === 0 && rounded > 0) reasons.push("Similaridade textual parcial");

  return {
    canonicalVariantId: canonical.id,
    supplierVariantId: supplier.id,
    supplierSourceSkuId: supplier.sourceSkuId,
    confidence: rounded,
    status,
    reasons,
  };
}

export function suggestSupplierVariantMappings(input: {
  canonicalVariants: CanonicalVariantForMapping[];
  supplierVariants: SupplierVariantForMapping[];
}): VariantMappingReport {
  const suggestions: VariantMappingSuggestion[] = [];
  const unmatchedCanonicalVariantIds: string[] = [];
  const ambiguousCanonicalVariantIds: string[] = [];

  for (const canonical of input.canonicalVariants) {
    const ranked = input.supplierVariants
      .map((supplier) => scoreCandidate(canonical, supplier))
      .sort((a, b) => b.confidence - a.confidence);

    const best = ranked[0] || null;
    const second = ranked[1] || null;
    const safeBest = best && best.status !== "unsafe" ? best : null;
    const gap = safeBest && second ? safeBest.confidence - second.confidence : 1;
    const ambiguous = Boolean(
      safeBest &&
      second &&
      second.status !== "unsafe" &&
      gap < 0.08,
    );

    let blocker: string | null = null;
    if (!safeBest) {
      blocker = "Nenhuma variante do fornecedor atingiu confiança mínima.";
      unmatchedCanonicalVariantIds.push(canonical.id);
    } else if (ambiguous) {
      blocker = "Duas ou mais variantes do fornecedor são plausíveis; confirmação manual obrigatória.";
      ambiguousCanonicalVariantIds.push(canonical.id);
    }

    const requiresReview = !safeBest || ambiguous || safeBest.status === "review";

    suggestions.push({
      canonicalVariantId: canonical.id,
      canonicalVariantName: canonical.name,
      selected: safeBest,
      alternatives: ranked.slice(0, 5),
      requiresReview,
      blocker,
    });
  }

  const selectedSupplierIds = suggestions
    .map((item) => item.selected?.supplierVariantId)
    .filter((value): value is string => Boolean(value));
  const duplicateSupplierVariant = new Set(selectedSupplierIds).size !== selectedSupplierIds.length;

  if (duplicateSupplierVariant) {
    for (const suggestion of suggestions) {
      if (!suggestion.selected) continue;
      const uses = suggestions.filter(
        (item) => item.selected?.supplierVariantId === suggestion.selected?.supplierVariantId,
      );
      if (uses.length > 1) {
        suggestion.requiresReview = true;
        suggestion.blocker = "A mesma variante do fornecedor foi sugerida para mais de uma variante da loja.";
        if (!ambiguousCanonicalVariantIds.includes(suggestion.canonicalVariantId)) {
          ambiguousCanonicalVariantIds.push(suggestion.canonicalVariantId);
        }
      }
    }
  }

  return {
    readyForAutomaticConfirmation:
      suggestions.length > 0 &&
      unmatchedCanonicalVariantIds.length === 0 &&
      ambiguousCanonicalVariantIds.length === 0 &&
      suggestions.every(
        (item) =>
          item.selected &&
          !item.requiresReview &&
          (item.selected.status === "exact" || item.selected.status === "high"),
      ),
    suggestions,
    unmatchedCanonicalVariantIds,
    ambiguousCanonicalVariantIds,
  };
}

export function validateManualVariantMapping(input: {
  canonicalVariants: CanonicalVariantForMapping[];
  supplierVariants: SupplierVariantForMapping[];
  mappings: Array<{
    canonicalVariantId: string;
    supplierVariantId: string;
  }>;
}) {
  const canonicalById = new Map(input.canonicalVariants.map((item) => [item.id, item]));
  const supplierById = new Map(input.supplierVariants.map((item) => [item.id, item]));
  const canonicalIds = new Set(canonicalById.keys());
  const supplierIds = new Set(supplierById.keys());
  const seenCanonical = new Set<string>();
  const seenSupplier = new Set<string>();
  const issues: string[] = [];

  for (const mapping of input.mappings) {
    const canonical = canonicalById.get(mapping.canonicalVariantId);
    const supplier = supplierById.get(mapping.supplierVariantId);

    if (!canonicalIds.has(mapping.canonicalVariantId)) {
      issues.push(`Variante canônica inexistente: ${mapping.canonicalVariantId}`);
    }
    if (!supplierIds.has(mapping.supplierVariantId)) {
      issues.push(`Variante do fornecedor inexistente: ${mapping.supplierVariantId}`);
    }
    if (seenCanonical.has(mapping.canonicalVariantId)) {
      issues.push(`Variante canônica duplicada: ${mapping.canonicalVariantId}`);
    }
    if (seenSupplier.has(mapping.supplierVariantId)) {
      issues.push(`Variante do fornecedor usada mais de uma vez: ${mapping.supplierVariantId}`);
    }

    if (canonical && supplier) {
      const candidate = scoreCandidate(canonical, supplier);
      const explicitConflict = candidate.reasons.find(
        (reason) => reason === "Quantidade/kit conflitante" || reason === "Cor conflitante",
      );
      if (explicitConflict) {
        issues.push(
          `Mapping incompatível ${mapping.canonicalVariantId} → ${mapping.supplierVariantId}: ${explicitConflict}`,
        );
      }
    }

    seenCanonical.add(mapping.canonicalVariantId);
    seenSupplier.add(mapping.supplierVariantId);
  }

  for (const canonicalId of canonicalIds) {
    if (!seenCanonical.has(canonicalId)) {
      issues.push(`Variante canônica sem mapping: ${canonicalId}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
