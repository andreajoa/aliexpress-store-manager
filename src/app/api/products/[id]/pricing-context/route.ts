import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id } = await context.params;
    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        storeCurrency: true,
      },
    });

    if (!product) {
      return NextResponse.json({
        ok: false,
        error: "Produto não encontrado.",
      }, {
        status: 404,
      });
    }

    return NextResponse.json({
      ok: true,
      storeCurrency:
        product.storeCurrency,
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível carregar a moeda do produto.",
    }, {
      status: 500,
    });
  }
}
