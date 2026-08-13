import fs from "node:fs/promises";

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  slugifyProduct,
  type StoreProductPayload,
} from "@/lib/publication-contract";

export const runtime = "nodejs";

const inputSchema = z.object({
  storeId: z.string().min(1),

  category: z
    .string()
    .trim()
    .min(2)
    .max(100),

  ageRange: z
    .string()
    .trim()
    .min(2)
    .max(150)
    .refine(
      (value) => {
        const normalized =
          value
            .normalize("NFD")
            .replace(
              /[\u0300-\u036f]/g,
              ""
            )
            .toLowerCase()
            .replace(
              /\s+/g,
              " "
            )
            .trim();

        const forbiddenExact = [
          "a confirmar",
          "a definir",
          "a verificar",
          "aguardando confirmacao",
          "nao definido",
          "nao definida",
          "nao informada",
          "nao informado",
          "indefinido",
          "indefinida",
          "pendente",
          "unknown",
          "not informed",
          "n/a",
          "na",
          "consulte a indicacao do fabricante",
          "consulte o fabricante",
          "consulte a embalagem",
        ];

        const forbiddenPrefixes = [
          "a confirmar ",
          "a definir ",
          "a verificar ",
          "aguardando confirmacao ",
          "pendente ",
        ];

        return (
          !forbiddenExact.includes(
            normalized
          ) &&
          !forbiddenPrefixes.some(
            (prefix) =>
              normalized.startsWith(
                prefix
              )
          )
        );
      },
      {
        message:
          "A faixa etária precisa ser uma informação real e verificada; valores provisórios não são aceitos.",
      }
    ),

  ageSource: z.enum([
    "PACKAGE_LABEL",
    "SUPPLIER_SPECIFICATION",
    "MANUFACTURER_DOCUMENTATION",
    "CERTIFICATION",
  ]),

  ageEvidence: z
    .string()
    .trim()
    .min(
      5,
      "Informe a evidência usada para verificar a faixa etária."
    )
    .max(2000),

  ageVerified: z
    .boolean()
    .refine(
      (value) => value === true,
      {
        message:
          "Confirme que a faixa etária foi copiada de uma fonte verificável e não inferida.",
      }
    ),
});

function objectValue(
  value: unknown
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(
  value: unknown
): number | null {
  const result = Number(value);

  return Number.isFinite(result)
    ? result
    : null;
}

function cents(
  value: { toString(): string } | null
) {
  if (!value) return null;

  const numeric =
    Number(value.toString());

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.round(
    numeric * 100
  );
}

function attributesObject(
  value: unknown
): Record<string, string> {
  const source =
    objectValue(value);

  return Object.fromEntries(
    Object.entries(source)
      .filter(
        ([, value]) =>
          typeof value === "string" ||
          typeof value === "number"
      )
      .map(
        ([key, value]) => [
          key,
          String(value),
        ]
      )
  );
}

function benefitsArray(
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" &&
      item.trim().length > 0
  );
}


function auditPassed(
  value: unknown
): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (
        value as Record<string, unknown>
      ).pass === true
  );
}

