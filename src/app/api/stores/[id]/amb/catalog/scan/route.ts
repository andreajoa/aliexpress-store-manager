import { NextResponse } from "next/server";

import { scanAmbCatalog } from "@/lib/amb-catalog-scan";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 120;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const store = await prisma.store.findUnique({
    where: { id },
    select: { connectorCapabilities: true },
  });
  if (!store) {
    return NextResponse.json({ ok: false, error: "Loja não encontrada." }, { status: 404 });
  }

  const capabilities = record(store.connectorCapabilities);
  const scan = record(capabilities.ambCatalogScan);
  const bridge = record(capabilities.ambBridge);
  const products = record(bridge.products);
  const lineage = record(capabilities.ambExportLineage);
  const exports = Array.isArray(lineage.exports) ? lineage.exports : [];

  return NextResponse.json({
    ok: true,
    lastScannedAt: typeof scan.lastScannedAt === "string" ? scan.lastScannedAt : null,
    totalProducts: Number(scan.totalProducts) || 0,
    mappedProducts: Object.keys(products).length,
    pending: Array.isArray(scan.pending) ? scan.pending : [],
    removedProducts: Array.isArray(scan.removedProducts) ? scan.removedProducts : [],
    changedVariants: Number(scan.changedVariants) || 0,
    registeredExports: exports.length,
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

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
