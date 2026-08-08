import path from "node:path";

import {
  NextResponse,
} from "next/server";

import {
  z,
} from "zod";

import {
  prisma,
} from "@/lib/prisma";

import {
  csvFromRows,
  downloadsRoot,
  ensureDir,
  safeName,
  saveRemoteImage,
  writeText,
} from "@/lib/local-export";

import {
  exportSelectedEditorialImages,
} from "@/lib/editorial-export";

export const runtime =
  "nodejs";

const schema =
  z.object({
    productId:
      z.string()
        .min(1),

    storeId:
      z.string()
        .min(1),
  });

function jsonObject(
  value: unknown
): Record<
  string,
  unknown
> {
  if (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  ) {
    return value as Record<
      string,
      unknown
    >;
  }

  return {};
}

function benefits(
  value: unknown
) {
  return Array.isArray(
    value
  )
    ? value
        .filter(
          item =>
            typeof item ===
            "string"
        )
        .join(" | ")
    : "";
}

export async function POST(
  request: Request
) {
  try {
    if (
      process.env
        .LOCAL_EXPORTS_ENABLED !==
      "true"
    ) {
      return NextResponse.json(
        {
          ok: false,

          error:
            "A exportação direta para Downloads está habilitada somente no Manager local.",
        },
        {
          status: 409,
        }
      );
    }

    const parsed =
      schema.safeParse(
        await request.json()
      );

    if (
      !parsed.success
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Produto ou loja inválidos.",
        },
        {
          status: 400,
        }
      );
    }

    const [
      product,
      store,
      publication,
    ] =
      await Promise.all([
        prisma.product.findUnique({
          where: {
            id:
              parsed.data
                .productId,
          },

          include: {
            images: {
              orderBy: {
                sortOrder:
                  "asc",
              },
            },

            variants: {
              orderBy: {
                createdAt:
                  "asc",
              },
            },
          },
        }),

        prisma.store.findUnique({
          where: {
            id:
              parsed.data
                .storeId,
          },
        }),

        prisma.publication.findUnique({
          where: {
            storeId_productId:
              {
                storeId:
                  parsed.data
                    .storeId,

                productId:
                  parsed.data
                    .productId,
              },
          },
        }),
      ]);

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

    if (!store) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Loja não encontrada.",
        },
        {
          status: 404,
        }
      );
    }

    const productName =
      safeName(
        product.optimizedTitle ||
          product.sourceTitle
      );

    const storeName =
      safeName(
        store.name
      );

    const folder =
      path.join(
        downloadsRoot(),
        storeName,
        "produtos",
        productName
      );

    const originals =
      path.join(
        folder,
        "imagens",
        "originais"
      );

    await ensureDir(
      originals
    );

    const specifications =
      jsonObject(
        product.specifications
      );

    const packageData =
      jsonObject(
        specifications.package
      );

    const productRow = {
      loja:
        store.name,

      manager_product_id:
        product.id,

      aliexpress_id:
        product.sourceProductId,

      origem:
        product.sourceProvider,

      url_origem:
        product.sourceUrl,

      titulo_original:
        product.sourceTitle,

      titulo:
        product.optimizedTitle,

      headline:
        product.headline,

      descricao:
        product.shortDescription,

      beneficios:
        benefits(
          product.benefits
        ),

      cta:
        product.cta,

      seo_title:
        product.seoTitle,

      seo_description:
        product.seoDescription,

      categoria:
        publication?.targetCategory ||
        "",

      faixa_etaria:
        publication?.targetAgeRange ||
        "",

      moeda_venda:
        product.storeCurrency,

      preco_inicial:
        product.recommendedPrice?.toString() ||
        "",

      preco_comparativo:
        product.compareAtPrice?.toString() ||
        "",

      moeda_custo:
        product.sourceCurrency,

      custo_minimo:
        product.costMin?.toString() ||
        "",

      custo_maximo:
        product.costMax?.toString() ||
        "",

      peso_kg:
        packageData.weight_kg ||
        "",

      comprimento_cm:
        packageData.length_cm ||
        "",

      largura_cm:
        packageData.width_cm ||
        "",

      altura_cm:
        packageData.height_cm ||
        "",

      status:
        product.status,

      exportado_em:
        new Date()
          .toISOString(),
    };

    const variantRows =
      product.variants.map(
        variant => ({
          aliexpress_id:
            product.sourceProductId,

          source_sku_id:
            variant.sourceSkuId,

          sku:
            variant.sku,

          variante:
            Object.entries(
              jsonObject(
                variant.attributes
              )
            )
              .map(
                ([key, value]) =>
                  `${key}: ${String(
                    value
                  )}`
              )
              .join(" | "),

          custo:
            variant.costPrice?.toString() ||
            "",

          moeda_custo:
            variant.sourceCurrency,

          preco_venda_brl:
            variant.salePrice?.toString() ||
            "",

          estoque:
            variant.stock,

          disponivel:
            variant.available,

          imagem:
            variant.imageUrl ||
            "",
        })
      );

    await writeText(
      path.join(
        folder,
        "produto.csv"
      ),

      csvFromRows([
        productRow,
      ])
    );

    await writeText(
      path.join(
        folder,
        "variantes.csv"
      ),

      csvFromRows(
        variantRows
      )
    );

    await writeText(
      path.join(
        folder,
        "produto.json"
      ),

      JSON.stringify(
        {
          store: {
            id:
              store.id,

            name:
              store.name,

            url:
              store.baseUrl,
          },

          product:
            productRow,

          variants:
            variantRows,

          specifications:
            product.specifications,

          publication:
            publication
              ? {
                  status:
                    publication.status,

                  category:
                    publication.targetCategory,

                  ageRange:
                    publication.targetAgeRange,

                  url:
                    publication.externalUrl,
                }
              : null,
        },
        null,
        2
      )
    );

    const imageErrors:
      string[] = [];

    for (
      let index = 0;
      index <
      product.images.length;
      index++
    ) {
      const image =
        product.images[
          index
        ];

      const url =
        image.storedUrl ||
        image.sourceUrl;

      try {
        await saveRemoteImage({
          url,

          targetBase:
            path.join(
              originals,
              String(
                index + 1
              ).padStart(
                2,
                "0"
              )
            ),
        });
      } catch (
        error
      ) {
        imageErrors.push(
          `${index + 1}: ${
            error instanceof
            Error
              ? error.message
              : "erro"
          }`
        );
      }
    }

    const editorialExport =
      await exportSelectedEditorialImages({
        productId:
          product.id,

        storeId:
          store.id,

        targetFolder:
          path.join(
            folder,
            "imagens",
            "editoriais"
          ),
      });

    await writeText(
      path.join(
        folder,
        "export-report.json"
      ),

      JSON.stringify(
        {
          exportedAt:
            new Date()
              .toISOString(),

          originalImages:
            product.images
              .length,

          editorialExport,

          imageErrors,
        },
        null,
        2
      )
    );

    return NextResponse.json({
      ok: true,

      folder,

      originalImages:
        product.images
          .length,

      editorialExport,

      imageErrors,
    });
  } catch (error) {
    console.error(
      "Product export failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof
          Error
            ? error.message
            : "Não foi possível exportar.",
      },
      {
        status: 500,
      }
    );
  }
}
