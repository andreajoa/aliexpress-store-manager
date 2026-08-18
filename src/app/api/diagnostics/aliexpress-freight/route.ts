import { NextResponse } from "next/server";

import { requireAliExpressSession } from "@/lib/aliexpress-connection";

export const runtime = "nodejs";
export const maxDuration = 60;

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

function skuRows(result: Record<string, unknown>) {
  const container = result.ae_item_sku_info_dtos;
  if (Array.isArray(container)) return container as Record<string, unknown>[];
  const wrapper = record(container);
  return array<Record<string, unknown>>(
    wrapper.ae_item_sku_info_d_t_o ?? wrapper.ae_item_sku_info_dto,
  );
}

function skuProperties(row: Record<string, unknown>) {
  const container = row.ae_sku_property_dtos;
  if (Array.isArray(container)) return container as Record<string, unknown>[];
  const wrapper = record(container);
  return array<Record<string, unknown>>(
    wrapper.ae_sku_property_d_t_o ?? wrapper.ae_sku_property_dto,
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId")?.trim() || "";
  const shipToCountry = (url.searchParams.get("shipTo") || "US").trim().toUpperCase();

  if (!/^\d{10,}$/.test(productId)) {
    return NextResponse.json({ ok: false, error: "productId inválido" }, { status: 400 });
  }

  try {
    const { session, client } = await requireAliExpressSession();
    const envelope = await client.getDropshipProduct({
      session,
      productId,
      shipToCountry,
      targetCurrency: "USD",
      targetLanguage: "EN",
    });
    const result = record(envelope.result);
    const converter = record(result.product_id_converter_result);
    const logistics = record(result.logistics_info_dto);
    const packageInfo = record(result.package_info_dto);
    const rows = skuRows(result);

    const propertyMap = new Map<string, Record<string, string>>();
    for (const row of rows) {
      for (const property of skuProperties(row)) {
        const safe = {
          propertyId: text(property.sku_property_id),
          propertyName: text(property.sku_property_name),
          propertyValue: text(property.sku_property_value),
          propertyValueId: text(property.property_value_id),
          propertyDefinitionName: text(property.property_value_definition_name),
        };
        const key = JSON.stringify(safe);
        if (!propertyMap.has(key)) propertyMap.set(key, safe);
      }
    }

    return NextResponse.json({
      ok: true,
      requestedProductId: productId,
      shipToCountry,
      rspCode: text(envelope.rsp_code),
      rspMsg: text(envelope.rsp_msg),
      converter: {
        mainProductId: text(converter.main_product_id),
        subProductId: text(converter.sub_product_id),
      },
      logistics: {
        shipToCountry: text(logistics.ship_to_country),
        deliveryTime: text(logistics.delivery_time),
      },
      package: {
        weightKg: text(packageInfo.gross_weight),
        lengthCm: text(packageInfo.package_length),
        widthCm: text(packageInfo.package_width),
        heightCm: text(packageInfo.package_height),
      },
      skuCount: rows.length,
      distinctSkuProperties: Array.from(propertyMap.values()),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
