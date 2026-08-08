import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { extractAliExpressProductId, getOmkarProduct } from "@/lib/omkar";
import {
  canonicalVariantsForMapping,
  normalizeSupplierProduct,
} from "@/lib/supplier-catalog";
import { suggestSupplierVariantMappings } from "@/lib/supplier-variant-mapper";

export const runtime = "nodejs";

const createSchema = z.object({
  url: z.string().trim().url(),
  role: z.enum(["PRIMARY", "BACKUP", "ALTERNATIVE"]).default("ALTERNATIVE"),
});

function supplierJson(supplier: {
  id: string;
  sourceProductId: string;
  sourceUrl: string;
  sellerId: string | null;
  sellerName: string | null;
  role: string;
  priority: number;
  status: string;
  sourceCurrency: string | null;
  costMin: { toString(): string } | null;
  costMax: { toString(): string } | null;
  lastCheckedAt: Date | null;
  variants: Array<{
    id: string;
    sourceSkuId: string;
    name: string;
    sourcePrice: { toString(): string } | null;
    stock: number;
    attributes: unknown;
    imageUrl: string | null;
  }>;
  mappings: Array<{
    id: string;
    canonicalVariantId: string;
    supplierVariantId: string;
    confidence: { toString(): string } | null;
    method: string;
    active: boolean;
    verifiedAt: Date | null;
  }>;
}) {
  return {
    id: supplier.id,
    sourceProductId: supplier.sourceProductId,
    sourceUrl: supplier.sourceUrl,
    sellerId: supplier.sellerId,
    sellerName: supplier.sellerName,
    role: supplier.role,
    priority: supplier.priority,
    status: supplier.status,
    sourceCurrency: supplier.sourceCurrency,
    costMin: supplier.costMin?.toString() || null,
    costMax: supplier.costMax?.toString() || null,
    lastCheckedAt: supplier.lastCheckedAt?.toISOString() || null,
    variants: supplier.variants.map((variant) => ({
      id: variant.id,
      sourceSkuId: variant.sourceSkuId,
      name: variant.name,
      sourcePrice: variant.sourcePrice?.toString() || null,
      stock: variant.stock,
      attributes: variant.attributes,
      imageUrl: variant.imageUrl,
    })),
    mappings: supplier.mappings.map((mapping) => ({
      id: mapping.id,
      canonicalVariantId: mapping.canonicalVariantId,
      supplierVariantId: mapping.supplierVariantId,
      confidence: mapping.confidence?.toString() || null,
      method: mapping.method,
      active: mapping.active,
      verifiedAt: mapping.verifiedAt?.toISOString() || null,
    })),
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!product) {
    return NextResponse.json({ ok: false, error: "Produto não encontrado." }, { status: 404 });
  }

  const suppliers = await prisma.supplierProduct.findMany({
    where: { productId: id },
    include: {
      variants: { orderBy: { createdAt: "asc" } },
      mappings: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    ok: true,
    suppliers: suppliers.map(supplierJson),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const parsed = createSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Informe uma URL válida do AliExpress e um papel de fornecedor válido." },
        { status: 400 },
      );
    }

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        variants: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!product) {
      return NextResponse.json({ ok: false, error: "Produto não encontrado." }, { status: 404 });
    }

    const sourceProductId = extractAliExpressProductId(parsed.data.url);
    const duplicate = await prisma.supplierProduct.findFirst({
      where: {
        productId: id,
        provider: "ALIEXPRESS",
        sourceProductId,
      },
      select: { id: true },
    });

    if (duplicate) {
      return NextResponse.json(
        { ok: false, duplicate: true, supplierId: duplicate.id, error: "Este fornecedor já está vinculado ao produto." },
        { status: 409 },
      );
    }

    const omkar = await getOmkarProduct(sourceProductId);
    const snapshot = normalizeSupplierProduct(omkar);
    const canonicalVariants = canonicalVariantsForMapping(product.variants);
    const report = suggestSupplierVariantMappings({
      canonicalVariants,
      supplierVariants: snapshot.variants,
    });

    const supplier = await prisma.$transaction(async (tx) => {
      if (parsed.data.role === "PRIMARY") {
        await tx.supplierProduct.updateMany({
          where: { productId: id, role: "PRIMARY", status: "ACTIVE" },
          data: { role: "BACKUP", priority: 50 },
        });
      }

      const created = await tx.supplierProduct.create({
        data: {
          productId: id,
          provider: snapshot.provider,
          sourceProductId: snapshot.sourceProductId,
          sourceUrl: snapshot.sourceUrl,
          sellerId: snapshot.sellerId,
          sellerName: snapshot.sellerName,
          role: parsed.data.role,
          priority:
            parsed.data.role === "PRIMARY" ? 0 : parsed.data.role === "BACKUP" ? 50 : 100,
          status: "ACTIVE",
          sourceCurrency: snapshot.sourceCurrency,
          costMin: snapshot.costMin,
          costMax: snapshot.costMax,
          rawPayload: JSON.parse(JSON.stringify(snapshot.rawPayload)),
          lastCheckedAt: new Date(),
          variants: {
            create: snapshot.variants.map((variant) => ({
              sourceSkuId: variant.sourceSkuId,
              name: variant.name,
              sourcePrice: variant.sourcePrice,
              stock: variant.stock,
              attributes: JSON.parse(JSON.stringify(variant.attributes || {})),
              imageUrl: variant.imageUrl,
            })),
          },
        },
        include: { variants: true },
      });

      if (report.readyForAutomaticConfirmation) {
        const bySku = new Map(created.variants.map((variant) => [variant.sourceSkuId, variant]));
        await tx.supplierVariantMapping.createMany({
          data: report.suggestions.flatMap((suggestion) => {
            const selected = suggestion.selected;
            if (!selected) return [];
            const variant = bySku.get(selected.supplierSourceSkuId);
            if (!variant) return [];
            return [{
              supplierProductId: created.id,
              supplierVariantId: variant.id,
              canonicalVariantId: suggestion.canonicalVariantId,
              confidence: selected.confidence,
              method: "AUTO" as const,
              evidence: {
                reasons: selected.reasons,
                confidence: selected.confidence,
                sourceSkuId: selected.supplierSourceSkuId,
              },
              active: true,
              verifiedAt: new Date(),
            }];
          }),
        });
      }

      return tx.supplierProduct.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          variants: { orderBy: { createdAt: "asc" } },
          mappings: { orderBy: { createdAt: "asc" } },
        },
      });
    });

    return NextResponse.json(
      {
        ok: true,
        supplier: supplierJson(supplier),
        mapping: report,
        mappingStatus: report.readyForAutomaticConfirmation ? "CONFIRMED_AUTO" : "REVIEW_REQUIRED",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Supplier create failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Não foi possível adicionar o fornecedor.",
      },
      { status: 500 },
    );
  }
}
