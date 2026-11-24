import { NextRequest, NextResponse } from "next/server";

import { requireAliExpressSession } from "@/lib/aliexpress-connection";
import {
  extractDirectAliExpressProductIds,
  searchOfficialAliExpressCatalog,
  searchOfficialRecommendFeed,
} from "@/lib/aliexpress-us-finder";
import { searchOmkarProducts, type OmkarSearchResult } from "@/lib/omkar-search";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Fast candidate discovery (~2-5s total).
 * Always returns HTTP 200 JSON (even on upstream error with ok:false) so Cloudflare/proxies
 * never rewrite an application error into a blank/HTML 502 page.
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
        { ok: false, error: "Informe um termo de busca ou cole links/IDs do AliExpress." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    // 1. Direct link / product ID paste mode (works in <1s with zero text-search dependency!)
    const directIds = extractDirectAliExpressProductIds(query);
    if (directIds.length > 0) {
      const directCandidates: OmkarSearchResult[] = directIds.map((id) => ({
        id,
        title: `AliExpress #${id}`,
        link: `https://www.aliexpress.us/item/${id}.html`,
        image: "",
        images: [],
        rating: null,
        orders_count: null,
        is_hot_sale: null,
        is_choice: null,
        pricing: {
          sale_price: null,
          original_price: null,
          discount_percent: null,
          currency: "USD",
          tax_rate: null,
          sku_id: null,
        },
        tags: ["direct-id"],
        store_name: null,
        category_ids: [],
        listed_date: "",
      }));

      return NextResponse.json(
        {
          ok: true,
          mode: "progressive",
          source: "direct-id",
          count: 0,
          candidateCount: directCandidates.length,
          per_page: directCandidates.length,
          current_page: 1,
          total_pages: 1,
          next: null,
          previous: null,
          currency: "USD",
          candidates: directCandidates,
          results: [],
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const diagnostics: string[] = [];
    let sharedContext: Awaited<ReturnType<typeof requireAliExpressSession>> | undefined;
    try {
      sharedContext = await requireAliExpressSession();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sessão AliExpress indisponível.";
      diagnostics.push(`session: ${msg}`);
    }

    const usKeywordQuery = !/\bus\b|\busa\b|united states/i.test(query)
      ? `${query} US warehouse`
      : null;

    // 2. Primary: Official aliexpress.ds.text.search (WITHOUT invalid sortBy="orders,desc")
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
        : Promise.resolve({ items: [] as OmkarSearchResult[], totalCount: 0, error: null }),
      process.env.OMKAR_SEARCH_URL?.trim()
        ? searchOmkarProducts(query, page).catch((err) => {
            diagnostics.push(`omkar: ${err instanceof Error ? err.message : String(err)}`);
            return null;
          })
        : Promise.resolve(null),
    ]);

    if (usFocusedSearch.error) diagnostics.push(`ds.text.search(us): ${usFocusedSearch.error}`);
    if (generalSearch.error) diagnostics.push(`ds.text.search: ${generalSearch.error}`);

    const seen = new Set<string>();
    const combined: OmkarSearchResult[] = [];
    let activeSource = "official-ds-search";

    for (const item of [
      ...usFocusedSearch.items,
      ...generalSearch.items,
      ...(omkarFallback?.results || []),
    ]) {
      if (!item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      combined.push(item);
    }

    // 3. Fallback: Official aliexpress.ds.recommend.feed.get (Women's Clothing + Bestsellers)
    let feedTotalCount = 0;
    if (combined.length === 0 && sharedContext) {
      const feedRes = await searchOfficialRecommendFeed(query, page, {
        context: sharedContext,
        timeoutMs: 8_000,
      });
      if (feedRes.error) diagnostics.push(`ds.recommend.feed: ${feedRes.error}`);
      feedTotalCount = feedRes.totalCount;
      for (const item of feedRes.items) {
        if (!item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        combined.push(item);
      }
      if (combined.length > 0) {
        activeSource = "official-ds-feed";
      }
    }

    if (diagnostics.length > 0) {
      console.warn("[AliExpress search] diagnostics:", {
        query,
        page,
        found: combined.length,
        source: activeSource,
        diagnostics,
      });
    }

    if (combined.length === 0 && diagnostics.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `AliExpress não retornou resultados de busca (${diagnostics[0]}). Dica: você também pode colar links ou IDs de anúncios direto neste campo para verificar o estoque nos EUA na hora.`,
          diagnostics,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const totalCount = Math.max(
      combined.length,
      generalSearch.totalCount,
      usFocusedSearch.totalCount,
      feedTotalCount,
      omkarFallback?.count ?? 0,
    );
    const perPage = 40;
    const totalPages = Math.max(page, Math.ceil(totalCount / perPage) || (combined.length >= 20 ? page + 1 : page));
    const hasNext = page < totalPages || combined.length >= 25;

    return NextResponse.json(
      {
        ok: true,
        mode: hasFilter ? "progressive" : "direct",
        source: activeSource,
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
        diagnostics,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na busca.";
    console.error("[AliExpress search] unexpected error:", message);
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
