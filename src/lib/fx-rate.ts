export type FxQuote = {
  rate: number;
  date: string | null;
  base: string;
  quote: string;
};

function normalizeCurrency(value: string) {
  const currency = value.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`Moeda inválida: ${value}`);
  }

  return currency;
}

export async function fetchFxRate({
  from,
  to,
  fetchImpl = fetch,
}: {
  from: string;
  to: string;
  fetchImpl?: typeof fetch;
}): Promise<FxQuote> {
  const base = normalizeCurrency(from);
  const quote = normalizeCurrency(to);

  if (base === quote) {
    return {
      rate: 1,
      date: null,
      base,
      quote,
    };
  }

  const url = new URL(
    "https://api.frankfurter.app/latest"
  );
  url.searchParams.set("from", base);
  url.searchParams.set("to", quote);

  const response = await fetchImpl(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Serviço de câmbio respondeu HTTP ${response.status}.`
    );
  }

  const data = await response.json() as {
    date?: unknown;
    rates?: Record<string, unknown>;
  };

  const rate = Number(data?.rates?.[quote]);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(
      `Cotação ${base}/${quote} inválida.`
    );
  }

  return {
    rate,
    date:
      typeof data.date === "string"
        ? data.date
        : null,
    base,
    quote,
  };
}
