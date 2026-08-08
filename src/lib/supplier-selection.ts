export type SupplierRoleForSelection = "PRIMARY" | "BACKUP" | "ALTERNATIVE";

export type SupplierSelectionRequirement = {
  canonicalVariantId: string;
  quantity: number;
};

export type SupplierSelectionVariant = {
  id: string;
  sourceSkuId: string;
  sourcePrice: number | null;
  stock: number;
};

export type SupplierSelectionMapping = {
  canonicalVariantId: string;
  active: boolean;
  supplierVariant: SupplierSelectionVariant;
};

export type SupplierSelectionInput = {
  id: string;
  role: SupplierRoleForSelection;
  priority: number;
  status: string;
  sourceCurrency: string | null;
  lastCheckedAt: Date | string | null;
  mappings: SupplierSelectionMapping[];
};

export type SupplierEligibilityIssue = {
  code:
    | "SUPPLIER_INACTIVE"
    | "SUPPLIER_DATA_STALE"
    | "MAPPING_MISSING"
    | "MAPPING_DUPLICATE"
    | "PRICE_MISSING"
    | "STOCK_INSUFFICIENT";
  canonicalVariantId?: string;
  detail: string;
};

export type SupplierCandidate = {
  supplierId: string;
  role: SupplierRoleForSelection;
  priority: number;
  sourceCurrency: string | null;
  totalSourceCost: number | null;
  minimumRemainingStock: number;
  eligible: boolean;
  issues: SupplierEligibilityIssue[];
  resolved: Array<{
    canonicalVariantId: string;
    quantity: number;
    supplierVariantId: string;
    sourceSkuId: string;
    sourcePrice: number;
    stock: number;
  }>;
};

export type SupplierSelectionResult = {
  selected: SupplierCandidate | null;
  candidates: SupplierCandidate[];
  requiresReview: boolean;
  blocker: string | null;
};

const ROLE_RANK: Record<SupplierRoleForSelection, number> = {
  PRIMARY: 0,
  BACKUP: 1,
  ALTERNATIVE: 2,
};

function asDate(value: Date | string | null) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function finitePositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

function evaluateSupplier(input: {
  supplier: SupplierSelectionInput;
  requirements: SupplierSelectionRequirement[];
  now: Date;
  maxAgeMinutes: number;
}): SupplierCandidate {
  const { supplier, requirements, now, maxAgeMinutes } = input;
  const issues: SupplierEligibilityIssue[] = [];
  const resolved: SupplierCandidate["resolved"] = [];

  if (supplier.status !== "ACTIVE") {
    issues.push({
      code: "SUPPLIER_INACTIVE",
      detail: `Fornecedor está ${supplier.status || "inativo"}.`,
    });
  }

  const checkedAt = asDate(supplier.lastCheckedAt);
  const maxAgeMs = Math.max(1, maxAgeMinutes) * 60_000;
  if (!checkedAt || now.getTime() - checkedAt.getTime() > maxAgeMs) {
    issues.push({
      code: "SUPPLIER_DATA_STALE",
      detail: "Preço/estoque do fornecedor precisa ser atualizado antes da seleção automática.",
    });
  }

  const mappingsByCanonical = new Map<string, SupplierSelectionMapping[]>();
  for (const mapping of supplier.mappings) {
    if (!mapping.active) continue;
    const current = mappingsByCanonical.get(mapping.canonicalVariantId) || [];
    current.push(mapping);
    mappingsByCanonical.set(mapping.canonicalVariantId, current);
  }

  for (const requirement of requirements) {
    const mappings = mappingsByCanonical.get(requirement.canonicalVariantId) || [];
    if (mappings.length === 0) {
      issues.push({
        code: "MAPPING_MISSING",
        canonicalVariantId: requirement.canonicalVariantId,
        detail: "Variante canônica não está mapeada neste fornecedor.",
      });
      continue;
    }
    if (mappings.length > 1) {
      issues.push({
        code: "MAPPING_DUPLICATE",
        canonicalVariantId: requirement.canonicalVariantId,
        detail: "Mais de um SKU ativo está ligado à mesma variante canônica.",
      });
      continue;
    }

    const mapping = mappings[0];
    const price = mapping.supplierVariant.sourcePrice;
    if (price === null || !Number.isFinite(price) || price < 0) {
      issues.push({
        code: "PRICE_MISSING",
        canonicalVariantId: requirement.canonicalVariantId,
        detail: "SKU mapeado não possui preço de custo válido.",
      });
      continue;
    }

    if (mapping.supplierVariant.stock < requirement.quantity) {
      issues.push({
        code: "STOCK_INSUFFICIENT",
        canonicalVariantId: requirement.canonicalVariantId,
        detail: `Estoque ${mapping.supplierVariant.stock} é menor que a quantidade solicitada ${requirement.quantity}.`,
      });
      continue;
    }

    resolved.push({
      canonicalVariantId: requirement.canonicalVariantId,
      quantity: requirement.quantity,
      supplierVariantId: mapping.supplierVariant.id,
      sourceSkuId: mapping.supplierVariant.sourceSkuId,
      sourcePrice: price,
      stock: mapping.supplierVariant.stock,
    });
  }

  const eligible = issues.length === 0 && resolved.length === requirements.length;
  const totalSourceCost = eligible
    ? Math.round(
        resolved.reduce((total, item) => total + item.sourcePrice * item.quantity, 0) * 100,
      ) / 100
    : null;
  const minimumRemainingStock = eligible && resolved.length
    ? Math.min(...resolved.map((item) => item.stock - item.quantity))
    : -1;

  return {
    supplierId: supplier.id,
    role: supplier.role,
    priority: supplier.priority,
    sourceCurrency: supplier.sourceCurrency,
    totalSourceCost,
    minimumRemainingStock,
    eligible,
    issues,
    resolved,
  };
}

