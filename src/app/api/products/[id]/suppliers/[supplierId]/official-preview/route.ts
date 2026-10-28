import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAliExpressSession } from "@/lib/aliexpress-connection";
import { aliExpressProductIdAliases } from "@/lib/aliexpress-catalog-id";
import { projectOfficialPreview } from "@/lib/aliexpress-official-preview";

export const runtime = "nodejs";

// Protected by the same admin proxy as the product editor. No import, refresh,
// synchronization, credential renewal or source/catalogue write is performed.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; supplierId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const { id, supplierId } = await params;
    const supplier = await prisma.supplierProduct.findFirst({
      where: { id: supplierId, productId: id }, select: { sourceProductId: true, provider: true, status: true },
    });
    if (!supplier) return NextResponse.json({ ok: false, error: "Fornecedor não encontrado." }, { status: 404, headers });
    if (supplier.provider !== "ALIEXPRESS" || supplier.status === "DISABLED") return NextResponse.json({ ok: false, error: "Fornecedor não elegível." }, { status: 422, headers });
    const aliases = aliExpressProductIdAliases(supplier.sourceProductId);
    if (!aliases.length) return NextResponse.json({ ok: false, error: "Identidade inválida." }, { status: 422, headers });
    const { client, session } = await requireAliExpressSession({ readOnly: true });
    const envelope = await client.getDropshipProduct({ session, productId: supplier.sourceProductId, shipToCountry: "US", targetCurrency: "USD", targetLanguage: "EN" });
    const product = projectOfficialPreview(envelope, aliases);
    return NextResponse.json({ ok: true, readOnly: true, persisted: false, provider: "ALIEXPRESS_OPEN_PLATFORM", requestedProductId: supplier.sourceProductId, capturedAt: new Date().toISOString(), country: "US", currency: "USD", product }, { headers });
  } catch {
    // Upstream exceptions may contain request/session details. Never echo them.
    return NextResponse.json({ ok: false, readOnly: true, persisted: false, error: "Não foi possível obter a prévia oficial com identidade confirmada." }, { status: 502, headers });
  }
}
