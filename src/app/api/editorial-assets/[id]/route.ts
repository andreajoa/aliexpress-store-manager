import fs from "node:fs/promises";

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

function auditPassed(
  value: unknown
): boolean {
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

  /*
   * Selecionar também é fail-closed.
   * Desmarcar permanece sempre permitido.
   */
  if (
    parsed.data.selected
  ) {
    if (
      !auditPassed(
        asset.audit
      )
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

    const generatedPath =
      asset.generatedPath;

    if (!generatedPath) {
      return NextResponse.json(
        {
          ok: false,

          error:
            "A fotografia aprovada não possui arquivo gerado disponível.",
        },
        {
          status: 409,
        }
      );
    }

    try {
      const stat =
        await fs.stat(
          generatedPath
        );

      if (!stat.isFile()) {
        return NextResponse.json(
          {
            ok: false,

            error:
              "O arquivo da fotografia selecionada não é válido.",
          },
          {
            status: 409,
          }
        );
      }
    } catch {
      return NextResponse.json(
        {
          ok: false,

          error:
            "O arquivo da fotografia selecionada não existe mais no armazenamento local.",
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
