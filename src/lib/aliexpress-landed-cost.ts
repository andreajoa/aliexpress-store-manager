import type { FreightQuote } from "./aliexpress-top-client";

export type CurrencyRate = {
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
};

export type NormalizedFreightQuote = FreightQuote & {
  amountInTargetCurrency: number;
  targetCurrency: string;
};

function normalizeCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`Moeda inválida: ${value}`);
  }
  return currency;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function convertCostAmount({
  amount,
  sourceCurrency,
  targetCurrency,
  rate,
}: {
  amount: number;
  sourceCurrency: string;
  targetCurrency: string;
  rate?: number | null;
}) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Valor de custo inválido.");
  }

  const source = normalizeCurrency(sourceCurrency);
  const target = normalizeCurrency(targetCurrency);

  if (source === target) return roundMoney(amount);

  if (!Number.isFinite(rate) || Number(rate) <= 0) {
    throw new Error(`Cotação ${source}/${target} indisponível.`);
  }

  return roundMoney(amount * Number(rate));
}

export function selectCheapestFreightQuote({
  quotes,
  targetCurrency,
  rateForCurrency,
}: {
  quotes: FreightQuote[];
  targetCurrency: string;
  rateForCurrency: (currency: string) => number | null;
}): NormalizedFreightQuote {
  const target = normalizeCurrency(targetCurrency);
  const normalized = quotes.flatMap<NormalizedFreightQuote>((quote) => {
    if (
      quote.amount === null ||
      !Number.isFinite(quote.amount) ||
      quote.amount < 0 ||
      !quote.serviceName.trim()
    ) {
      return [];
    }

    // Frete zero é válido mesmo quando a API omite a moeda.
    const currency = quote.currency?.trim().toUpperCase() ||
      (quote.amount === 0 ? target : "");
    if (!currency) return [];

    const amountInTargetCurrency = convertCostAmount({
      amount: quote.amount,
      sourceCurrency: currency,
      targetCurrency: target,
      rate: currency === target ? 1 : rateForCurrency(currency),
    });

    return [{
      ...quote,
      currency,
      amountInTargetCurrency,
      targetCurrency: target,
    }];
  });

  if (normalized.length === 0) {
    throw new Error(
      "AliExpress não retornou nenhum frete com valor monetário utilizável.",
    );
  }

  return normalized.reduce((best, quote) =>
    quote.amountInTargetCurrency < best.amountInTargetCurrency
      ? quote
      : best,
  );
}

export function calculateLandedUnitCost({
  itemPrice,
  itemCurrency,
  targetCurrency,
  itemRate,
  freightAmountInTargetCurrency,
}: {
  itemPrice: number;
  itemCurrency: string;
  targetCurrency: string;
  itemRate?: number | null;
  freightAmountInTargetCurrency: number;
}) {
  const itemCostInTargetCurrency = convertCostAmount({
    amount: itemPrice,
    sourceCurrency: itemCurrency,
    targetCurrency,
    rate: itemCurrency.trim().toUpperCase() === targetCurrency.trim().toUpperCase()
      ? 1
      : itemRate,
  });

  if (
    !Number.isFinite(freightAmountInTargetCurrency) ||
    freightAmountInTargetCurrency < 0
  ) {
    throw new Error("Frete normalizado inválido.");
  }

  return {
    itemCostInTargetCurrency,
    freightCostInTargetCurrency:
      roundMoney(freightAmountInTargetCurrency),
    landedCost:
      roundMoney(itemCostInTargetCurrency + freightAmountInTargetCurrency),
    currency: normalizeCurrency(targetCurrency),
  };
}
