import {
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  scanStoreIntelligence,
} from "@/lib/store-intelligence";

export const runtime =
  "nodejs";

function jsonSafe(
  value: unknown
) {
  return JSON.parse(
    JSON.stringify(
      value
    )
  );
}

export async function POST(
  _request: Request,

  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const { id } =
      await context.params;

    const store =
      await prisma.store.findUnique({
        where: {
          id,
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

    if (
      store.status !==
      "ACTIVE"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Valide a loja antes de analisar sua identidade.",
        },
        {
          status: 409,
        }
      );
    }

    const intelligence =
      await scanStoreIntelligence(
        store.baseUrl
      );

    const updated =
      await prisma.store.update({
        where: {
          id:
            store.id,
        },

        data: {
          brandProfile:
            jsonSafe(
              intelligence.brand
            ),

          categoriesCache:
            jsonSafe(
              intelligence.categories
            ),

          connectorCapabilities:
            jsonSafe(
              intelligence.capabilities
            ),

          connectorVersion:
            intelligence.connectorVersion,

          intelligenceSource:
            intelligence.source,

          lastScannedAt:
            new Date(),
        },
      });

    return NextResponse.json({
      ok: true,

      store: {
        id:
          updated.id,

        name:
          updated.name,

        baseUrl:
          updated.baseUrl,
      },

      intelligence,
    });
  } catch (error) {
    console.error(
      "Store scan failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Não foi possível analisar a loja.",
      },
      {
        status: 500,
      }
    );
  }
}
