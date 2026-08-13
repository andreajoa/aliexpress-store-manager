import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { canonicalVariantsForMapping } from "@/lib/supplier-catalog";
import { validateManualVariantMapping } from "@/lib/supplier-variant-mapper";

export const runtime = "nodejs";

const mappingSchema = z.object({
  mappings: z.array(z.object({
    canonicalVariantId: z.string().min(1),
    supplierVariantId: z.string().min(1),
  })).min(1),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; supplierId: string }> },
) {
  try {
    const { id, supplierId } = await context.params;
    const parsed = mappingSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Envie um mapping completo entre variantes da loja e do fornecedor." },
        { status: 400 },
      );
    }

    const [product, supplier] = await Promise.all([
      prisma.product.findUnique({
        where: { id },
        include: { variants: { orderBy: { createdAt: "asc" } } },
      }),
      prisma.supplierProduct.findFirst({
        where: { id: supplierId, productId: id },
        include: { variants: { orderBy: { createdAt: "asc" } } },
      }),
    ]);

    if (!product || !supplier) {
      return NextResponse.json(
        { ok: false, error: "Produto ou fornecedor não encontrado." },
        { status: 404 },
      );
    }

    const canonicalVariants = canonicalVariantsForMapping(product.variants);
    const supplierVariants = supplier.variants.map((variant) => ({
      id: variant.id,
      sourceSkuId: variant.sourceSkuId,
      name: variant.name,
      attributes: variant.attributes,
      price: variant.sourcePrice ? Number(variant.sourcePrice.toString()) : null,
      stock: variant.stock,
    }));

    const validation = validateManualVariantMapping({
      canonicalVariants,
      supplierVariants,
      mappings: parsed.data.mappings,
    });

    if (!validation.valid) {
      return NextResponse.json(
        { ok: false, error: "Mapping inválido.", issues: validation.issues },
        { status: 422 },
      );
    }

    const supplierById = new Map(supplier.variants.map((variant) => [variant.id, variant]));

    await prisma.$transaction(async (tx) => {
      await tx.supplierVariantMapping.deleteMany({
        where: { supplierProductId: supplierId },
      });

      await tx.supplierVariantMapping.createMany({
        data: parsed.data.mappings.map((mapping) => {
          const supplierVariant = supplierById.get(mapping.supplierVariantId);
          return {
            supplierProductId: supplierId,
            supplierVariantId: mapping.supplierVariantId,
            canonicalVariantId: mapping.canonicalVariantId,
            confidence: 1,
            method: "MANUAL" as const,
            evidence: {
              source: "manual-confirmation",
              supplierSourceSkuId: supplierVariant?.sourceSkuId || null,
            },
            active: true,
            verifiedAt: new Date(),
          };
        }),
      });
    });

    return NextResponse.json({
      ok: true,
      valid: true,
      mappedVariants: parsed.data.mappings.length,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Manual supplier mapping failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Não foi possível salvar o mapping.",
      },
      { status: 500 },
    );
  }
}
