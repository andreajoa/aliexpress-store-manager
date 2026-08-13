import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { runtimeReadiness } from "@/lib/runtime-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function capabilityFlags(readiness: ReturnType<typeof runtimeReadiness>) {
  return Object.fromEntries(
    Object.entries(readiness.capabilities).map(([name, value]) => [name, value.ready]),
  );
}

export async function GET() {
  const readiness = runtimeReadiness(process.env);
  const capabilities = capabilityFlags(readiness);

  try {
    await prisma.$queryRaw`SELECT 1`;

    const [stores, products, publications, orders] = await Promise.all([
      prisma.store.count(),
      prisma.product.count(),
      prisma.publication.count(),
      prisma.order.count(),
    ]);

    return NextResponse.json(
      {
        ok: true,
        database: "connected",
        productionCoreReady: readiness.productionCoreReady,
        fullFeatureReady: readiness.fullFeatureReady,
        capabilities,
        optional: readiness.optional,
        counts: { stores, products, publications, orders },
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error("Health database check failed:", error);

    return NextResponse.json(
      {
        ok: false,
        database: "unavailable",
        productionCoreReady: false,
        fullFeatureReady: false,
        capabilities,
        optional: readiness.optional,
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
