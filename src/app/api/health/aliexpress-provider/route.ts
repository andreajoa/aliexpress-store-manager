import { NextResponse } from "next/server";

import {
  getAliExpressOperationalProduct,
  getAliExpressProviderHealth,
} from "@/lib/aliexpress-operational-provider";

export const runtime = "nodejs";
export const maxDuration = 120;

const DIAGNOSTIC_PRODUCT_ID = "3256811750293175";
const DIAGNOSTIC_TOKEN = "ae-provider-20260812-76696";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const buildSha = process.env.VERCEL_GIT_COMMIT_SHA || "unknown";

  if (url.searchParams.get("token") !== DIAGNOSTIC_TOKEN) {
    return NextResponse.json(
      {
        ok: true,
        buildSha,
        providerVersion: "official-omkar-resilient-v2",
      },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }

  try {
    const result = await getAliExpressOperationalProduct(DIAGNOSTIC_PRODUCT_ID);
    const skuPricing = result.product.sku_pricing || [];

    return NextResponse.json(
      {
        ok: true,
        buildSha,
        providerVersion: "official-omkar-resilient-v2",
        provider: result.provider,
        productId: String(result.product.id),
        skuCount: skuPricing.length,
        totalStock: skuPricing.reduce(
          (total, sku) => total + Math.max(0, Number(sku.available_quantity) || 0),
          0,
        ),
        imageCount: (result.product.images_hd || result.product.images || []).length,
        warnings: result.warnings,
        health: getAliExpressProviderHealth(),
      },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        buildSha,
        providerVersion: "official-omkar-resilient-v2",
        error: error instanceof Error ? error.message : String(error),
        health: getAliExpressProviderHealth(),
      },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
