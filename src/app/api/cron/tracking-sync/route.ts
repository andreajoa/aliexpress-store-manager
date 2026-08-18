import { NextRequest, NextResponse } from "next/server";

import { syncAliExpressBatch } from "@/lib/aliexpress-fulfillment";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  const batches = await prisma.fulfillmentBatch.findMany({
    where: {
      provider: "ALIEXPRESS",
      status: { in: ["ORDERED", "SHIPPED"] },
      externalOrderId: { not: null },
    },
    select: { id: true, orderId: true },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });

  for (const batch of batches) {
    try {
      await syncAliExpressBatch(batch.orderId, batch.id);
      results.push({ id: batch.id, ok: true });
    } catch (error) {
      results.push({
        id: batch.id,
        ok: false,
        error: error instanceof Error ? error.message : "sync failed",
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      tracking: {
        checked: results.length,
        failed: results.filter((r) => !r.ok).length,
        results,
      },
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
