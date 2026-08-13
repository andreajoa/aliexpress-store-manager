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
  scanStoreIntelligence,
  type StoreBrandProfile,
  type StoreCategory,
} from "@/lib/store-intelligence";

import {
  suggestCategory,
} from "@/lib/category-intelligence";

export const runtime =
  "nodejs";

const inputSchema =
  z.object({
    storeId:
      z.string()
        .min(1),

    forceRefresh:
      z.boolean()
        .optional()
        .default(false),
  });

function jsonSafe(
  value: unknown
) {
  return JSON.parse(
    JSON.stringify(
      value
    )
  );
}

function cachedCategories(
  value: unknown
): StoreCategory[] {
  if (
    !Array.isArray(value)
  ) {
    return [];
  }

  return value.filter(
    (
      item
    ): item is StoreCategory =>
      Boolean(
        item &&
        typeof item ===
          "object" &&
        typeof (
          item as StoreCategory
        ).id ===
          "string" &&
        typeof (
          item as StoreCategory
        ).name ===
          "string"
      )
  );
}

function cachedBrand(
  value: unknown
): StoreBrandProfile | null {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as
    StoreBrandProfile;
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
            "Loja inválida.",
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
      store.status !==
      "ACTIVE"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "A loja não está conectada.",
        },
        {
          status: 409,
        }
      );
    }

    const cached =
      cachedCategories(
        store.categoriesCache
      );

    const ageMs =
      store.lastScannedAt
        ? Date.now() -
          store.lastScannedAt.getTime()
        : Infinity;

    const stale =
      ageMs >
      12 *
        60 *
        60 *
        1000;

    let categories =
      cached;

    let brand =
      cachedBrand(
        store.brandProfile
      );

    let niche:
      string | null =
      null;

    let source =
      store.intelligenceSource ||
      null;

    if (
      parsed.data
        .forceRefresh ||
      stale ||
      categories.length ===
        0 ||
      !brand
    ) {
      const intelligence =
        await scanStoreIntelligence(
          store.baseUrl
        );

      categories =
        intelligence.categories;

      brand =
        intelligence.brand;

      niche =
        intelligence.niche;

      source =
        intelligence.source;

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
    }

    if (
      categories.length ===
      0
    ) {
      return NextResponse.json(
        {
          ok: false,

          error:
            "O Store Connector ainda não informou as categorias desta loja.",
        },
        {
          status: 422,
        }
      );
    }

    const suggestion =
      await suggestCategory({
        categories,

        niche,

        product: {
          sourceTitle:
            product.sourceTitle,

          optimizedTitle:
            product.optimizedTitle,

          headline:
            product.headline,

          description:
            product.shortDescription,

          benefits:
            product.benefits,

          specifications:
            product.specifications,

          variants:
            product.variants.map(
              variant => ({
                attributes:
                  variant.attributes,
              })
            ),
        },
      });

    return NextResponse.json({
      ok: true,

      store: {
        id:
          store.id,

        name:
          store.name,

        baseUrl:
          store.baseUrl,
      },

      intelligence: {
        source,
        brand,
        categories,
      },

      suggestion,
    });
  } catch (error) {
    console.error(
      "Category suggestion failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Não foi possível sugerir a categoria.",
      },
      {
        status: 500,
      }
    );
  }
}
