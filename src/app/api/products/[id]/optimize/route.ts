import { NextResponse } from "next/server";

import {
  DEFAULT_COPY_LANGUAGE,
  isCopyLanguage,
} from "@/lib/copy-language";
import {
  convertMoney,
  storeCurrencyForCopyLanguage,
} from "@/lib/copy-market";
import { fetchFxRate } from "@/lib/fx-rate";
import { prisma } from "@/lib/prisma";
import { generateQuotaSafeProductCopy } from "@/lib/quota-safe-product-copy";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const { id } = await context.params;
    const body = await request
      .json()
      .catch(() => ({}));

    const requestedLanguage =
      body &&
      typeof body === "object" &&
      "language" in body
        ? (body as {
            language?: unknown;
          }).language
        : DEFAULT_COPY_LANGUAGE;

    if (!isCopyLanguage(requestedLanguage)) {
      return NextResponse.json({
        ok: false,
        error:
          "Idioma de copy inválido. Escolha Português (Brasil), English, Français ou Deutsch.",
      }, {
        status: 400,
      });
    }

    const product = await prisma.product.findUnique({
      where: { id },
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
      return NextResponse.json({
        ok: false,
        error: "Produto não encontrado.",
      }, {
        status: 404,
      });
    }

    if (
      !product.sourceTitle ||
      product.images.length === 0 ||
      product.variants.length === 0
    ) {
      return NextResponse.json({
        ok: false,
        error:
          "O produto não possui dados operacionais suficientes para gerar uma copy segura.",
      }, {
        status: 422,
      });
    }

    const targetCurrency =
      storeCurrencyForCopyLanguage(
        requestedLanguage
      );
    const currentCurrency =
      product.storeCurrency
        .trim()
        .toUpperCase();
    const hasCommercialPrices = Boolean(
      product.recommendedPrice ||
      product.compareAtPrice ||
      product.variants.some(
        (variant) => variant.salePrice
      )
    );

    let currencyRate = 1;
    let currencyRateDate: string | null = null;

    if (
      hasCommercialPrices &&
      currentCurrency !== targetCurrency
    ) {
      const quote = await fetchFxRate({
        from: currentCurrency,
        to: targetCurrency,
      });
      currencyRate = quote.rate;
      currencyRateDate = quote.date;
    }

    const convertExisting = (
      value: { toString(): string } | null
    ) => {
      if (!value) return null;
      return currentCurrency === targetCurrency
        ? Number(value.toString())
        : convertMoney(
            Number(value.toString()),
            currencyRate
          );
    };

    const copy =
      await generateQuotaSafeProductCopy({
        language: requestedLanguage,
        sourceTitle: product.sourceTitle,
        sourceDescription:
          product.sourceDescription,
        sourceCurrency:
          product.sourceCurrency,
        costMin:
          product.costMin?.toString() || null,
        costMax:
          product.costMax?.toString() || null,
        specifications:
          product.specifications,
        variants: product.variants.map(
          (variant) => ({
            sourceSkuId:
              variant.sourceSkuId,
            attributes:
              variant.attributes,
            costPrice:
              variant.costPrice?.toString() || null,
            stock:
              variant.stock,
          })
        ),
      });

    const operations = [
      prisma.product.update({
        where: {
          id: product.id,
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
          recommendedPrice:
            convertExisting(
              product.recommendedPrice
            ),
          compareAtPrice:
            convertExisting(
              product.compareAtPrice
            ),
          storeCurrency:
            targetCurrency,
          aiCopyVersion:
            `gemini:commerce-copy-v4-market:${requestedLanguage}:${targetCurrency}`,
          status: "DRAFT",
        },
      }),
      ...product.variants
        .filter(
          (variant) =>
            variant.salePrice !== null
        )
        .map((variant) =>
          prisma.productVariant.update({
            where: {
              id: variant.id,
            },
            data: {
              salePrice:
                convertExisting(
                  variant.salePrice
                ),
            },
          })
        ),
    ];

    const [updated] =
      await prisma.$transaction(
        operations
      );

    return NextResponse.json({
      ok: true,
      language: requestedLanguage,
      storeCurrency: targetCurrency,
      currencyConversion:
        currentCurrency !== targetCurrency
          ? {
              from: currentCurrency,
              to: targetCurrency,
              rate: currencyRate,
              date: currencyRateDate,
              convertedExistingPrices:
                hasCommercialPrices,
            }
          : null,
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

    return NextResponse.json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível otimizar o produto.",
    }, {
      status: 500,
    });
  }
}
