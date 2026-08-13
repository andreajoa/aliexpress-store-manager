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

export type OfficialAliExpressSku = SupplierVariantForMapping & {
  orderSkuAttr: string;
};

export function officialSkusFromProductResponse(envelope: Record<string, unknown>) {
  const result = record(envelope.result);
  const baseInfo = record(result.ae_item_base_info_dto);
  const skuContainer = record(result.ae_item_sku_info_dtos);
  const rows = array<Record<string, unknown>>(skuContainer.ae_item_sku_info_d_t_o);

  const skus: OfficialAliExpressSku[] = rows.flatMap((row) => {
    const orderSkuAttr = text(row.id);
    if (!orderSkuAttr) return [];
    const propertyContainer = record(row.ae_sku_property_dtos);
    const properties = array<Record<string, unknown>>(propertyContainer.ae_sku_property_d_t_o);
    const attributes: Record<string, string> = {};
    const nameParts: string[] = [];
    for (const property of properties) {
      const name = text(property.sku_property_name) || `attr_${text(property.sku_property_id)}`;
      const value = text(property.property_value_definition_name) || text(property.sku_property_value);
      if (value) {
        attributes[name] = value;
        nameParts.push(value);
      }
    }
    const stock = numberOrNull(row.sku_available_stock ?? row.ipm_sku_stock);
    const price = numberOrNull(row.offer_sale_price ?? row.sku_price);
    return [{
      id: orderSkuAttr,
      orderSkuAttr,
      sourceSkuId: text(row.sku_code) || orderSkuAttr,
      name: nameParts.join(" / ") || orderSkuAttr,
      attributes,
      price,
      stock,
    }];
  });

  return {
    productId: text(baseInfo.product_id) || null,
    productStatus: text(baseInfo.product_status_type) || null,
    currency: text(baseInfo.currency_code) || null,
    skus,
  };
}
