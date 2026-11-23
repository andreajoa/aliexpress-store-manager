import type { AmbProductBinding } from "./amb-bridge-contract.ts";
import { skuShipsFromCountryCode } from "./aliexpress-warehouse.ts";
import { ambVariantSize, matchesAmbVariantSelection } from "./amb-variant-attributes.ts";

type SupplierVariant = {
  sourceSkuId: string | null;
  attributes: unknown;
  stock: number | null;
  available: boolean;
};

/** The caller supplies variants belonging only to binding.sourceProductId. */
export function resolveAmbBoundVariant<T extends SupplierVariant>(
  binding: AmbProductBinding,
  size: string,
  variants: T[],
  quantity = 1,
  options?: { preferUsWarehouse?: boolean },
): T {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Quantidade inválida.");
  const skuMap = binding.sourceSkuIdsBySize;
  const explicitSku = skuMap && Object.prototype.hasOwnProperty.call(skuMap, size) ? skuMap[size] : undefined;
  // A partial explicit map must never fall back to a different supplier SKU.
  if (skuMap && !explicitSku) throw new Error(`Tamanho ${size} sem SKU explícito.`);
  let candidates = variants.filter((variant) => {
    if (explicitSku && variant.sourceSkuId !== explicitSku) return false;
    const attributes = variant.attributes && typeof variant.attributes === "object" && !Array.isArray(variant.attributes)
      ? variant.attributes as Record<string, unknown> : {};
    return matchesAmbVariantSelection(attributes, binding.color, size);
  });

  // When a product carries multiple warehouses (e.g. China + United States) for the exact same
  // color and size without an explicit SKU map, prefer the in-stock US warehouse SKU automatically.
  if (!explicitSku && candidates.length > 1 && options?.preferUsWarehouse !== false) {
    const withCountry = candidates.map((variant) => ({
      variant,
      country: skuShipsFromCountryCode(variant.attributes),
    }));
    const distinctCountries = new Set(withCountry.map((item) => item.country).filter(Boolean));
    if (distinctCountries.size > 1) {
      const usCandidates = withCountry
        .filter((item) => item.country === "US")
        .map((item) => item.variant);
      const usInStock = usCandidates.filter(
        (variant) => Boolean(variant.sourceSkuId && variant.available && variant.stock != null && variant.stock >= quantity),
      );
      if (usInStock.length === 1) {
        candidates = usInStock;
      } else if (usCandidates.length === 1 && usInStock.length === 0) {
        // US warehouse is out of stock — fall back to a single non-US in-stock warehouse if unambiguous
        const fallbackInStock = withCountry
          .filter((item) => item.country !== "US")
          .map((item) => item.variant)
          .filter((variant) => Boolean(variant.sourceSkuId && variant.available && variant.stock != null && variant.stock >= quantity));
        if (fallbackInStock.length === 1) candidates = fallbackInStock;
      }
    }
  }

  if (candidates.length !== 1) {
    throw new Error(`${binding.sourceProductId}/${binding.color}/${size} resolveu ${candidates.length} SKUs; vínculo exige revisão.`);
  }
  const variant = candidates[0];
  if (!variant.sourceSkuId || !variant.available || variant.stock == null || variant.stock < quantity) {
    throw new Error(`SKU indisponível para ${binding.sourceProductId}/${binding.color}/${size}.`);
  }
  return variant;
}

export function ambBoundInventory(binding: AmbProductBinding, variants: SupplierVariant[]) {
  const sizes = binding.sourceSkuIdsBySize ? Object.keys(binding.sourceSkuIdsBySize) : [...new Set(variants.flatMap(variant => {
    const attributes = variant.attributes && typeof variant.attributes === "object" && !Array.isArray(variant.attributes)
      ? variant.attributes as Record<string, unknown> : {};
    const size = ambVariantSize(attributes) || "One Size";
    return matchesAmbVariantSelection(attributes, binding.color, size) ? [size] : [];
  }))];
  const rows = sizes.map(size => {
    try {
      const variant = resolveAmbBoundVariant(binding, size, variants);
      return { size, stock: variant.stock!, available: true, sourceSkuId: variant.sourceSkuId };
    } catch {
      return { size, stock: 0, available: false, sourceSkuId: null };
    }
  });
  const counted = new Set<string>();
  const stock = rows.reduce((sum, row) => {
    if (!row.sourceSkuId || counted.has(row.sourceSkuId)) return sum;
    counted.add(row.sourceSkuId);
    return sum + row.stock;
  }, 0);
  return { stock, available: rows.some(row => row.available), sizes: rows.map(({ size, stock, available }) => ({ size, stock, available })) };
}
