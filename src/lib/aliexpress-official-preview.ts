// Explicit data projection: never expose an OAuth envelope or credentials.
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function rows(value: unknown, wrapper: string): Record<string, unknown>[] {
  const unwrapped = Array.isArray(value) ? value : record(value)[wrapper];
  return (Array.isArray(unwrapped) ? unwrapped : unwrapped ? [unwrapped] : []).map(record);
}
function string(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function url(value: unknown) {
  const candidate = string(value);
  try { const parsed = new URL(candidate.startsWith("//") ? "https:" + candidate : candidate); return parsed.protocol === "https:" ? parsed.href : null; } catch { return null; }
}
function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter(key => ["string", "number", "boolean"].includes(typeof source[key])).map(key => [key, source[key]]));
}
export function projectOfficialPreview(envelope: Record<string, unknown>, expectedIds: string[]) {
  const result = record(envelope.result), base = record(result.ae_item_base_info_dto);
  const returnedProductId = string(base.product_id);
  if (!returnedProductId || !expectedIds.includes(returnedProductId)) throw new Error("Fonte oficial retornou identidade ausente ou diferente.");
  const media = record(result.ae_multimedia_info_dto);
  return {
    returnedProductId, title: string(base.subject), productStatus: string(base.product_status_type),
    relatedProductId: string(base.sl_related_product_id) || null,
    descriptionHtml: string(base.detail),
    images: string(media.image_urls).split(";").map(url).filter(Boolean),
    videos: rows(media.ae_video_dtos, "ae_video_d_t_o").map(v => ({ url: url(v.media_url || v.video_url), status: string(v.media_status), posterUrl: url(v.poster_url) })).filter(v => v.url),
    skus: rows(result.ae_item_sku_info_dtos, "ae_item_sku_info_d_t_o").map(sku => ({
      ...pick(sku, ["sku_id", "sku_attr", "sku_price", "currency_code", "offer_sale_price", "sku_available_stock"]),
      properties: rows(sku.ae_sku_property_dtos, "ae_sku_property_d_t_o").map(prop => ({
        ...pick(prop, ["sku_property_id", "property_value_id", "sku_property_name", "sku_property_value", "property_value_definition_name"]), imageUrl: url(prop.sku_image),
      })),
    })),
  };
}
