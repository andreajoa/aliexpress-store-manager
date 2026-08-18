import { NextResponse } from "next/server";

import { fetchFxRate } from "@/lib/fx-rate";
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
        variants: {
          select: {
            sourceCurrency: true,
          },
        },
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

    const storeCurrency =
      product.storeCurrency.trim().toUpperCase();
    const sourceCurrencies = Array.from(
      new Set(
        product.variants
          .map((variant) =>
            variant.sourceCurrency
              ?.trim()
              .toUpperCase()
          )
          .filter(
            (currency): currency is string =>
              Boolean(currency)
          )
      )
    );

    const quotes = await Promise.all(
      sourceCurrencies.map(async (sourceCurrency) => {
        if (sourceCurrency === storeCurrency) {
          return {
            sourceCurrency,
            rate: 1,
            date: null as string | null,
          };
        }

        const quote = await fetchFxRate({
          from: sourceCurrency,
          to: storeCurrency,
        });

        return {
          sourceCurrency,
          rate: quote.rate,
          date: quote.date,
        };
      })
    );

    return NextResponse.json({
      ok: true,
      storeCurrency,
      rates: Object.fromEntries(
        quotes.map((quote) => [
          quote.sourceCurrency,
          {
            rate: quote.rate,
            date: quote.date,
          },
        ])
      ),
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
          : "Não foi possível carregar as cotações de precificação.",
    }, {
      status: 502,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}
