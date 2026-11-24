import { NextRequest, NextResponse } from "next/server";

import { verifySearchBatch } from "@/lib/aliexpress-us-finder";
import type { OmkarSearchResult } from "@/lib/omkar-search";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Verifies a fast micro-batch (up to 4 items, ~2.5-4s) against official AliExpress
 * SKU warehouse stock (`Ships From: United States`) and real freight quotes.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      items?: OmkarSearchResult[];
      usOnly?: boolean;
      maxDays?: number | null;
    } | null;

    const rawItems = Array.isArray(body?.items) ? body.items : [];
    const validItems = rawItems
      .filter((item) => item && typeof item.id === "string" && /^\d{8,}$/.test(item.id.trim()))
      .slice(0, 4);

    if (validItems.length === 0) {
      return NextResponse.json({
        ok: true,
        inspectedCount: 0,
        usWarehouseCount: 0,
        results: [],
      });
    }

    const maxDaysRaw = Number(body?.maxDays ?? 0);
    const maxDays = Number.isFinite(maxDaysRaw) && maxDaysRaw > 0 && maxDaysRaw <= 60
      ? Math.trunc(maxDaysRaw)
      : null;

    const verified = await verifySearchBatch(validItems, {
      usOnly: Boolean(body?.usOnly),
      maxDays,
    });

    return NextResponse.json({
      ok: true,
      inspectedCount: verified.inspectedCount,
      usWarehouseCount: verified.usWarehouseCount,
      results: verified.results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao verificar lote de produtos.",
      },
      { status: 502 },
    );
  }
}
