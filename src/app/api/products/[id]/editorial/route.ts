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
  generateCloudflareEditorial,
} from "@/lib/cloudflare-image";

import {
  planEditorialScenes,
} from "@/lib/editorial-scene-planner";

import {
  auditEditorialFidelity,
  type FidelityAudit,
} from "@/lib/editorial-fidelity-audit";

import {
  removeEditorialImage,
  saveEditorialImage,
} from "@/lib/editorial-storage";

export const runtime =
  "nodejs";

export const maxDuration =
  300;

const inputSchema =
  z.object({
    storeId:
      z.string()
        .min(1),

    referenceImageId:
      z.string()
        .min(1),
  });

const AI_PREFIX =
  "AI_";

function objectValue(
  value: unknown
): Record<string, unknown> {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as
      Record<string, unknown>;
  }

  return {};
}

function publicAsset(
  asset: {
    id: string;
    assetType: string;
    batch: number;
    selected: boolean;
    prompt:
      string | null;
    fidelityScore:
      number | null;
    audit:
      unknown;
  }
) {
  const audit =
    objectValue(
      asset.audit
    );

  return {
    id:
      asset.id,

    type:
      asset.assetType,

    batch:
      asset.batch,

    selected:
      asset.selected,

    prompt:
      asset.prompt,

    fidelityScore:
      asset.fidelityScore,

    auditPassed:
      typeof audit.pass ===
        "boolean"
        ? audit.pass
        : null,

    auditIssues:
      Array.isArray(
        audit.issues
      )
        ? audit.issues.filter(
            (
              value
            ): value is string =>
              typeof value ===
                "string"
          )
        : [],

    imageUrl:
      `/api/editorial-assets/${asset.id}/image`,
  };
}

export async function GET(
  request: Request,

  context: {
    params:
      Promise<{
        id: string;
      }>;
  }
) {
  const { id } =
    await context.params;

  const url =
    new URL(
      request.url
    );

  const storeId =
    url.searchParams.get(
      "storeId"
    );

  if (!storeId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "storeId obrigatório.",
      },
      {
        status: 400,
      }
    );
  }

  const latest =
    await prisma.editorialAsset.findFirst({
      where: {
        productId: id,
        storeId,

        assetType: {
          startsWith:
            AI_PREFIX,
        },

        generatedPath: {
          not: null,
        },
      },

      orderBy: {
        batch: "desc",
      },
    });

  if (!latest) {
    return NextResponse.json({
      ok: true,
      batch: null,
      assets: [],
    });
  }

  const assets =
    await prisma.editorialAsset.findMany({
      where: {
        productId: id,
        storeId,

        batch:
          latest.batch,

        assetType: {
          startsWith:
            AI_PREFIX,
        },

        generatedPath: {
          not: null,
        },
      },

      orderBy: {
        createdAt:
          "asc",
      },
    });

  return NextResponse.json({
    ok: true,

    batch:
      latest.batch,

    assets:
      assets.map(
        publicAsset
      ),
  });
}

