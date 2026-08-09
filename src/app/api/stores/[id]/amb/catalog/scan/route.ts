import { NextResponse } from "next/server";

import { scanAmbCatalog } from "@/lib/amb-catalog-scan";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const result = await scanAmbCatalog({ storeId: id, force: true });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Não foi possível varrer o catálogo AMB.",
    }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
