import { NextRequest, NextResponse } from "next/server";

import {
  tryOfficialAliExpressSearch,
  verifyAndFilterSearchResults,
} from "@/lib/aliexpress-us-finder";
import { searchOmkarProducts, type OmkarSearchResult } from "@/lib/omkar-search";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("query")?.trim() || "";
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || "1") || 1);
    const verifyUs = request.nextUrl.searchParams.get("verifyUs") === "1";
    const usOnly = request.nextUrl.searchParams.get("usOnly") === "1";
    const maxDaysRaw = Number(request.nextUrl.searchParams.get("maxDays") || "0");
    const maxDays = Number.isFinite(maxDaysRaw) && maxDaysRaw > 0 && maxDaysRaw <= 60
      ? Math.trunc(maxDaysRaw)
      : null;

    if (!query) {
      return NextResponse.json(
        { ok: false, error: "Informe o parâmetro query." },
        { status: 400 },
      );
    }

    const searchQuery = usOnly && !/\bus\b|\busa\b|united states/i.test(query)
      ? `${query} US warehouse`
      : query;

    const [omkarRes, officialItems] = await Promise.all([
      searchOmkarProducts(searchQuery, page).catch(() => null),
      verifyUs || usOnly ? tryOfficialAliExpressSearch(query, page) : Promise.resolve([]),
    ]);

    const seen = new Set<string>();
    const combined: OmkarSearchResult[] = [];
    for (const item of [...officialItems, ...(omkarRes?.results || [])]) {
      if (!item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      combined.push(item);
    }

    if (combined.length === 0 && !omkarRes) {
      return NextResponse.json(
        { ok: false, error: "Não foi possível consultar a busca do AliExpress no momento." },
        { status: 502 },
      );
    }

    if (verifyUs || usOnly || maxDays !== null) {
      const verified = await verifyAndFilterSearchResults(combined, {
        usOnly,
        maxDays,
        maxInspect: 12,
        budgetMs: 20_000,
      });

      return NextResponse.json({
        ok: true,
        count: verified.results.length,
        inspectedCount: verified.inspectedCount,
        usWarehouseCount: verified.usWarehouseCount,
        partial: verified.partial,
        verified: true,
        per_page: omkarRes?.per_page ?? 60,
        current_page: page,
        total_pages: omkarRes?.total_pages ?? 1,
        next: omkarRes?.next ?? (combined.length >= 12 ? String(page + 1) : null),
        previous: omkarRes?.previous ?? (page > 1 ? String(page - 1) : null),
        currency: omkarRes?.currency ?? "USD",
        results: verified.results,
      });
    }

    return NextResponse.json({
      ok: true,
      count: omkarRes?.count ?? combined.length,
      per_page: omkarRes?.per_page ?? 60,
      current_page: omkarRes?.current_page ?? page,
      total_pages: omkarRes?.total_pages ?? 1,
      next: omkarRes?.next ?? null,
      previous: omkarRes?.previous ?? null,
      currency: omkarRes?.currency ?? "USD",
      results: combined,
    });
  } catch (error) {
    console.error("AliExpress search failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Falha na busca.",
      },
      { status: 502 },
    );
  }
}
