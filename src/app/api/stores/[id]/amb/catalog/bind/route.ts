import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

import { normalizeAmbColor, normalizeAmbValue } from "@/lib/amb-catalog-detector";
import { ambVariantSize } from "@/lib/amb-variant-attributes";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const payloadSchema = z.object({
  slug: z.string().trim().min(1).max(200),
  sourceProductId: z.string().trim().min(1).max(100),
  color: z.string().trim().min(1).max(160),
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: storeId } = await context.params;
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Dados de vínculo inválidos.", fields: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, status: true, connectorCapabilities: true },
    });
    if (!store || store.status !== "ACTIVE") {
      return NextResponse.json({ ok: false, error: "Loja não disponível." }, { status: 404 });
    }

    const { slug, sourceProductId, color } = parsed.data;
    const capabilities = record(store.connectorCapabilities);
    const scan = record(capabilities.ambCatalogScan);
    const catalog = record(scan.catalog);
    const catalogItem = record(catalog[slug]);
    if (!Object.keys(catalogItem).length) {
      return NextResponse.json(
        { ok: false, error: `Produto AMB não encontrado no último scan: ${slug}.` },
        { status: 404 },
      );
    }

    const expectedSizes = Array.isArray(catalogItem.sizes)
      ? catalogItem.sizes.map(text).filter(Boolean)
      : [];

    const product = await prisma.product.findUnique({
      where: {
        sourceProvider_sourceProductId: {
          sourceProvider: "ALIEXPRESS",
          sourceProductId,
        },
      },
      select: {
        id: true,
        sourceProductId: true,
        sourceTitle: true,
        variants: {
          select: {
            id: true,
            sourceSkuId: true,
            attributes: true,
            stock: true,
            available: true,
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { ok: false, error: `Produto AliExpress não importado: ${sourceProductId}.` },
        { status: 404 },
      );
    }

    const matchingVariants = product.variants.filter((variant) => {
      const attrs = record(variant.attributes);
      return normalizeAmbColor(attrs.Color) === normalizeAmbColor(color);
    });

    if (!matchingVariants.length) {
      return NextResponse.json(
        { ok: false, error: `A cor ${color} não existe no produto ${sourceProductId}.` },
        { status: 422 },
      );
    }

    const availableSizes = matchingVariants
      .map((variant) => ambVariantSize(record(variant.attributes)))
      .filter(Boolean);

    const missingSizes = expectedSizes.filter((size) =>
      !availableSizes.some((candidate) => normalizeAmbValue(candidate) === normalizeAmbValue(size)),
    );

    if (missingSizes.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "O vínculo foi bloqueado porque faltam tamanhos do catálogo AMB.",
          missingSizes,
          availableSizes,
        },
        { status: 422 },
      );
    }

    const bridge = record(capabilities.ambBridge);
    const products = record(bridge.products);
    const pending = Array.isArray(scan.pending) ? scan.pending : [];

    const nextCapabilities = {
      ...capabilities,
      ambBridge: {
        version: 1,
        mode: "backend-only",
        ...bridge,
        products: {
          ...products,
          [slug]: { sourceProductId, color },
        },
      },
      ambCatalogScan: {
        ...scan,
        pending: pending.filter((item) => record(item).slug !== slug),
      },
    };

    await prisma.store.update({
      where: { id: storeId },
      data: { connectorCapabilities: nextCapabilities as Prisma.InputJsonValue },
    });

    return NextResponse.json({
      ok: true,
      slug,
      binding: { sourceProductId, color },
      sourceTitle: product.sourceTitle,
      expectedSizes,
      availableSizes,
      variants: matchingVariants.map((variant) => ({
        sourceSkuId: variant.sourceSkuId,
        size: ambVariantSize(record(variant.attributes)),
        stock: variant.stock,
        available: variant.available,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Não foi possível salvar o vínculo.",
      },
      { status: 500 },
    );
  }
}
