import {
  prisma,
} from "@/lib/prisma";

import {
  readEditorialImage,
} from "@/lib/editorial-storage";

export const runtime =
  "nodejs";

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

  const asset =
    await prisma.editorialAsset.findUnique({
      where: {
        id,
      },
    });

  if (
    !asset ||
    !asset.generatedPath
  ) {
    return new Response(
      "Imagem não encontrada.",
      {
        status: 404,
      }
    );
  }

  try {
    const buffer =
      await readEditorialImage(
        asset.generatedPath
      );

    return new Response(
      new Uint8Array(
        buffer
      ),
      {
        headers: {
          "Content-Type":
            "image/png",

          "Cache-Control":
            "private, no-store",
        },
      }
    );
  } catch {
    return new Response(
      "Arquivo da imagem não encontrado.",
      {
        status: 404,
      }
    );
  }
}
