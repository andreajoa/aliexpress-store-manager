import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

import {
  extractAliExpressProductId,
  getOmkarProduct,
  type OmkarProduct,
  type OmkarVariantGroup,
} from "@/lib/omkar";

import {
  scrapeAliExpressProduct,
} from "@/lib/aliexpress";

export const runtime = "nodejs";

const payloadSchema = z.object({
  url: z.string().trim().url(),
});

function decimal(
  value: number | null | undefined
) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function uniqueUrls(
  values: Array<string | null | undefined>
) {
  return Array.from(
    new Set(
      values
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            /^https?:\/\//i.test(value)
        )
    )
  );
}

function buildOptionMap(
  groups: OmkarVariantGroup[]
) {
  const result = new Map<
    string,
    {
      attributeName: string;
      optionName: string;
      imageUrl: string | null;
    }
  >();

  for (const group of groups) {
    for (const option of group.options || []) {
      result.set(
        String(option.value_id),
        {
          attributeName:
            group.attribute_name ||
            "Variant",

          optionName:
            option.name ||
            String(option.value_id),

          imageUrl:
            option.image_url || null,
        }
      );
    }
  }

  return result;
}

function buildSkuAttributes(
  variantIds: string,
  optionMap: ReturnType<
    typeof buildOptionMap
  >
) {
  const attributes: Record<
    string,
    string
  > = {};

  for (
    const id of variantIds
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  ) {
    const option = optionMap.get(id);

    if (option) {
      attributes[
        option.attributeName
      ] = option.optionName;
    } else {
      attributes[
        `variant_${id}`
      ] = id;
    }
  }

  return attributes;
}

function skuImage(
  variantIds: string,
  optionMap: ReturnType<
    typeof buildOptionMap
  >
) {
  for (
    const id of variantIds
      .split(",")
      .map((item) => item.trim())
  ) {
    const image =
      optionMap.get(id)?.imageUrl;

    if (image) return image;
  }

  return null;
}

function validPrices(
  product: OmkarProduct
) {
  return (
    product.sku_pricing || []
  )
    .map((sku) => sku.sale_price)
    .filter(
      (price): price is number =>
        typeof price === "number" &&
        Number.isFinite(price) &&
        price >= 0
    );
}

