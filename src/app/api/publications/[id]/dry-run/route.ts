import fs from "node:fs/promises";

import {
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  buildPublicationPlan,
} from "@/lib/publication-plan";

export const runtime =
  "nodejs";

function auditPassed(
  value: unknown
) {
  return Boolean(
    value &&
      typeof value ===
        "object" &&
      !Array.isArray(
        value
      ) &&
      (
        value as Record<
          string,
          unknown
        >
      ).pass === true
  );
}

export async function GET(
  _request: Request,

  context: {
    params:
      Promise<{
        id: string;
      }>;
  }
) {
  const { id } =
    await context.params;

  const publication =
    await prisma
      .publication
      .findUnique({
        where: {
          id,
        },

        include: {
          store:
            true,
        },
      });

  if (!publication) {
    return NextResponse.json(
      {
        ok: false,

        error:
          "Publication não encontrada.",
      },
      {
        status: 404,
      }
    );
  }

  const selectedEditorials =
    await prisma
      .editorialAsset
      .findMany({
        where: {
          productId:
            publication
              .productId,

          storeId:
            publication
              .storeId,

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

  const editorials =
    await Promise.all(
      selectedEditorials.map(
        async asset => {
          let fileExists =
            false;

          if (
            asset
              .generatedPath
          ) {
            try {
              const stat =
                await fs.stat(
                  asset
                    .generatedPath
                );

              fileExists =
                stat.isFile();
            } catch {
              fileExists =
                false;
            }
          }

          return {
            id:
              asset.id,

            type:
              asset.assetType,

            generatedPath:
              asset
                .generatedPath,

            auditPassed:
              auditPassed(
                asset.audit
              ),

            fileExists,
          };
        }
      )
    );

  const plan =
    buildPublicationPlan({
      store: {
        id:
          publication
            .store.id,

        name:
          publication
            .store.name,

        baseUrl:
          publication
            .store.baseUrl,

        connectionType:
          publication
            .store
            .connectionType,

        apiEndpoint:
          publication
            .store
            .apiEndpoint,

        githubOwner:
          publication
            .store
            .githubOwner,

        githubRepo:
          publication
            .store
            .githubRepo,

        githubBranch:
          publication
            .store
            .githubBranch,

        status:
          publication
            .store.status,

        connectorVersion:
          publication
            .store
            .connectorVersion,

        connectorCapabilities:
          publication
            .store
            .connectorCapabilities,
      },

      publication: {
        id:
          publication.id,

        status:
          publication.status,

        externalProductId:
          publication
            .externalProductId,

        externalSlug:
          publication
            .externalSlug,

        externalUrl:
          publication
            .externalUrl,

        targetCategory:
          publication
            .targetCategory,

        targetAgeRange:
          publication
            .targetAgeRange,

        targetAgeSource:
          publication
            .targetAgeSource,

        targetAgeEvidence:
          publication
            .targetAgeEvidence,

        targetAgeVerifiedAt:
          publication
            .targetAgeVerifiedAt
            ?.toISOString() ||
          null,

        payload:
          publication.payload,
      },

      editorials,
    });

  return NextResponse.json({
    ok: true,

    plan,
  });
}
