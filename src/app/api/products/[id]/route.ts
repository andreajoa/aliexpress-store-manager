import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function DELETE(
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

    const product =
      await prisma.product.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          sourceTitle: true,
          editorialAssets: {
            select: {
              generatedPath: true,
            },
          },
          publications: {
            select: {
              status: true,
              externalUrl: true,
            },
          },
        },
      });

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

    const storageKeys =
      product.editorialAssets
        .map(
          (asset) =>
            asset.generatedPath
        )
        .filter(
          (value): value is string =>
            Boolean(value)
        );

    const publishedReferences =
      product.publications.filter(
        (publication) =>
          publication.status ===
          "PUBLISHED"
      ).length;

    await prisma.$transaction([
      ...(storageKeys.length
        ? [
            prisma.editorialBinary.deleteMany({
              where: {
                storageKey: {
                  in: storageKeys,
                },
              },
            }),
          ]
        : []),
      prisma.product.delete({
        where: {
          id: product.id,
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      deletedProduct: {
        id: product.id,
        title: product.sourceTitle,
      },
      publishedReferences,
      warning:
        publishedReferences > 0
          ? "O produto foi removido do Manager, mas publicações externas já existentes não são apagadas automaticamente da loja."
          : null,
    });
  } catch (error) {
    console.error(
      "Product deletion failed:",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível excluir o produto.",
      },
      {
        status: 500,
      }
    );
  }
}