export async function POST(
  request: Request,

  context: {
    params:
      Promise<{
        id: string;
      }>;
  }
) {
  const created:
    Array<{
      id: string;
      generatedPath:
        string | null;
    }> = [];

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
            "Escolha a loja e uma imagem-base.",
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
            id,
          },

          include: {
            images: {
              orderBy: {
                sortOrder:
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
                  id,
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

    if (
      product.status !==
      "READY"
    ) {
      return NextResponse.json(
        {
          ok: false,

          error:
            "O produto precisa estar aprovado.",
        },
        {
          status: 409,
        }
      );
    }

    const referenceImage =
      product.images.find(
        image =>
          image.id ===
          parsed.data
            .referenceImageId
      );

    if (!referenceImage) {
      return NextResponse.json(
        {
          ok: false,

          error:
            "A imagem-base não pertence a este produto.",
        },
        {
          status: 422,
        }
      );
    }

    const referenceUrl =
      referenceImage.storedUrl ||
      referenceImage.sourceUrl;

    await prisma.product.update({
      where: {
        id:
          product.id,
      },

      data: {
        editorialReferenceImageId:
          referenceImage.id,
      },
    });

    const previous =
      await prisma.editorialAsset.findFirst({
        where: {
          productId:
            product.id,

          storeId:
            store.id,

          assetType: {
            startsWith:
              AI_PREFIX,
          },
        },

        orderBy: {
          batch:
            "desc",
        },
      });

    const batch =
      (previous?.batch ||
        0) + 1;

    /*
     * Não enviamos variantes para o
     * diretor criativo.
     *
     * Isso impede a IA de misturar SKUs.
     */
    const plan =
      await planEditorialScenes({
        title:
          product.optimizedTitle ||
          product.sourceTitle,

        description:
          product.shortDescription,

        category:
          publication?.targetCategory ||
          null,

        ageRange:
          publication?.targetAgeRange ||
          null,

        variants: [],

        brand:
          store.brandProfile,

        batch,
      });

    const scenes = [
      {
        type:
          "AI_LIFESTYLE",

        prompt:
          plan.lifestyle,
      },

      {
        type:
          "AI_IN_USE",

        prompt:
          plan.inUse,
      },

      {
        type:
          "AI_PREMIUM_SCENE",

        prompt:
          plan.premiumScene,
      },

      {
        type:
          "AI_DETAIL_CONTEXT",

        prompt:
          plan.detailContext,
      },
    ];

    /*
     * Um novo lote não herda seleção
     * do lote anterior.
     */
    await prisma.editorialAsset.updateMany({
      where: {
        productId:
          product.id,

        storeId:
          store.id,

        selected: true,
      },

      data: {
        selected: false,
      },
    });

    const finalAssets = [];
    const warnings:
      string[] = [];

    for (
      let sceneIndex = 0;
      sceneIndex <
      scenes.length;
      sceneIndex++
    ) {
      const scene =
        scenes[
          sceneIndex
        ];

      let best:
        | {
            image: Buffer;
            prompt: string;
            seed: number;
            audit:
              FidelityAudit | null;
          }
        | null = null;

      let correction =
        "";

      /*
       * Máximo de 2 tentativas por cena
       * para preservar a franquia FREE.
       */
      for (
        let attempt = 0;
        attempt < 2;
        attempt++
      ) {
        const seed =
          Math.floor(
            Date.now() /
              1000
          ) +
          batch *
            10000 +
          sceneIndex *
            1000 +
          attempt *
            137;

        const strictPrompt =
          `${scene.prompt}

PRODUCT REFERENCE LOCK:

input_image_0 is the ONE AND ONLY authoritative physical product.

The generated photograph MUST contain the exact same physical product shown in input_image_0.

DO NOT:
- infer another SKU
- combine variants
- introduce colors not visible in input_image_0
- add product pieces
- remove product pieces
- alter textures
- change the case
- redesign the object

Environment, lighting, camera angle and human context may change.
The PRODUCT may not change.

${correction}`;

        console.log(
          `[Editorial] ${scene.type} tentativa ${attempt + 1}/2`
        );

        const image =
          await generateCloudflareEditorial({
            prompt:
              strictPrompt,

            referenceUrls: [
              referenceUrl,
            ],

            seed,

            guidance: 8,
          });

        let audit:
          FidelityAudit | null =
          null;

        try {
          audit =
            await auditEditorialFidelity({
              referenceUrl,

              generatedImage:
                image,

              sceneType:
                scene.type,
            });

          console.log(
            `[Fidelity] ${scene.type}: ${Math.round(
              audit.score *
                100
            )}% ${
              audit.pass
                ? "PASS"
                : "FAIL"
            }`
          );
        } catch (
          auditError
        ) {
          console.warn(
            `[Fidelity] auditoria indisponível:`,
            auditError instanceof
              Error
              ? auditError.message
              : auditError
          );
        }

        const score =
          audit?.score ??
          0;

        const bestScore =
          best?.audit?.score ??
          -1;

        if (
          !best ||
          score >
            bestScore
        ) {
          best = {
            image,
            prompt:
              strictPrompt,
            seed,
            audit,
          };
        }

        /*
         * Passou: não gastamos outra
         * geração desnecessariamente.
         */
        if (
          audit?.pass
        ) {
          break;
        }

        if (audit) {
          correction = `
MANDATORY CORRECTION FOR THE NEXT ATTEMPT:

${audit.regenerationHint}

AUDIT PROBLEMS:
${audit.issues.join(
  "; "
)}

UNSUPPORTED COLORS:
${audit.unsupportedColors.join(
  ", "
) || "none reported"}

Correct these problems without changing the requested photographic scene.
`;
        }
      }

      if (!best) {
        throw new Error(
          `Falha ao gerar ${scene.type}.`
        );
      }

      if (
        best.audit &&
        !best.audit.pass
      ) {
        warnings.push(
          `${scene.type}: fidelidade ${Math.round(
            best.audit.score *
              100
          )}% — seleção bloqueada.`
        );
      }

      const asset =
        await prisma.editorialAsset.create({
          data: {
            productId:
              product.id,

            storeId:
              store.id,

            assetType:
              scene.type,

            batch,

            sourceImageUrl:
              referenceUrl,

            recipe: {
              mode:
                "single-reference-lock",

              referenceImageId:
                referenceImage.id,

              referenceUrl,
            },

            prompt:
              best.prompt,

            seed:
              best.seed,

            generationProvider:
              "cloudflare-workers-ai",

            generationModel:
              process.env
                .CLOUDFLARE_IMAGE_MODEL ||
              "@cf/black-forest-labs/flux-2-klein-4b",

            fidelityScore:
              best.audit?.score ??
              null,

            audit:
              best.audit
                ? JSON.parse(
                    JSON.stringify(
                      best.audit
                    )
                  )
                : undefined,

            selected:
              false,
          },
        });

      created.push({
        id:
          asset.id,

        generatedPath:
          null,
      });

      const generatedPath =
        await saveEditorialImage(
          asset.id,
          best.image
        );

      created[
        created.length - 1
      ].generatedPath =
        generatedPath;

      const updated =
        await prisma.editorialAsset.update({
          where: {
            id:
              asset.id,
          },

          data: {
            generatedPath,
          },
        });

      finalAssets.push(
        updated
      );
    }

    return NextResponse.json({
      ok: true,
      batch,
      warnings,

      referenceImageId:
        referenceImage.id,

      assets:
        finalAssets.map(
          publicAsset
        ),
    });
  } catch (error) {
    console.error(
      "AI editorial generation failed:",
      error
    );

    for (
      const item of created
    ) {
      await removeEditorialImage(
        item.generatedPath
      );

      try {
        await prisma.editorialAsset.delete({
          where: {
            id:
              item.id,
          },
        });
      } catch {
        //
      }
    }

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Não foi possível gerar as fotografias.",
      },
      {
        status: 500,
      }
    );
  }
}