export async function POST(
  request: Request,

  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const { id } =
      await context.params;

    const parsed =
      inputSchema.safeParse(
        await request.json()
      );

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error:
            parsed.error.issues[0]?.message ||
            "Escolha a loja, a categoria e a faixa etária antes de preparar a publicação.",
        },
        {
          status: 400,
        }
      );
    }

    const [
      product,
      store,
    ] =
      await Promise.all([
        prisma.product.findUnique({
          where: {
            id,
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

    if (
      store.status !== "ACTIVE"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "A loja precisa estar conectada antes de preparar uma publicação.",
        },
        {
          status: 409,
        }
      );
    }

    if (
      product.status !== "READY"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "O produto precisa estar aprovado antes da publicação.",
        },
        {
          status: 409,
        }
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
            "A apresentação comercial está incompleta.",
        },
        {
          status: 422,
        }
      );
    }

    const selectedImages =
      product.images.filter(
        (image) =>
          image.selected
      );

    if (
      selectedImages.length ===
      0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Nenhuma imagem foi selecionada.",
        },
        {
          status: 422,
        }
      );
    }

    const sellableVariants =
      product.variants.filter(
        (variant) =>
          variant.available &&
          (variant.stock ===
            null ||
            variant.stock > 0)
      );

    if (
      sellableVariants.length ===
      0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "O produto não possui variantes disponíveis.",
        },
        {
          status: 422,
        }
      );
    }

    const withoutPrice =
      sellableVariants.filter(
        (variant) =>
          variant.salePrice ===
          null
      );

    if (
      withoutPrice.length >
      0
    ) {
      return NextResponse.json(
        {
          ok: false,

          error:
            `${withoutPrice.length} variante(s) ainda estão sem preço de venda.`,
        },
        {
          status: 422,
        }
      );
    }

    const specifications =
      objectValue(
        product.specifications
      );

    const packageData =
      objectValue(
        specifications.package
      );

    const lengthCm =
      numberValue(
        packageData.length_cm
      );

    const widthCm =
      numberValue(
        packageData.width_cm
      );

    const heightCm =
      numberValue(
        packageData.height_cm
      );

    const weightKg =
      numberValue(
        packageData.weight_kg
      );

    if (
      !lengthCm ||
      !widthCm ||
      !heightCm ||
      !weightKg ||
      lengthCm <= 0 ||
      widthCm <= 0 ||
      heightCm <= 0 ||
      weightKg <= 0
    ) {
      return NextResponse.json(
        {
          ok: false,

          error:
            "As dimensões e o peso do produto precisam estar disponíveis antes de publicar.",
        },
        {
          status: 422,
        }
      );
    }

    const variants =
      sellableVariants.map(
        (variant) => {
          const attributes =
            attributesObject(
              variant.attributes
            );

          const variantName =
            Object.entries(
              attributes
            )
              .map(
                ([key, value]) =>
                  `${key}: ${value}`
              )
              .join(" · ") ||
            "Padrão";

          const salePrice =
            cents(
              variant.salePrice
            );

          if (
            salePrice === null
          ) {
            throw new Error(
              `A variante ${variant.sourceSkuId} está sem preço.`
            );
          }

          return {
            sourceSkuId:
              variant.sourceSkuId,

            name:
              variantName,

            price:
              salePrice,

            stock:
              Math.max(
                0,
                variant.stock ??
                  0
              ),

            attributes,

            imageUrl:
              variant.imageUrl ||
              null,
          };
        }
      );

    const price =
      Math.min(
        ...variants.map(
          (variant) =>
            variant.price
        )
      );

    const totalStock =
      variants.reduce(
        (
          total,
          variant
        ) =>
          total +
          variant.stock,
        0
      );

    const title =
      product.optimizedTitle;

    const slug =
      slugifyProduct(
        title
      );

    const externalProductId =
      `ae-${product.sourceProductId}`;

    const gallery =
      selectedImages.map(
        (image) =>
          image.storedUrl ||
          image.sourceUrl
      );

    const compareAtPrice =
      cents(
        product.compareAtPrice
      );

    const editorialAssets =
      await prisma.editorialAsset.findMany({
        where: {
          productId:
            product.id,

          storeId:
            store.id,

          selected:
            true,
        },

        orderBy: [
          {
            batch:
              "desc",
          },
          {
            createdAt:
              "asc",
          },
        ],
      });

    /*
     * FAIL-CLOSED:
     * um ativo editorial selecionado nunca entra
     * no payload apenas porque selected=true.
     *
     * Ele precisa:
     * - pertencer ao produto/loja atuais
     *   (garantido pelo findMany acima);
     * - possuir auditoria aprovada;
     * - possuir generatedPath;
     * - existir fisicamente no storage local.
     */
    const invalidEditorialAssets:
      Array<{
        id: string;
        type: string;
        reason: string;
      }> = [];

    for (
      const asset
      of editorialAssets
    ) {
      if (
        !auditPassed(
          asset.audit
        )
      ) {
        invalidEditorialAssets.push({
          id:
            asset.id,

          type:
            asset.assetType,

          reason:
            "audit_not_approved",
        });

        continue;
      }

      const generatedPath =
        asset.generatedPath;

      if (!generatedPath) {
        invalidEditorialAssets.push({
          id:
            asset.id,

          type:
            asset.assetType,

          reason:
            "generated_path_missing",
        });

        continue;
      }

      try {
        const stat =
          await fs.stat(
            generatedPath
          );

        if (!stat.isFile()) {
          invalidEditorialAssets.push({
            id:
              asset.id,

            type:
              asset.assetType,

            reason:
              "generated_file_invalid",
          });
        }
      } catch {
        invalidEditorialAssets.push({
          id:
            asset.id,

          type:
            asset.assetType,

          reason:
            "generated_file_missing",
        });
      }
    }

    if (
      invalidEditorialAssets.length >
      0
    ) {
      return NextResponse.json(
        {
          ok: false,

          error:
            "Há imagens editoriais selecionadas que não estão aptas para publicação.",

          invalidEditorialAssets,
        },
        {
          status: 422,
        }
      );
    }

    const ageVerifiedAt =
      new Date();

    const payload:
      StoreProductPayload =
      {
        protocolVersion:
          "2026-08-01",

        product: {
          id:
            externalProductId,

          sourceProductId:
            product.sourceProductId,

          title,
          slug,

          headline:
            product.headline,

          description:
            product.shortDescription,

          benefits:
            benefitsArray(
              product.benefits
            ),

          cta:
            product.cta,

          price,

          compareAtPrice,

          currency:
            "BRL",

          image:
            gallery[0],

          gallery,

          editorialAssets:
            editorialAssets.map(
              asset => ({
                id:
                  asset.id,

                type:
                  asset.assetType,
              })
            ),

          category:
            parsed.data
              .category,

          ageRange:
            parsed.data
              .ageRange,

          stock:
            totalStock,

          variants,

          shipping: {
            weightGrams:
              Math.round(
                weightKg *
                  1000
              ),

            lengthCm:
              Math.ceil(
                lengthCm
              ),

            widthCm:
              Math.ceil(
                widthCm
              ),

            heightCm:
              Math.ceil(
                heightCm
              ),
          },

          seo: {
            title:
              product.seoTitle,

            description:
              product.seoDescription,
          },

          source: {
            provider:
              "ALIEXPRESS",

            productId:
              product.sourceProductId,

            url:
              product.sourceUrl,
          },
        },
      };

    const targetBaseUrl =
      store.baseUrl.replace(
        /\/+$/,
        ""
      );

    const targetUrl =
      `${targetBaseUrl}/produto/${externalProductId}`;

    const publication =
      await prisma.publication.upsert({
        where: {
          storeId_productId: {
            storeId:
              store.id,

            productId:
              product.id,
          },
        },

        create: {
          storeId:
            store.id,

          productId:
            product.id,

          externalProductId,
          externalSlug:
            slug,
          externalUrl:
            targetUrl,

          salePrice:
            price / 100,

          compareAtPrice:
            compareAtPrice !==
            null
              ? compareAtPrice /
                100
              : null,

          targetCategory:
            parsed.data
              .category,

          targetAgeRange:
            parsed.data
              .ageRange,

          targetAgeSource:
            parsed.data
              .ageSource,

          targetAgeEvidence:
            parsed.data
              .ageEvidence,

          targetAgeVerifiedAt:
            ageVerifiedAt,

          payload,

          status:
            "DRAFT",
        },

        update: {
          externalProductId,
          externalSlug:
            slug,
          externalUrl:
            targetUrl,

          salePrice:
            price / 100,

          compareAtPrice:
            compareAtPrice !==
            null
              ? compareAtPrice /
                100
              : null,

          targetCategory:
            parsed.data
              .category,

          targetAgeRange:
            parsed.data
              .ageRange,

          targetAgeSource:
            parsed.data
              .ageSource,

          targetAgeEvidence:
            parsed.data
              .ageEvidence,

          targetAgeVerifiedAt:
            ageVerifiedAt,

          payload,

          status:
            "DRAFT",

          lastError:
            null,

          githubBranch:
            null,

          githubCommitSha:
            null,

          pullRequestNumber:
            null,

          previewUrl:
            null,
        },
      });

    return NextResponse.json({
      ok: true,

      publication: {
        id:
          publication.id,

        status:
          publication.status,

        targetUrl,

        ageRangeVerification: {
          source:
            publication.targetAgeSource,

          evidence:
            publication.targetAgeEvidence,

          verifiedAt:
            publication.targetAgeVerifiedAt,
        },
      },

      store: {
        id:
          store.id,

        name:
          store.name,

        baseUrl:
          store.baseUrl,
      },

      payload,
    });
  } catch (error) {
    console.error(
      "Publication preview failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Não foi possível preparar a publicação.",
      },
      {
        status: 500,
      }
    );
  }
}
