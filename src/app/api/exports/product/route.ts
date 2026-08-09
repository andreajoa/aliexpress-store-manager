import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAmbProductExport } from "@/lib/amb-export-lineage";
import { prisma } from "@/lib/prisma";
import { buildProductWebExport } from "@/lib/web-export-package";
import {
  attachmentHeaders,
  safeExportName,
} from "@/lib/web-export-utils";
import { buildZipArchive } from "@/lib/zip-archive";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  productId: z.string().min(1),
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
        error: "Produto ou loja inválidos.",
      }, {
        status: 400,
      });
    }

    const [product, store, publication] =
      await Promise.all([
        prisma.product.findUnique({
          where: {
            id: parsed.data.productId,
          },
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
        }),
        prisma.store.findUnique({
          where: {
            id: parsed.data.storeId,
          },
        }),
        prisma.publication.findUnique({
          where: {
            storeId_productId: {
              storeId: parsed.data.storeId,
              productId: parsed.data.productId,
            },
          },
        }),
      ]);

    if (!product) {
      return NextResponse.json({
        ok: false,
        error: "Produto não encontrado.",
      }, {
        status: 404,
      });
    }

    if (!store) {
      return NextResponse.json({
        ok: false,
        error: "Loja não encontrada.",
      }, {
        status: 404,
      });
    }

    const exported = await buildProductWebExport({
      product,
      store,
      publication,
    });
    const zip = buildZipArchive(exported.entries);

    if (store.id === "amb-boutique-store") {
      await recordAmbProductExport({
        storeId: store.id,
        productId: product.id,
        sourceProductId: product.sourceProductId,
        sourceUrl: product.sourceUrl,
        variants: product.variants,
      });
    }

    const filename =
      `${safeExportName(store.name)}-${safeExportName(
        product.optimizedTitle || product.sourceTitle
      )}.zip`;

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
      "Product web export failed:",
      error
    );

    return NextResponse.json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível exportar.",
    }, {
      status: 500,
    });
  }
}
