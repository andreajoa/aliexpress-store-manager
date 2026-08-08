import {
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

export const runtime =
  "nodejs";

export async function GET(
  request: Request,

  context: {
    params:
      Promise<{
        id: string;
      }>;
  }
) {
  const { id: productId } =
    await context.params;

  const url =
    new URL(
      request.url
    );

  const storeId =
    url.searchParams
      .get(
        "storeId"
      )
      ?.trim();

  if (!storeId) {
    return NextResponse.json(
      {
        ok: false,

        error:
          "storeId é obrigatório.",
      },
      {
        status: 400,
      }
    );
  }

  const publication =
    await prisma
      .publication
      .findUnique({
        where: {
          storeId_productId: {
            storeId,
            productId,
          },
        },

        select: {
          id:
            true,

          status:
            true,

          updatedAt:
            true,
        },
      });

  return NextResponse.json({
    ok: true,

    publication: publication
      ? {
          id:
            publication.id,

          status:
            publication.status,

          updatedAt:
            publication
              .updatedAt
              .toISOString(),
        }
      : null,
  });
}
