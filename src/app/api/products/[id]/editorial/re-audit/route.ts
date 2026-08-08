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
  auditEditorialFidelity,
} from "@/lib/editorial-fidelity-audit";

import {
  readEditorialImage,
} from "@/lib/editorial-storage";

export const runtime =
  "nodejs";

export const maxDuration =
  300;

const schema =
  z.object({
    storeId:
      z.string()
        .min(1),
  });

export async function POST(
  request: Request,

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

    const parsed =
      schema.safeParse(
        await request.json()
      );

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "storeId inválido.",
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

          storeId:
            parsed.data.storeId,

          assetType: {
            startsWith: "AI_",
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
      return NextResponse.json(
        {
          ok: false,

          error:
            "Nenhum lote editorial encontrado.",
        },
        {
          status: 404,
        }
      );
    }

    const assets =
      await prisma.editorialAsset.findMany({
        where: {
          productId: id,

          storeId:
            parsed.data.storeId,

          batch:
            latest.batch,

          assetType: {
            startsWith: "AI_",
          },

          generatedPath: {
            not: null,
          },
        },

        orderBy: {
          createdAt: "asc",
        },
      });

    const results = [];

    for (const asset of assets) {
      if (!asset.generatedPath) {
        continue;
      }

      /*
       * Não gastar outra chamada de IA
       * numa fotografia que já:
       *
       * - passou;
       * - não possui problema físico.
       *
       * Imagem aprovada MAS com issues
       * será reavaliada pelo gate novo.
       */
      const existingAudit =
        asset.audit &&
        typeof asset.audit ===
          "object" &&
        !Array.isArray(
          asset.audit
        )
          ? asset.audit as
              Record<
                string,
                unknown
              >
          : null;

      const existingIssues =
        existingAudit &&
        Array.isArray(
          existingAudit.issues
        )
          ? existingAudit.issues.filter(
              (
                item
              ): item is string =>
                typeof item ===
                  "string"
            )
          : [];

      const alreadyClean =
        existingAudit?.pass ===
          true &&
        existingIssues.length ===
          0;

      if (alreadyClean) {
        results.push({
          id:
            asset.id,

          type:
            asset.assetType,

          fidelity:
            asset.fidelityScore,

          commercial:
            typeof existingAudit
              ?.commercialScore ===
              "number"
              ? existingAudit
                  .commercialScore
              : null,

          pass:
            true,

          skipped:
            true,

          issues: [],
        });

        console.log(
          `[ReAudit] ${asset.assetType}: já aprovada e limpa — SKIP`
        );

        continue;
      }

      try {
        const image =
          await readEditorialImage(
            asset.generatedPath
          );

        const audit =
          await auditEditorialFidelity({
            referenceUrl:
              asset.sourceImageUrl,

            generatedImage:
              image,

            sceneType:
              asset.assetType,
          });

        const updated =
          await prisma.editorialAsset.update({
            where: {
              id: asset.id,
            },

            data: {
              fidelityScore:
                audit.score,

              audit:
                JSON.parse(
                  JSON.stringify(
                    audit
                  )
                ),

              /*
               * Se já estava selecionada
               * e reprovou, sai da seleção.
               */
              selected:
                audit.pass
                  ? asset.selected
                  : false,
            },
          });

        console.log(
          `[ReAudit] ${asset.assetType}: ` +
          `fidelidade ${Math.round(
            audit.score * 100
          )}% / ` +
          `comercial ${Math.round(
            audit.commercialScore * 100
          )}% / ` +
          `${audit.pass ? "PASS" : "FAIL"}`
        );

        results.push({
          id:
            updated.id,

          type:
            updated.assetType,

          fidelity:
            audit.score,

          commercial:
            audit.commercialScore,

          pass:
            audit.pass,

          issues: [
            ...audit.issues,
            ...audit.commercialIssues,
          ],
        });
      } catch (error) {
        console.error(
          `[ReAudit] ${asset.assetType} falhou:`,
          error
        );

        results.push({
          id:
            asset.id,

          type:
            asset.assetType,

          pass:
            null,

          error:
            error instanceof Error
              ? error.message
              : "Erro de auditoria",
        });
      }
    }

    return NextResponse.json({
      ok: true,

      batch:
        latest.batch,

      results,
    });
  } catch (error) {
    console.error(
      "Re-audit failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Falha na auditoria.",
      },
      {
        status: 500,
      }
    );
  }
}
