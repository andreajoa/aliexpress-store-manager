import { SupplierRefreshInputError } from "./supplier-refresh-options";

/** Explicit US/USD costing scope for an offer that sells only selected native SKUs. */
export function supplierCostingSourceSkuIds(payload: unknown): string[] | null {
  const value = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).costingSourceSkuIds : undefined;
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.length || value.length > 1000 ||
      value.some(id => typeof id !== "string" || !id || id !== id.trim() || id.length > 100) ||
      new Set(value).size !== value.length) {
    throw new SupplierRefreshInputError("Escopo de custo do fornecedor inválido.", 422);
  }
  return value as string[];
}

export function selectScopedCostingSkus<T extends { sku_id: string; available_quantity?: number | null }>(skus: T[], ids: string[]) {
  const rows = ids.map(id => {
    const matches = skus.filter(sku => String(sku.sku_id) === id);
    if (matches.length !== 1) throw new SupplierRefreshInputError("SKU do escopo ausente ou ambíguo na fonte oficial.", 422);
    const row = matches[0];
    if (typeof row.available_quantity !== "number" || !Number.isSafeInteger(row.available_quantity) || row.available_quantity < 0) {
      throw new SupplierRefreshInputError("Estoque do escopo não confirmado na fonte oficial.", 422);
    }
    return row;
  });
  return { rows, available: rows.filter(row => row.available_quantity! > 0) };
}
