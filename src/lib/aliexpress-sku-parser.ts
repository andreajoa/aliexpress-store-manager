import type { SupplierVariantForMapping } from "./supplier-variant-mapper.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];
  return [value as T];
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowsFromContainer(
  value: unknown,
  wrapperKeys: string[],
  identityKeys: string[] = [],
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
  }

  const container = record(value);
  for (const key of wrapperKeys) {
    if (container[key] !== undefined && container[key] !== null) {
      return array<Record<string, unknown>>(container[key]).filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item),
      );
    }
  }

  if (identityKeys.some((key) => container[key] !== undefined && container[key] !== null)) {
    return [container];
  }

  return [];
}

export type OfficialAliExpressSku = SupplierVariantForMapping & {
  orderSkuAttr: string;
};

export function officialSkusFromProductResponse(envelope: Record<string, unknown>) {
  const result = record(envelope.result);
  const baseInfo = record(result.ae_item_base_info_dto);

  // The AliExpress gateway can return either the documented wrapper shape:
  // ae_item_sku_info_dtos.ae_item_sku_info_d_t_o[]
  // or a simplified array/single-object shape. Accept both so valid SKUs are
  // never discarded merely because JSON simplification changed the wrapper.
  const rows = rowsFromContainer(
    result.ae_item_sku_info_dtos,
    ["ae_item_sku_info_d_t_o", "ae_item_sku_info_dto"],
    ["id", "sku_code", "sku_id"],
  );

  const skus: OfficialAliExpressSku[] = rows.flatMap((row) => {
    const orderSkuAttr = text(row.id ?? row.sku_attr ?? row.sku_id);
    if (!orderSkuAttr) return [];

    const properties = rowsFromContainer(
      row.ae_sku_property_dtos ?? row.ae_sku_property_list,
      ["ae_sku_property_d_t_o", "ae_sku_property_dto", "ae_sku_property"],
      ["sku_property_id", "sku_property_name", "sku_property_value"],
    );

    const attributes: Record<string, string> = {};
    const nameParts: string[] = [];

    for (const property of properties) {
      const name = text(property.sku_property_name) || `attr_${text(property.sku_property_id)}`;
      const value =
        text(property.property_value_definition_name) ||
        text(property.sku_property_value) ||
        text(property.property_value_id);

      if (value) {
        attributes[name] = value;
        nameParts.push(value);
      }
    }

    let stock = numberOrNull(
      row.sku_available_stock ??
      row.s_k_u_available_stock ??
      row.ipm_sku_stock ??
      row.available_stock,
    );

    if (stock === null && typeof row.sku_stock === "boolean") {
      // The legacy API documents sku_stock only as an availability flag.
      // Preserve a deterministic operational quantity when no exact quantity
      // is returned, while preferring numeric stock fields whenever available.
      stock = row.sku_stock ? 1 : 0;
    }

    const price = numberOrNull(
      row.offer_sale_price ??
      row.sku_price ??
      row.sale_price ??
      row.price,
    );

    return [{
      id: orderSkuAttr,
      orderSkuAttr,
      sourceSkuId: text(row.sku_code ?? row.sku_id) || orderSkuAttr,
      name: nameParts.join(" / ") || orderSkuAttr,
      attributes,
      price,
      stock,
    }];
  });

  return {
    productId: text(baseInfo.product_id ?? result.product_id) || null,
    productStatus: text(baseInfo.product_status_type ?? result.product_status_type) || null,
    currency: text(baseInfo.currency_code ?? result.currency_code) || null,
    skus,
  };
}