export async function POST(
  request: Request
) {
  try {
    const parsed =
      payloadSchema.safeParse(
        await request.json()
      );

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Informe uma URL válida.",
        },
        { status: 400 }
      );
    }

    const requestedUrl =
      parsed.data.url;

    /*
     * CAMADA OPERACIONAL
     * Omkar é a fonte de verdade para:
     * ID, SKU, variantes, preços,
     * estoque, imagens e pacote.
     */
    const productId =
      extractAliExpressProductId(
        requestedUrl
      );

    const omkar =
      await getOmkarProduct(
        productId
      );

    const existing =
      await prisma.product.findUnique({
        where: {
          sourceProvider_sourceProductId:
            {
              sourceProvider:
                "ALIEXPRESS",

              sourceProductId:
                String(omkar.id),
            },
        },
      });

    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          duplicate: true,
          productId: existing.id,
          error:
            "Este produto do AliExpress já foi importado.",
        },
        { status: 409 }
      );
    }

    /*
     * CAMADA DE ENRIQUECIMENTO
     * ScrapingBee não é fonte de
     * verdade operacional.
     *
     * Se falhar, não derruba o import.
     */
    let enrichment:
      | Awaited<
          ReturnType<
            typeof scrapeAliExpressProduct
          >
        >
      | null = null;

    try {
      enrichment =
        await scrapeAliExpressProduct(
          requestedUrl
        );
    } catch (error) {
      console.warn(
        "ScrapingBee enrichment skipped:",
        error
      );
    }

    const skuPrices =
      validPrices(omkar);

    if (skuPrices.length === 0) {
      throw new Error(
        "O produto foi localizado, mas nenhum preço válido de SKU foi retornado."
      );
    }

    const costMin =
      Math.min(...skuPrices);

    const costMax =
      Math.max(...skuPrices);

    const images = uniqueUrls([
      ...(omkar.images_hd || []),
      ...(omkar.images || []),

      ...(
        enrichment?.images || []
      ),
    ]);

    if (images.length === 0) {
      throw new Error(
        "O produto não possui imagens válidas para importação."
      );
    }

    const groups =
      omkar.variants || [];

    const optionMap =
      buildOptionMap(groups);

    const skuPricing =
      omkar.sku_pricing || [];

    const sourceUrl =
      omkar.listing_url ||
      requestedUrl;

    const currency = (
      omkar.currency ||
      enrichment?.currency ||
      "USD"
    ).toUpperCase();

    const description =
      enrichment?.description || null;

    const product =
      await prisma.product.create({
        data: {
          sourceProvider:
            "ALIEXPRESS",

          sourceProductId:
            String(omkar.id),

          sourceUrl,

          sourceSellerId:
            omkar.seller?.id
              ? String(
                  omkar.seller.id
                )
              : null,

          sourceTitle:
            omkar.title,

          sourceDescription:
            description,

          sourceCurrency:
            currency,

          costMin:
            decimal(costMin),

          costMax:
            decimal(costMax),

          specifications: {
            categoryId:
              omkar.category_id ||
              null,

            seller: {
              name:
                omkar.seller?.name ||
                null,

              id:
                omkar.seller?.id ||
                null,

              logoUrl:
                omkar.seller
                  ?.logo_url ||
                null,
            },

            package:
              omkar.package ||
              null,

            videoUrl:
              omkar.video_url ||
              null,

            baseCurrency:
              omkar.base_currency ||
              null,

            hasWelcomeDeal:
              omkar.has_welcome_deal ??
              null,

            enrichmentSpecifications:
              enrichment
                ?.specifications ||
              [],

            shippingInfo:
              enrichment
                ?.shippingInfo ||
              "",

            stockInfo:
              enrichment
                ?.stockInfo ||
              "",
          },

          rawPayload: {
            omkar:
              JSON.parse(
                JSON.stringify(
                  omkar
                )
              ),

            scrapingBee:
              enrichment
                ? JSON.parse(
                    JSON.stringify(
                      enrichment.raw
                    )
                  )
                : null,
          },

          status: "IMPORTED",

          images: {
            create:
              images.map(
                (
                  sourceUrl,
                  index
                ) => ({
                  sourceUrl,
                  sortOrder:
                    index,
                  selected: true,
                  imageType:
                    "GALLERY",
                })
              ),
          },

          variants: {
            create:
              skuPricing.map(
                (sku) => {
                  const variantIds =
                    sku.variant_ids ||
                    "";

                  const attributes =
                    buildSkuAttributes(
                      variantIds,
                      optionMap
                    );

                  return {
                    sourceSkuId:
                      String(
                        sku.sku_id
                      ),

                    sku:
                      String(
                        sku.sku_id
                      ),

                    attributes,

                    costPrice:
                      decimal(
                        sku.sale_price
                      ),

                    sourceCurrency:
                      currency,

                    stock:
                      typeof sku.available_quantity ===
                      "number"
                        ? sku.available_quantity
                        : null,

                    available:
                      typeof sku.available_quantity ===
                      "number"
                        ? sku.available_quantity >
                          0
                        : true,

                    imageUrl:
                      skuImage(
                        variantIds,
                        optionMap
                      ),

                    rawPayload:
                      JSON.parse(
                        JSON.stringify(
                          sku
                        )
                      ),
                  };
                }
              ),
          },
        },

        include: {
          images: true,
          variants: true,
        },
      });

    const totalStock =
      product.variants.reduce(
        (total, variant) =>
          total +
          (variant.stock || 0),
        0
      );

    return NextResponse.json(
      {
        ok: true,

        product: {
          id:
            product.id,

          sourceProductId:
            product.sourceProductId,

          title:
            product.sourceTitle,

          description:
            product.sourceDescription,

          currency:
            product.sourceCurrency,

          costMin:
            product.costMin?.toString() ||
            null,

          costMax:
            product.costMax?.toString() ||
            null,

          images:
            product.images.length,

          variants:
            product.variants.length,

          totalStock,

          seller:
            omkar.seller?.name ||
            null,

          video:
            Boolean(
              omkar.video_url
            ),

          package:
            omkar.package ||
            null,

          skuPreview:
            product.variants
              .slice(0, 10)
              .map(
                (variant) => ({
                  sku:
                    variant.sourceSkuId,

                  attributes:
                    variant.attributes,

                  price:
                    variant.costPrice?.toString() ||
                    null,

                  stock:
                    variant.stock,

                  imageUrl:
                    variant.imageUrl,
                })
              ),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(
      "AliExpress import failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Não foi possível importar o produto.",
      },
      { status: 500 }
    );
  }
}
