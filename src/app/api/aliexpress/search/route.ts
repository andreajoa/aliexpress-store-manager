import { NextRequest, NextResponse } from "next/server";

import { requireAliExpressSession } from "@/lib/aliexpress-connection";
import { searchOfficialAliExpressCatalog } from "@/lib/aliexpress-us-finder";
import { searchOmkarProducts, type OmkarSearchResult } from "@/lib/omkar-search";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Fast candidate discovery (~2-4s total, well below Caddy's 30s upstream timeout).
 * Per-product US warehouse & freight verification runs progressively via POST /api/aliexpress/search/verify.
 */
export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("query")?.trim() || "";
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || "1") || 1);
    const verifyUs = request.nextUrl.searchParams.get("verifyUs") === "1";
    const usOnly = request.nextUrl.searchParams.get("usOnly") === "1";
    const maxDaysRaw = Number(request.nextUrl.searchParams.get("maxDays") || "0");
    const hasFilter = verifyUs || usOnly || (Number.isFinite(maxDaysRaw) && maxDaysRaw > 0 && maxDaysRaw <= 60);

    if (!query) {
      return NextResponse.json(
        { ok: false, error: "Informe o parâmetro query." },
        { status: 400 },
      );
    }

    const usKeywordQuery = !/\bus\b|\busa\b|united states/i.test(query)
      ? `${query} US warehouse`
      : null;

    let sharedContext: Awaited<ReturnType<typeof requireAliExpressSession>> | undefined;
    let sessionError: string | null = null;
    try {
      sharedContext = await requireAliExpressSession();
    } catch (err) {
      sessionError = err instanceof Error ? err.message : "Sessão AliExpress indisponível.";
    }

    const [usFocusedSearch, generalSearch, omkarFallback] = await Promise.all([
      sharedContext && usOnly && usKeywordQuery
        ? searchOfficialAliExpressCatalog(usKeywordQuery, page, {
            context: sharedContext,
            pageSize: 30,
            timeoutMs: 8_000,
          })
        : Promise.resolve({ items: [] as OmkarSearchResult[], totalCount: 0, error: null }),
      sharedContext
        ? searchOfficialAliExpressCatalog(query, page, {
            context: sharedContext,
            pageSize: 40,
            timeoutMs: 8_000,
          })
        : Promise.resolve({ items: [] as OmkarSearchResult[], totalCount: 0, error: sessionError }),
      process.env.OMKAR_SEARCH_URL?.trim()
        ? searchOmkarProducts(query, page).catch(() => null)
        : Promise.resolve(null),
    ]);

    const seen = new Set<string>();
    const combined: OmkarSearchResult[] = [];
    for (const item of [
      ...usFocusedSearch.items,
      ...generalSearch.items,
      ...(omkarFallback?.results || []),
    ]) {
      if (!item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      combined.push(item);
    }

    if (combined.length === 0 && (generalSearch.error || sessionError)) {
      return NextResponse.json(
        {
          ok: false,
          error: generalSearch.error || sessionError || "Não foi possível consultar o catálogo oficial do AliExpress.",
        },
        { status: 502 },
      );
    }

    const totalCount = Math.max(
      combined.length,
      generalSearch.totalCount,
      usFocusedSearch.totalCount,
      omkarFallback?.count ?? 0,
    );
    const perPage = 40;
    const totalPages = Math.max(page, Math.ceil(totalCount / perPage) || (combined.length >= 20 ? page + 1 : page));
    const hasNext = page < totalPages || combined.length >= 25;

    return NextResponse.json({
      ok: true,
      mode: hasFilter ? "progressive" : "direct",
      count: hasFilter ? 0 : combined.length,
      candidateCount: combined.length,
      per_page: perPage,
      current_page: page,
      total_pages: totalPages,
      next: hasNext ? String(page + 1) : null,
      previous: page > 1 ? String(page - 1) : null,
      currency: "USD",
      candidates: hasFilter ? combined : [],
      results: hasFilter ? [] : combined,
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
