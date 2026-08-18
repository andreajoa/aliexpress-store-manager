import { NextRequest, NextResponse } from "next/server";

import { scanAmbCatalog } from "@/lib/amb-catalog-scan";
import { expireCheckoutReservations } from "@/lib/inventory-reservation";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

/*
 * Tarefas diárias de manutenção. O refresh de fornecedores e o sync de
 * rastreamento foram movidos para crons dedicados (/api/cron/stock-sync e
 * /api/cron/tracking-sync) que rodam a cada 4 horas.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const expiredReservations = await expireCheckoutReservations();
  let ambCatalog: Record<string, unknown> | null = null;

  try {
    ambCatalog = await scanAmbCatalog({ storeId: "amb-boutique-store" }) as unknown as Record<string, unknown>;
  } catch (error) {
    ambCatalog = {
      ok: false,
      error: error instanceof Error ? error.message : "AMB catalog scan failed",
    };
  }

  return NextResponse.json({
    ok: true,
    reservations: expiredReservations,
    ambCatalog,
    timestamp: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
