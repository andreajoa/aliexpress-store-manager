import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { buildProductWebExport } from "@/lib/web-export-package";
import {
  attachmentHeaders,
  csvFromExportRows,
  safeExportName,
} from "@/lib/web-export-utils";
import { buildZipArchive } from "@/lib/zip-archive";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  storeId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(
      await request.json()
    );

    if (!parsed.success) {
      return NextResponse.json({
        ok: false,
        error: "Loja inválida.",
      }, {
        status: 400,
      });
    }

    const store = await prisma.store.findUnique({
      where: {
        id: parsed.data.storeId,
      },
    });

    if (!store) {
      return NextResponse.json({
        ok: false,
        error: "Loja não encontrada.",
      }, {
        status: 404,
      });
    }

    const publications =
      await prisma.publication.findMany({
        where: {
          storeId: store.id,
        },
        include: {
          product: {
            include: {
              images: {
                orderBy: {
                  sortOrder: "asc",
                },
              },
              variants: {
                orderBy: {
                  createdAt: "asc",
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      });

    const storeRoot = safeExportName(store.name);
    const entries = [] as Array<{
      name: string;
      data: Uint8Array | string;
    }>;
    const catalogRows: Record<string, unknown>[] = [];
    const errors: string[] = [];

    for (const publication of publications) {
      const product = publication.product;
      const prefix =
        `${storeRoot}/produtos/${safeExportName(
          product.optimizedTitle || product.sourceTitle
        )}`;

      const exported = await buildProductWebExport({
        product,
        store,
        publication,
        prefix,
      });

      entries.push(...exported.entries);
      errors.push(
        ...exported.errors.map(
          (error) =>
            `${product.sourceProductId}: ${error}`
        )
      );

      if (exported.variants.length === 0) {
        catalogRows.push(exported.summary);
      } else {
        for (const variant of exported.variants) {
          catalogRows.push({
            ...exported.summary,
            ...variant,
          });
        }
      }
    }

    entries.push({
      name: `${storeRoot}/catalogo.csv`,
      data: csvFromExportRows(catalogRows),
    });
    entries.push({
      name: `${storeRoot}/export-report.json`,
      data: JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          products: publications.length,
          rows: catalogRows.length,
          errors,
        },
        null,
        2
      ),
    });

    const zip = buildZipArchive(entries);
    const filename = `${storeRoot}-catalogo.zip`;

    return new Response(
      Uint8Array.from(zip).buffer,
      {
        status: 200,
        headers: {
          ...attachmentHeaders(filename),
          "Content-Length": String(zip.length),
        },
      }
    );
  } catch (error) {
    console.error(
      "Store web export failed:",
      error
    );

    return NextResponse.json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível exportar a loja.",
    }, {
      status: 500,
    });
  }
}
