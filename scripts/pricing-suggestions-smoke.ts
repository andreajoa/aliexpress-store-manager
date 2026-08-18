import {
  calculateSaleSuggestion,
  convertSupplierCost,
} from "../src/lib/product-pricing.ts";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const converted = convertSupplierCost({
  cost: 157.06,
  sourceCurrency: "CNY",
  sellingCurrency: "USD",
  rate: 0.1395,
});

assert(
  Math.abs(converted - 21.90987) < 0.000001,
  "deveria converter CNY para USD antes da precificação"
);

const suggestion = calculateSaleSuggestion({
  cost: 157.06,
  sourceCurrency: "CNY",
  sellingCurrency: "USD",
  rate: 0.1395,
  multiplier: 2.5,
  reservePercent: 0,
  ending: "90",
});

assert(
  suggestion.suggestedPrice === 54.9,
  "deveria calcular o preço final em USD com final .90"
);

const sameCurrency = calculateSaleSuggestion({
  cost: 10,
  sourceCurrency: "USD",
  sellingCurrency: "USD",
  multiplier: 2.5,
  reservePercent: 0,
  ending: "99",
});

assert(
  sameCurrency.suggestedPrice === 25.99,
  "deveria calcular sem exigir câmbio quando as moedas são iguais"
);

let blockedMissingRate = false;
try {
  convertSupplierCost({
    cost: 157.06,
    sourceCurrency: "CNY",
    sellingCurrency: "USD",
  });
} catch {
  blockedMissingRate = true;
}

assert(
  blockedMissingRate,
  "não deve precificar em moedas diferentes sem uma cotação válida"
);

console.log("PRICING SUGGESTIONS: PASS");
