import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id } = await context.params;

    const product = await prisma.product.findUnique({
      where: { id },

      include: {
        images: true,
        variants: true,
      },
    });

    if (!product) {
      return NextResponse.json(
        {
          ok: false,
          error: "Produto não encontrado.",
        },
        { status: 404 }
      );
    }

    if (
      !product.optimizedTitle ||
      !product.headline ||
      !product.shortDescription ||
      !product.cta ||
      !product.seoTitle ||
      !product.seoDescription
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "A apresentação comercial ainda está incompleta.",
        },
        { status: 422 }
      );
    }

    const selectedImages =
      product.images.filter(
        (image) => image.selected
      );

    if (selectedImages.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Selecione pelo menos uma imagem.",
        },
        { status: 422 }
      );
    }

    const sellable =
      product.variants.filter(
        (variant) =>
          variant.available &&
          (variant.stock === null ||
            variant.stock > 0)
      );

    if (sellable.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Nenhuma variante está disponível para venda.",
        },
        { status: 422 }
      );
    }

    const withoutPrice =
      sellable.filter(
        (variant) =>
          variant.salePrice === null
      );

    if (withoutPrice.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `${withoutPrice.length} variante(s) ainda estão sem preço de venda.`,
        },
        { status: 422 }
      );
    }

    const prices =
      sellable.map((variant) =>
        Number(
          variant.salePrice!.toString()
        )
      );

    const lowestPrice =
      Math.min(...prices);

    await prisma.product.update({
      where: { id },

      data: {
        recommendedPrice:
          lowestPrice,

        storeCurrency: "BRL",

        status: "READY",
      },
    });

    return NextResponse.json({
      ok: true,
      status: "READY",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível aprovar.",
      },
      { status: 500 }
    );
  }
}
