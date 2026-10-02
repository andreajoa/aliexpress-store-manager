import { NextResponse } from "next/server";
import { POST as importAliExpressProduct } from "../route";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Legacy endpoint kept for compatibility with older UI builds.
 * It must never persist Omkar search-summary pricing as supplier cost.
 * Every import is delegated to the full operational AliExpress pipeline,
 * which resolves real SKUs, SKU currency and landed cost (item + freight).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      productId?: string;
      query?: string;
    };

    const productId = String(body.productId || "").trim();
    if (!/^\d{10,}$/.test(productId)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Esta rota legada exige um Product ID do AliExpress. Use a importação normal para garantir SKU, moeda, custo e frete corretos.",
        },
        { status: 400 },
      );
    }

    const delegatedRequest = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `https://www.aliexpress.com/item/${productId}.html`,
      }),
    });

    return importAliExpressProduct(delegatedRequest);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível importar o produto pelo pipeline completo.",
      },
      { status: 502 },
    );
  }
}
