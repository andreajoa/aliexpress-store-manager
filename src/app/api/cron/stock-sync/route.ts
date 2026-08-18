import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { refreshSupplier } from "@/lib/supplier-refresh-service";

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

  const suppliers = await prisma.supplierProduct.findMany({
    where: { provider: "ALIEXPRESS", status: "ACTIVE" },
    select: { id: true, productId: true },
    orderBy: { lastCheckedAt: "asc" },
    take: 50,
  });

  for (const supplier of suppliers) {
    try {
      await refreshSupplier({
        productId: supplier.productId,
        supplierId: supplier.id,
        syncAvailability: true,
      });
      results.push({ id: supplier.id, ok: true });
    } catch (error) {
      results.push({
        id: supplier.id,
        ok: false,
        error: error instanceof Error ? error.message : "refresh failed",
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      suppliers: {
        checked: results.length,
        failed: results.filter((r) => !r.ok).length,
        results,
      },
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
