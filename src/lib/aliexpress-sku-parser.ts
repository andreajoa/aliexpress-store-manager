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

function wrappedArray<T = unknown>(value: unknown, wrapperKey: string): T[] {
  if (Array.isArray(value)) return value as T[];
  const container = record(value);
  return array<T>(container[wrapperKey]);
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

  // With simplify=true, AliExpress returns ae_item_sku_info_dtos directly as an
  // array. The non-simplified response wraps the same rows inside
  // ae_item_sku_info_d_t_o. Support both forms because both are valid responses.
  const rows = wrappedArray<Record<string, unknown>>(
    result.ae_item_sku_info_dtos,
    "ae_item_sku_info_d_t_o",
  );

  const skus: OfficialAliExpressSku[] = rows.flatMap((row) => {
    // Current simplified responses expose sku_attr explicitly. This is the value
    // required by aliexpress.trade.buy.placeorder. Older/full responses expose
    // the same attribute combination in id, so keep id as a compatibility fallback.
    const orderSkuAttr = text(row.sku_attr) || text(row.id);
    if (!orderSkuAttr) return [];

    const properties = wrappedArray<Record<string, unknown>>(
      row.ae_sku_property_dtos,
      "ae_sku_property_d_t_o",
    );
    const attributes: Record<string, string> = {};
    const nameParts: string[] = [];
    for (const property of properties) {
      const propertyId = text(property.sku_property_id);
      const name = text(property.sku_property_name) || (propertyId ? `attr_${propertyId}` : "attribute");
      const value = text(property.property_value_definition_name) || text(property.sku_property_value);
      if (value) {
        attributes[name] = value;
        nameParts.push(value);
      }
    }

    const stock = numberOrNull(row.sku_available_stock ?? row.ipm_sku_stock);
    const price = numberOrNull(row.offer_sale_price ?? row.sku_price);
    const sourceSkuId = text(row.sku_id) || text(row.sku_code) || orderSkuAttr;

    return [{
      id: orderSkuAttr,
      orderSkuAttr,
      sourceSkuId,
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
