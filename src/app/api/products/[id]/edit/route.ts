import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const schema = z.object({
  optimizedTitle: z.string().trim().min(3).max(150),
  headline: z.string().trim().min(3).max(250),
  shortDescription: z.string().trim().min(10).max(2000),
  benefits: z
    .array(z.string().trim().min(2).max(300))
    .min(1)
    .max(10),
  cta: z.string().trim().min(2).max(150),
  seoTitle: z.string().trim().min(3).max(100),
  seoDescription: z.string().trim().min(10).max(170),
  compareAtPrice: z.string().optional().default(""),
  selectedImageIds: z.array(z.string()).min(1),
  variantPrices: z.array(
    z.object({
      id: z.string(),
      salePrice: z.string(),
    })
  ),
});

function parseMoney(value: string): number | null {
  let text = value
    .trim()
    .replace(/[^0-9,.-]/g, "");

  if (!text) return null;

  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");

  if (comma >= 0 && dot >= 0) {
    if (comma > dot) {
      text = text
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (comma >= 0) {
    text = text.replace(",", ".");
  }

  const result = Number(text);

  if (!Number.isFinite(result) || result <= 0) {
    throw new Error(`Preço inválido: ${value}`);
  }

  return Math.round(result * 100) / 100;
}

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id } = await context.params;
    const parsed = schema.safeParse(
      await request.json()
    );

    if (!parsed.success) {
      return NextResponse.json({
        ok: false,
        error: "Revise os campos informados.",
        details: parsed.error.flatten(),
      }, {
        status: 400,
      });
    }

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        images: true,
        variants: true,
      },
    });

    if (!product) {
      return NextResponse.json({
        ok: false,
        error: "Produto não encontrado.",
      }, {
        status: 404,
      });
    }

    const imageIds = new Set(
      product.images.map((image) => image.id)
    );

    for (const imageId of parsed.data.selectedImageIds) {
      if (!imageIds.has(imageId)) {
        return NextResponse.json({
          ok: false,
          error:
            "Uma das imagens selecionadas não pertence a este produto.",
        }, {
          status: 400,
        });
      }
    }

    const variantIds = new Set(
      product.variants.map((variant) => variant.id)
    );
    const prices = parsed.data.variantPrices.map(
      (item) => {
        if (!variantIds.has(item.id)) {
          throw new Error(
            "Uma das variantes não pertence a este produto."
          );
        }

        return {
          id: item.id,
          salePrice: parseMoney(item.salePrice),
        };
      }
    );
    const numericPrices = prices
      .map((item) => item.salePrice)
      .filter(
        (value): value is number =>
          value !== null
      );
    const lowestPrice =
      numericPrices.length > 0
        ? Math.min(...numericPrices)
        : null;
    const compareAtPrice = parseMoney(
      parsed.data.compareAtPrice
    );

    await prisma.$transaction([
      prisma.product.update({
        where: { id },
        data: {
          optimizedTitle:
            parsed.data.optimizedTitle,
          headline:
            parsed.data.headline,
          shortDescription:
            parsed.data.shortDescription,
          benefits:
            parsed.data.benefits,
          cta:
            parsed.data.cta,
          seoTitle:
            parsed.data.seoTitle,
          seoDescription:
            parsed.data.seoDescription,
          recommendedPrice:
            lowestPrice,
          compareAtPrice,
          status: "DRAFT",
        },
      }),
      prisma.productImage.updateMany({
        where: {
          productId: id,
        },
        data: {
          selected: false,
        },
      }),
      prisma.productImage.updateMany({
        where: {
          productId: id,
          id: {
            in: parsed.data.selectedImageIds,
          },
        },
        data: {
          selected: true,
        },
      }),
      ...prices.map((item) =>
        prisma.productVariant.update({
          where: {
            id: item.id,
          },
          data: {
            salePrice: item.salePrice,
          },
        })
      ),
    ]);

    return NextResponse.json({
      ok: true,
      status: "DRAFT",
      storeCurrency:
        product.storeCurrency,
      recommendedPrice:
        lowestPrice,
    });
  } catch (error) {
    console.error(
      "Product edit error:",
      error
    );

    return NextResponse.json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o produto.",
    }, {
      status: 500,
    });
  }
}
