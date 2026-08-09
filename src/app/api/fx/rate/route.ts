import { NextRequest, NextResponse } from "next/server";

import { fetchFxRate } from "@/lib/fx-rate";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const from =
      request.nextUrl.searchParams.get("from") ||
      "USD";
    const to =
      request.nextUrl.searchParams.get("to") ||
      "BRL";

    const quote = await fetchFxRate({
      from,
      to,
    });

    return NextResponse.json({
      ok: true,
      ...quote,
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível carregar a cotação.",
    }, {
      status: 502,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}