export function selectSupplier(input: {
  requirements: SupplierSelectionRequirement[];
  suppliers: SupplierSelectionInput[];
  now?: Date;
  maxAgeMinutes?: number;
}): SupplierSelectionResult {
  if (input.requirements.length === 0) {
    return {
      selected: null,
      candidates: [],
      requiresReview: false,
      blocker: "Nenhuma variante foi solicitada para seleção de fornecedor.",
    };
  }

  const invalidRequirement = input.requirements.find(
    (item) => !item.canonicalVariantId.trim() || !finitePositiveInteger(item.quantity),
  );
  if (invalidRequirement) {
    return {
      selected: null,
      candidates: [],
      requiresReview: false,
      blocker: "Requisitos de seleção possuem variante ou quantidade inválida.",
    };
  }

  const requirementIds = input.requirements.map((item) => item.canonicalVariantId);
  if (new Set(requirementIds).size !== requirementIds.length) {
    return {
      selected: null,
      candidates: [],
      requiresReview: false,
      blocker: "A mesma variante canônica foi informada mais de uma vez.",
    };
  }

  const now = input.now || new Date();
  const maxAgeMinutes = input.maxAgeMinutes ?? 360;
  const candidates = input.suppliers.map((supplier) =>
    evaluateSupplier({ supplier, requirements: input.requirements, now, maxAgeMinutes }),
  );
  const eligible = candidates.filter((candidate) => candidate.eligible);

  if (eligible.length === 0) {
    return {
      selected: null,
      candidates,
      requiresReview: false,
      blocker: "Nenhum fornecedor ativo possui dados recentes, mapping completo, preço válido e estoque suficiente.",
    };
  }

  const bestRoleRank = Math.min(...eligible.map((candidate) => ROLE_RANK[candidate.role]));
  const rolePool = eligible.filter((candidate) => ROLE_RANK[candidate.role] === bestRoleRank);
  const bestPriority = Math.min(...rolePool.map((candidate) => candidate.priority));
  const priorityPool = rolePool.filter((candidate) => candidate.priority === bestPriority);

  if (priorityPool.length === 1) {
    return {
      selected: priorityPool[0],
      candidates,
      requiresReview: false,
      blocker: null,
    };
  }

  const currencies = new Set(priorityPool.map((candidate) => candidate.sourceCurrency || ""));
  if (currencies.size > 1 || currencies.has("")) {
    return {
      selected: null,
      candidates,
      requiresReview: true,
      blocker: "Há fornecedores igualmente prioritários em moedas diferentes ou sem moeda definida; comparação automática de custo foi bloqueada.",
    };
  }

  priorityPool.sort((a, b) => {
    const costA = a.totalSourceCost ?? Number.POSITIVE_INFINITY;
    const costB = b.totalSourceCost ?? Number.POSITIVE_INFINITY;
    if (costA !== costB) return costA - costB;
    if (a.minimumRemainingStock !== b.minimumRemainingStock) {
      return b.minimumRemainingStock - a.minimumRemainingStock;
    }
    return a.supplierId.localeCompare(b.supplierId);
  });

  return {
    selected: priorityPool[0],
    candidates,
    requiresReview: false,
    blocker: null,
  };
}

export function deriveCanonicalAvailability(input: {
  canonicalVariantIds: string[];
  suppliers: SupplierSelectionInput[];
  now?: Date;
  maxAgeMinutes?: number;
}) {
  return input.canonicalVariantIds.map((canonicalVariantId) => {
    const eligibleStocks: Array<{ supplierId: string; stock: number }> = [];

    for (const supplier of input.suppliers) {
      const result = selectSupplier({
        requirements: [{ canonicalVariantId, quantity: 1 }],
        suppliers: [supplier],
        now: input.now,
        maxAgeMinutes: input.maxAgeMinutes,
      });
      if (result.selected) {
        eligibleStocks.push({
          supplierId: result.selected.supplierId,
          stock: result.selected.resolved[0]?.stock || 0,
        });
      }
    }

    return {
      canonicalVariantId,
      available: eligibleStocks.length > 0,
      safeStock: eligibleStocks.length
        ? Math.max(...eligibleStocks.map((item) => item.stock))
        : 0,
      supplierCount: eligibleStocks.length,
      suppliers: eligibleStocks,
    };
  });
}
