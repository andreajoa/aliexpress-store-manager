export type PriceEnding = "90" | "99" | "none";

export function applyPriceEnding(
  value: number,
  ending: PriceEnding
) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Valor base de preço inválido.");
  }

  if (ending === "none") {
    return Math.round(value * 100) / 100;
  }

  const cents = ending === "90"
    ? 0.9
    : 0.99;
  const integer = Math.floor(value);
  let candidate = integer + cents;

  if (candidate < value) {
    candidate = integer + 1 + cents;
  }

  return Math.round(candidate * 100) / 100;
}

export function convertSupplierCost({
  cost,
  sourceCurrency,
  sellingCurrency,
  rate,
}: {
  cost: number;
  sourceCurrency: string;
  sellingCurrency: string;
  rate?: number | null;
}) {
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error("Custo do fornecedor inválido.");
  }

  const source = sourceCurrency
    .trim()
    .toUpperCase();
  const target = sellingCurrency
    .trim()
    .toUpperCase();

  if (!source || !target) {
    throw new Error("Moeda do produto inválida.");
  }

  if (source === target) {
    return cost;
  }

  if (!Number.isFinite(rate) || Number(rate) <= 0) {
    throw new Error(
      `Cotação ${source}/${target} indisponível.`
    );
  }

  return cost * Number(rate);
}

export function calculateSaleSuggestion({
  cost,
  sourceCurrency,
  sellingCurrency,
  rate,
  multiplier,
  reservePercent,
  ending,
}: {
  cost: number;
  sourceCurrency: string;
  sellingCurrency: string;
  rate?: number | null;
  multiplier: number;
  reservePercent: number;
  ending: PriceEnding;
}) {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error("Multiplicador inválido.");
  }

  if (
    !Number.isFinite(reservePercent) ||
    reservePercent < 0
  ) {
    throw new Error("Reserva percentual inválida.");
  }

  const convertedCost = convertSupplierCost({
    cost,
    sourceCurrency,
    sellingCurrency,
    rate,
  });

  const raw =
    convertedCost *
    multiplier *
    (1 + reservePercent / 100);

  return {
    convertedCost,
    suggestedPrice:
      applyPriceEnding(raw, ending),
  };
}
