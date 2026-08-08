import {
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  generateCloudflareEditorial,
} from "@/lib/cloudflare-image";

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


function auditObject(
  value: unknown
) {
  if (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  ) {
    return value as
      Record<
        string,
        unknown
      >;
  }

  return null;
}


function stringArray(
  value: unknown
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return value.filter(
    (
      item
    ): item is string =>
      typeof item ===
        "string"
  );
}


function isSafetyFlag(
  error: unknown
) {
  const message =
    error instanceof Error
      ? error.message
      : String(
          error
        );

  return (
    message.includes(
      "3030"
    ) ||
    /output has been flagged/i.test(
      message
    )
  );
}


function publicAsset(
  asset: {
    id: string;
    assetType: string;
    batch: number;
    selected: boolean;
    fidelityScore:
      number | null;
    audit: unknown;
  },

  version:
    number
) {
  const audit =
    auditObject(
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

    fidelityScore:
      asset.fidelityScore,

    auditPassed:
      typeof audit?.pass ===
        "boolean"
        ? audit.pass
        : null,

    auditIssues:
      stringArray(
        audit?.issues
      ),

    imageUrl:
      `/api/editorial-assets/${asset.id}/image`,

    version,
  };
}


export async function POST(
  _request: Request,

  context: {
    params:
      Promise<{
        id: string;
      }>;
  }
) {
  const {
    id,
  } =
    await context.params;

  const asset =
    await prisma
      .editorialAsset
      .findUnique({
        where: {
          id,
        },
      });

  if (!asset) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Fotografia editorial não encontrada.",
      },
      {
        status: 404,
      }
    );
  }

  if (
    !asset.assetType
      .startsWith(
        "AI_"
      )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Este asset não é uma fotografia editorial de IA.",
      },
      {
        status: 400,
      }
    );
  }

  if (
    !asset.sourceImageUrl
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "A fotografia não possui imagem-base vinculada.",
      },
      {
        status: 400,
      }
    );
  }

  if (
    !asset.prompt
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "O prompt original desta fotografia não está disponível.",
      },
      {
        status: 400,
      }
    );
  }

  const previousAudit =
    auditObject(
      asset.audit
    );

  const previousIssues =
    stringArray(
      previousAudit
        ?.issues
    );

  const previousHint =
    typeof previousAudit
      ?.regenerationHint ===
      "string"
      ? previousAudit
          .regenerationHint
      : "";

  /*
   * A primeira tentativa já recebe
   * o motivo da reprovação anterior.
   */
  let correction = `
MANDATORY CORRECTION FROM THE PREVIOUS AUDIT:

${previousHint || "Preserve the exact physical product shown in the reference image."}

PREVIOUS FIDELITY PROBLEMS:

${previousIssues.join(
  "; "
) || "No textual issues were recorded."}

IMPORTANT:
Correct the problems above.
Do not redesign the product.
Do not change its material, texture, case, construction, color, quantity or components.
`;

  let best:
    | {
        image:
          Buffer;

        audit:
          FidelityAudit | null;

        prompt:
          string;

        seed:
          number;
      }
    | null =
    null;

  const generationErrors:
    string[] = [];

  /*
   * No máximo duas gerações:
   * tentativa inicial + correção
   * automática caso a auditoria
   * ainda reprove.
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
      attempt *
        977;

    let prompt =
      `${asset.prompt}

INDIVIDUAL REGENERATION:

This is a replacement for ONE previously rejected ecommerce photograph.

The reference image remains the absolute source of truth.

${correction}
`;

    console.log(
      `[Editorial Individual] ${asset.assetType} tentativa ${attempt + 1}/2`
    );

    let image:
      Buffer;

    try {
      image =
        await generateCloudflareEditorial({
          prompt,

          referenceUrls: [
            asset
              .sourceImageUrl,
          ],

          seed,

          guidance:
            8,
        });
    } catch (
      generationError
    ) {
      /*
       * Se a Cloudflare bloquear
       * a combinação por safety,
       * fazemos UMA tentativa
       * neutra sem pessoas.
       */
      if (
        isSafetyFlag(
          generationError
        )
      ) {
        prompt =
          `${asset.prompt}

SAFE COMMERCIAL REGENERATION:

Preserve the exact physical product from input_image_0.

Create a neutral premium ecommerce scene.

No people.
No hands.
No body parts.
No text.
No labels.
No badges.
No logos.
No advertising graphics.

Do not modify:
- product material
- texture
- construction
- colors
- case
- number of pieces
- accessories

${correction}
`;

        try {
          image =
            await generateCloudflareEditorial({
              prompt,

              referenceUrls: [
                asset
                  .sourceImageUrl,
              ],

              seed:
                seed +
                7919,

              guidance:
                7,
            });
        } catch (
          secondError
        ) {
          generationErrors.push(
            secondError instanceof
              Error
              ? secondError
                  .message
              : "Falha na geração."
          );

          continue;
        }
      } else {
        generationErrors.push(
          generationError instanceof
            Error
            ? generationError
                .message
            : "Falha na geração."
        );

        continue;
      }
    }

    let audit:
      FidelityAudit | null =
      null;

    try {
      audit =
        await auditEditorialFidelity({
          referenceUrl:
            asset
              .sourceImageUrl,

          generatedImage:
            image,

          sceneType:
            asset
              .assetType,
        });

      console.log(
        `[Editorial Individual] ${asset.assetType}: fidelidade ${Math.round(
          audit.score *
            100
        )}% / comercial ${Math.round(
          audit.commercialScore *
            100
        )}% / ${
          audit.pass
            ? "PASS"
            : "FAIL"
        }`
      );
    } catch (
      auditError
    ) {
      console.warn(
        "[Editorial Individual] auditoria indisponível:",
        auditError instanceof
          Error
          ? auditError.message
          : auditError
      );
    }

    /*
     * Nunca preferimos uma imagem
     * não auditada a uma auditada.
     */
    const candidateScore =
      audit
        ? audit.score
        : -1;

    const bestScore =
      best?.audit
        ? best.audit
            .score
        : -2;

    if (
      !best ||
      candidateScore >
        bestScore
    ) {
      best = {
        image,
        audit,
        prompt,
        seed,
      };
    }

    if (
      audit?.pass
    ) {
      break;
    }

    if (audit) {
      correction = `
MANDATORY CORRECTION AFTER THE NEW AUDIT:

${audit.regenerationHint}

FIDELITY PROBLEMS:
${audit.issues.join(
  "; "
) || "none reported"}

COMMERCIAL PROBLEMS:
${audit.commercialIssues.join(
  "; "
) || "none reported"}

UNSUPPORTED PRODUCT COLORS:
${audit.unsupportedColors.join(
  ", "
) || "none reported"}

The next photograph must correct those exact problems while preserving the intended scene type.
`;
    }
  }

  if (!best) {
    return NextResponse.json(
      {
        ok: false,

        error:
          generationErrors[
            generationErrors
              .length - 1
          ] ||
          "Não foi possível regenerar esta fotografia.",
      },
      {
        status: 500,
      }
    );
  }

  /*
   * Não apagamos a fotografia antiga
   * antes de a nova estar gravada.
   *
   * Primeiro salvamos em um arquivo
   * novo, depois apontamos o banco
   * para ele e só então removemos
   * o arquivo antigo.
   */
  const storageId =
    `${asset.id}-regen-${Date.now()}`;

  let newPath:
    string | null =
    null;

  try {
    newPath =
      await saveEditorialImage(
        storageId,
        best.image
      );

    const updated =
      await prisma
        .editorialAsset
        .update({
          where: {
            id:
              asset.id,
          },

          data: {
            generatedPath:
              newPath,

            prompt:
              best.prompt,

            seed:
              best.seed,

            fidelityScore:
              best.audit
                ?.score ??
              null,

            audit:
              best.audit
                ? JSON.parse(
                    JSON.stringify(
                      best.audit
                    )
                  )
                : undefined,

            generationProvider:
              "cloudflare-workers-ai",

            generationModel:
              process.env
                .CLOUDFLARE_IMAGE_MODEL ||
              "@cf/black-forest-labs/flux-2-klein-4b",

            /*
             * Uma regeneração nunca
             * herda seleção anterior.
             */
            selected:
              false,
          },
        });

    if (
      asset.generatedPath &&
      asset.generatedPath !==
        newPath
    ) {
      await removeEditorialImage(
        asset.generatedPath
      );
    }

    const version =
      Date.now();

    return NextResponse.json({
      ok: true,

      asset:
        publicAsset(
          updated,
          version
        ),

      audit:
        best.audit,

      passed:
        best.audit
          ?.pass ??
        false,

      warning:
        !best.audit
          ? "A nova fotografia foi gerada, mas a auditoria automática não foi concluída."
          : best.audit.pass
            ? null
            : "A nova fotografia ainda não atingiu os critérios de fidelidade e permanece bloqueada.",
    });
  } catch (error) {
    if (newPath) {
      await removeEditorialImage(
        newPath
      );
    }

    console.error(
      "Individual editorial regeneration failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof
            Error
            ? error.message
            : "Falha ao salvar a fotografia regenerada.",
      },
      {
        status: 500,
      }
    );
  }
}
