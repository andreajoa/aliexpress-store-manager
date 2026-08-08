import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { generateProductCopy } from "@/lib/product-copy";

export const runtime = "nodejs";

export async function POST(
  _request: Request,

  context: {
    params:
      Promise<{
        id: string;
      }>;
  }
) {
  try {
    const { id } =
      await context.params;

    const product =
      await prisma.product.findUnique({
        where: {
          id,
        },

        include: {
          variants: {
            orderBy: {
              createdAt: "asc",
            },
          },

          images: {
            orderBy: {
              sortOrder: "asc",
            },
          },
        },
      });

    if (!product) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Produto não encontrado.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      !product.sourceTitle ||
      product.images.length === 0 ||
      product.variants.length === 0
    ) {
      return NextResponse.json(
        {
          ok: false,

          error:
            "O produto não possui dados operacionais suficientes para gerar uma copy segura.",
        },
        {
          status: 422,
        }
      );
    }

    const copy =
      await generateProductCopy({
        sourceTitle:
          product.sourceTitle,

        sourceDescription:
          product.sourceDescription,

        sourceCurrency:
          product.sourceCurrency,

        costMin:
          product.costMin?.toString() ||
          null,

        costMax:
          product.costMax?.toString() ||
          null,

        specifications:
          product.specifications,

        variants:
          product.variants.map(
            (variant) => ({
              sourceSkuId:
                variant.sourceSkuId,

              attributes:
                variant.attributes,

              costPrice:
                variant.costPrice?.toString() ||
                null,

              stock:
                variant.stock,
            })
          ),
      });

    const updated =
      await prisma.product.update({
        where: {
          id:
            product.id,
        },

        data: {
          optimizedTitle:
            copy.optimizedTitle,

          headline:
            copy.headline,

          shortDescription:
            copy.shortDescription,

          benefits:
            copy.benefits,

          cta:
            copy.cta,

          seoTitle:
            copy.seoTitle,

          seoDescription:
            copy.seoDescription,

          aiCopyVersion:
            "gemini:commerce-copy-v2-audited",

          status:
            "DRAFT",
        },
      });

    return NextResponse.json({
      ok: true,

      copy: {
        optimizedTitle:
          updated.optimizedTitle,

        headline:
          updated.headline,

        shortDescription:
          updated.shortDescription,

        benefits:
          updated.benefits,

        cta:
          updated.cta,

        seoTitle:
          updated.seoTitle,

        seoDescription:
          updated.seoDescription,
      },
    });
  } catch (error) {
    console.error(
      "Gemini optimization failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Não foi possível otimizar o produto.",
      },
      {
        status: 500,
      }
    );
  }
}
