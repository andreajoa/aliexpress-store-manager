import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { selectSupplier } from "@/lib/supplier-selection";

export const runtime = "nodejs";

const payloadSchema = z.object({
  requirements: z.array(z.object({
    canonicalVariantId: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1),
  maxAgeMinutes: z.number().int().positive().max(1440).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const parsed = payloadSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Informe variantes canônicas e quantidades válidas." },
        { status: 400 },
      );
    }

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        variants: { select: { id: true } },
        supplierProducts: {
          include: {
            mappings: {
              include: {
                supplierVariant: true,
              },
            },
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json({ ok: false, error: "Produto não encontrado." }, { status: 404 });
    }

    const canonicalIds = new Set(product.variants.map((variant) => variant.id));
    const unknown = parsed.data.requirements.find(
      (requirement) => !canonicalIds.has(requirement.canonicalVariantId),
    );
    if (unknown) {
      return NextResponse.json(
        { ok: false, error: `Variante não pertence ao produto: ${unknown.canonicalVariantId}` },
        { status: 422 },
      );
    }

    const result = selectSupplier({
      requirements: parsed.data.requirements,
      maxAgeMinutes: parsed.data.maxAgeMinutes,
      suppliers: product.supplierProducts.map((supplier) => ({
        id: supplier.id,
        role: supplier.role,
        priority: supplier.priority,
        status: supplier.status,
        sourceCurrency: supplier.sourceCurrency,
        lastCheckedAt: supplier.lastCheckedAt,
        mappings: supplier.mappings.map((mapping) => ({
          canonicalVariantId: mapping.canonicalVariantId,
          active: mapping.active,
          supplierVariant: {
            id: mapping.supplierVariant.id,
            sourceSkuId: mapping.supplierVariant.sourceSkuId,
            sourcePrice: mapping.supplierVariant.sourcePrice
              ? Number(mapping.supplierVariant.sourcePrice.toString())
              : null,
            stock: mapping.supplierVariant.stock,
          },
        })),
      })),
    });

    return NextResponse.json({
      ok: true,
      selection: result,
      automatic: Boolean(result.selected && !result.requiresReview),
    });
  } catch (error) {
    console.error("Supplier selection failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Não foi possível selecionar o fornecedor." },
      { status: 500 },
    );
  }
}
