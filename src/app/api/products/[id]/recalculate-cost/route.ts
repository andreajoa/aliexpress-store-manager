import { NextResponse } from "next/server";

import { recalculateProductLandedCost } from "@/lib/product-landed-cost-service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const result = await recalculateProductLandedCost(id);

    return NextResponse.json({
      ok: true,
      ...result,
      recalculatedAt: result.recalculatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Landed cost recalculation failed:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível recalcular o custo total.";

    return NextResponse.json(
      { ok: false, error: message },
      { status: /não encontrado/i.test(message) ? 404 : 422 },
    );
  }
}
