import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=BRL",
      {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Serviço de câmbio respondeu HTTP ${response.status}.`
      );
    }

    const data = await response.json();

    const rate = Number(data?.rates?.BRL);

    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Cotação USD/BRL inválida.");
    }

    return NextResponse.json({
      ok: true,
      rate,
      date: data?.date || null,
      base: "USD",
      quote: "BRL",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar a cotação.",
      },
      { status: 502 }
    );
  }
}
