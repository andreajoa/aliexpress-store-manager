import type { CopyLanguage } from "./copy-language";

export const STORE_CURRENCIES = [
  "BRL",
  "USD",
  "EUR",
] as const;

export type StoreCurrency =
  (typeof STORE_CURRENCIES)[number];

const CURRENCY_BY_LANGUAGE: Record<
  CopyLanguage,
  StoreCurrency
> = {
  "pt-BR": "BRL",
  en: "USD",
  fr: "EUR",
  de: "EUR",
};

export function storeCurrencyForCopyLanguage(
  language: CopyLanguage
): StoreCurrency {
  return CURRENCY_BY_LANGUAGE[language];
}

export function isStoreCurrency(
  value: unknown
): value is StoreCurrency {
  return (
    typeof value === "string" &&
    STORE_CURRENCIES.includes(
      value as StoreCurrency
    )
  );
}

export function currencyLocale(
  currency: StoreCurrency
) {
  if (currency === "BRL") return "pt-BR";
  if (currency === "EUR") return "de-DE";
  return "en-US";
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function convertMoney(
  value: number,
  rate: number
) {
  if (!Number.isFinite(value)) {
    throw new Error("Valor monetário inválido.");
  }

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Cotação inválida.");
  }

  return roundMoney(value * rate);
}
