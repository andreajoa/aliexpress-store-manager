import {
  NextResponse,
} from "next/server";

import {
  z,
} from "zod";

import {
  prisma,
} from "@/lib/prisma";

export const runtime =
  "nodejs";

const schema =
  z.object({
    selected:
      z.boolean(),
  });

export async function PATCH(
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

  const parsed =
    schema.safeParse(
      await request.json()
    );

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Seleção inválida.",
      },
      {
        status: 400,
      }
    );
  }

  const asset =
    await prisma.editorialAsset.findUnique({
      where: {
        id,
      },
    });

  if (!asset) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Imagem não encontrada.",
      },
      {
        status: 404,
      }
    );
  }

  if (
    parsed.data.selected &&
    asset.assetType.startsWith(
      "AI_"
    )
  ) {
    const audit =
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

    if (
      audit?.pass !==
      true
    ) {
      return NextResponse.json(
        {
          ok: false,

          error:
            "Esta fotografia ainda não passou pela auditoria automática de fidelidade.",
        },
        {
          status: 409,
        }
      );
    }
  }

  const updated =
    await prisma.editorialAsset.update({
      where: {
        id,
      },

      data: {
        selected:
          parsed.data.selected,
      },
    });

  return NextResponse.json({
    ok: true,

    selected:
      updated.selected,
  });
}
