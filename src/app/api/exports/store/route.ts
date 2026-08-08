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

export const runtime =
  "nodejs";

const schema =
  z.object({
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
  return value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
      ? value as Record<
          string,
          unknown
        >
      : {};
}

function benefitText(
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
            "Esta função está disponível somente no Manager local.",
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

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Loja inválida.",
        },
        {
          status: 400,
        }
      );
    }

    const store =
      await prisma.store.findUnique({
        where: {
          id:
            parsed.data
              .storeId,
        },
      });

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

    /*
     * Um produto pertence à pasta de uma loja
     * quando já existe Publication para aquela loja,
     * mesmo que ainda esteja em DRAFT.
     */
    const publications =
      await prisma.publication.findMany({
        where: {
          storeId:
            store.id,
        },

        include: {
          product: {
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
          },
        },

        orderBy: {
          createdAt:
            "asc",
        },
      });

    const storeFolder =
      path.join(
        downloadsRoot(),
        safeName(
          store.name
        )
      );

    await ensureDir(
      storeFolder
    );

    const catalogRows:
      Record<
        string,
        unknown
      >[] = [];

    const errors:
      string[] = [];

    for (
      const publication of
        publications
    ) {
      const product =
        publication.product;

      const folder =
        path.join(
          storeFolder,
          "produtos",
          safeName(
            product.optimizedTitle ||
              product.sourceTitle
          )
        );

      const imageFolder =
        path.join(
          folder,
          "imagens",
          "originais"
        );

      await ensureDir(
        imageFolder
      );

      const specs =
        jsonObject(
          product.specifications
        );

      const packageData =
        jsonObject(
          specs.package
        );

      const summary = {
        loja:
          store.name,

        aliexpress_id:
          product.sourceProductId,

        titulo:
          product.optimizedTitle,

        descricao:
          product.shortDescription,

        beneficios:
          benefitText(
            product.benefits
          ),

        categoria:
          publication.targetCategory,

        faixa_etaria:
          publication.targetAgeRange,

        preco_inicial_brl:
          product.recommendedPrice?.toString() ||
          "",

        preco_comparativo_brl:
          product.compareAtPrice?.toString() ||
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

        status_produto:
          product.status,

        status_publicacao:
          publication.status,

        url_produto:
          publication.externalUrl,
      };

      const variants =
        product.variants.map(
          variant => ({
            aliexpress_id:
              product.sourceProductId,

            sku:
              variant.sourceSkuId,

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
          })
        );

      await writeText(
        path.join(
          folder,
          "produto.csv"
        ),

        csvFromRows([
          summary,
        ])
      );

      await writeText(
        path.join(
          folder,
          "variantes.csv"
        ),

        csvFromRows(
          variants
        )
      );

      await writeText(
        path.join(
          folder,
          "produto.json"
        ),

        JSON.stringify(
          {
            summary,
            variants,
            specifications:
              product.specifications,
          },
          null,
          2
        )
      );

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

        try {
          await saveRemoteImage({
            url:
              image.storedUrl ||
              image.sourceUrl,

            targetBase:
              path.join(
                imageFolder,
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
          errors.push(
            `${product.sourceProductId} imagem ${index + 1}: ${
              error instanceof
              Error
                ? error.message
                : "erro"
            }`
          );
        }
      }

      if (
        variants.length ===
        0
      ) {
        catalogRows.push(
          summary
        );
      } else {
        for (
          const variant of
            variants
        ) {
          catalogRows.push({
            ...summary,
            ...variant,
          });
        }
      }
    }

    await writeText(
      path.join(
        storeFolder,
        "catalogo.csv"
      ),

      csvFromRows(
        catalogRows
      )
    );

    await writeText(
      path.join(
        storeFolder,
        "export-report.json"
      ),

      JSON.stringify(
        {
          exportedAt:
            new Date()
              .toISOString(),

          products:
            publications.length,

          rows:
            catalogRows.length,

          errors,
        },
        null,
        2
      )
    );

    return NextResponse.json({
      ok: true,

      folder:
        storeFolder,

      products:
        publications.length,

      rows:
        catalogRows.length,

      errors,
    });
  } catch (error) {
    console.error(
      "Store export failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof
          Error
            ? error.message
            : "Não foi possível exportar a loja.",
      },
      {
        status: 500,
      }
    );
  }
}
