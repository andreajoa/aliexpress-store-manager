import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [stores, products, orders, publications] =
      await Promise.all([
        prisma.store.count(),
        prisma.product.count(),
        prisma.order.count(),
        prisma.publication.count(),
      ]);

    return NextResponse.json({
      ok: true,
      database: "connected",
      counts: {
        stores,
        products,
        publications,
        orders,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    return NextResponse.json(
      {
        ok: false,
        database: "error",
      },
      { status: 500 }
    );
  }
}
