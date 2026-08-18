import { requireAliExpressSession } from "./aliexpress-connection";
import {
  calculateLandedUnitCost,
  convertCostAmount,
  selectCheapestFreightQuote,
} from "./aliexpress-landed-cost";
import { fetchFxRate } from "./fx-rate";
import type { OmkarSkuPricing } from "./omkar";

function normalizeCostCountry(value: string | undefined) {
  const normalized = (value || "US").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new Error(`País-base de custo inválido: ${value || ""}.`);
  }
  return normalized === "GB" ? "UK" : normalized;
}

function normalizeCostCurrency(value: string | undefined) {
  const normalized = (value || "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(`Moeda-base de custo inválida: ${value || ""}.`);
  }
  return normalized;
}

function compactError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function rateToTarget(sourceCurrency: string, targetCurrency: string) {
  const source = sourceCurrency.trim().toUpperCase();
  const target = targetCurrency.trim().toUpperCase();
  if (source === target) return 1;
  const quote = await fetchFxRate({ from: source, to: target });
  return quote.rate;
}

export type AliExpressImportSkuCost = {
  sku: OmkarSkuPricing;
  itemPrice: number;
  itemCurrency: string;
  itemCostInCostCurrency: number | null;
  freightCostInCostCurrency: number | null;
  landedCost: number | null;
  costCurrency: string;
};

type CostSnapshotQuote = {
  serviceName: string;
  estimatedDeliveryTime: string | null;
  amount: number;
  currency: string;
  amountInCostCurrency: number;
};

export type AliExpressImportCosting = {
  complete: boolean;
  costedSkus: AliExpressImportSkuCost[];
  costMin: number | null;
  costMax: number | null;
  costCurrency: string;
  warning: string | null;
  snapshot: {
    status: "COMPLETE" | "PENDING_FREIGHT";
    basis: "ITEM_PLUS_FREIGHT" | "ITEM_PRICE_ONLY_PENDING_FREIGHT";
    scope: "ONE_UNIT_COUNTRY_BASELINE";
    includes: string[];
    countryCode: string;
    sendGoodsCountryCode: string | null;
    quantity: number;
    itemCurrency: string;
    costCurrency: string;
    itemFxRateToCostCurrency: number | null;
    freight: {
      status: "AVAILABLE" | "PENDING";
      selectedServiceName: string | null;
      estimatedDeliveryTime: string | null;
      originalAmount: number | null;
      originalCurrency: string | null;
      amountInCostCurrency: number | null;
      costCurrency: string;
      quoteCount: number;
      quotes: CostSnapshotQuote[];
      error: string | null;
    };
    calculatedAt: string;
  };
};

function validateSkuPrices(skuPricing: OmkarSkuPricing[]) {
  const itemPrices = skuPricing.map((sku) => sku.sale_price);
  if (
    itemPrices.length === 0 ||
    itemPrices.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0,
    )
  ) {
    throw new Error(
      "Não foi possível importar porque há SKU sem preço original válido.",
    );
  }
  return itemPrices as number[];
}

function pendingCosting(input: {
  skuPricing: OmkarSkuPricing[];
  itemCurrency: string;
  countryCode: string;
  sendGoodsCountryCode: string;
  error: string;
}): AliExpressImportCosting {
  const calculatedAt = new Date().toISOString();
  const costedSkus: AliExpressImportSkuCost[] = input.skuPricing.map((sku) => ({
    sku,
    itemPrice: Number(sku.sale_price),
    itemCurrency: input.itemCurrency,
    itemCostInCostCurrency: null,
    freightCostInCostCurrency: null,
    landedCost: null,
    costCurrency: input.itemCurrency,
  }));

  return {
    complete: false,
    costedSkus,
    costMin: null,
    costMax: null,
    costCurrency: input.itemCurrency,
    warning:
      "Produto importado, mas o frete do fornecedor ainda não pôde ser calculado. O preço final permanece bloqueado até o custo total ser conhecido.",
    snapshot: {
      status: "PENDING_FREIGHT",
      basis: "ITEM_PRICE_ONLY_PENDING_FREIGHT",
      scope: "ONE_UNIT_COUNTRY_BASELINE",
      includes: ["ITEM_PRICE"],
      countryCode: input.countryCode,
      sendGoodsCountryCode: input.sendGoodsCountryCode,
      quantity: 1,
      itemCurrency: input.itemCurrency,
      costCurrency: input.itemCurrency,
      itemFxRateToCostCurrency: null,
      freight: {
        status: "PENDING",
        selectedServiceName: null,
        estimatedDeliveryTime: null,
        originalAmount: null,
        originalCurrency: null,
        amountInCostCurrency: null,
        costCurrency: input.itemCurrency,
        quoteCount: 0,
        quotes: [],
        error: input.error,
      },
      calculatedAt,
    },
  };
}

export async function buildAliExpressImportCosting(input: {
  productId: string;
  skuPricing: OmkarSkuPricing[];
  itemCurrency: string;
}): Promise<AliExpressImportCosting> {
  const itemPrices = validateSkuPrices(input.skuPricing);
  const countryCode = normalizeCostCountry(process.env.ALIEXPRESS_COST_COUNTRY);
  const costCurrency = normalizeCostCurrency(process.env.ALIEXPRESS_COST_CURRENCY);
  const sendGoodsCountryCode = normalizeCostCountry(
    process.env.ALIEXPRESS_SEND_GOODS_COUNTRY || "CN",
  );
  const itemCurrency = input.itemCurrency.trim().toUpperCase();
  const itemPriceMin = Math.min(...itemPrices);

  let freightQuotes;
  try {
    const { session, client } = await requireAliExpressSession();
    freightQuotes = await client.calculateFreight({
      session,
      productId: input.productId,
      quantity: 1,
      countryCode,
      sendGoodsCountryCode,
      price: String(itemPriceMin),
      priceCurrency: itemCurrency,
    });
    if (freightQuotes.length === 0) {
      throw new Error(`AliExpress não retornou frete oficial para ${countryCode}.`);
    }
  } catch (error) {
    return pendingCosting({
      skuPricing: input.skuPricing,
      itemCurrency,
      countryCode,
      sendGoodsCountryCode,
      error: compactError(error),
    });
  }

  try {
    const currenciesNeedingRate = Array.from(
      new Set(
        [
          itemCurrency,
          ...freightQuotes
            .filter((quote) => quote.amount !== null && quote.amount > 0)
            .map((quote) => quote.currency?.trim().toUpperCase())
            .filter((value): value is string => Boolean(value)),
        ].filter((currency) => currency !== costCurrency),
      ),
    );
    const rateEntries = await Promise.all(
      currenciesNeedingRate.map(async (currency) => [
        currency,
        await rateToTarget(currency, costCurrency),
      ] as const),
    );
    const rates = new Map<string, number>(rateEntries);
    const rateForCurrency = (currency: string) => {
      const normalized = currency.trim().toUpperCase();
      return normalized === costCurrency ? 1 : rates.get(normalized) ?? null;
    };

    const selectedFreight = selectCheapestFreightQuote({
      quotes: freightQuotes,
      targetCurrency: costCurrency,
      rateForCurrency,
    });
    const itemRate = rateForCurrency(itemCurrency);

    const costedSkus: AliExpressImportSkuCost[] = input.skuPricing.map((sku) => {
      const itemPrice = Number(sku.sale_price);
      const landed = calculateLandedUnitCost({
        itemPrice,
        itemCurrency,
        targetCurrency: costCurrency,
        itemRate,
        freightAmountInTargetCurrency: selectedFreight.amountInTargetCurrency,
      });
      return {
        sku,
        itemPrice,
        itemCurrency,
        itemCostInCostCurrency: landed.itemCostInTargetCurrency,
        freightCostInCostCurrency: landed.freightCostInTargetCurrency,
        landedCost: landed.landedCost,
        costCurrency: landed.currency,
      };
    });

    const landedCosts = costedSkus
      .map((row) => row.landedCost)
      .filter((value): value is number => value !== null);
    const normalizedQuotes: CostSnapshotQuote[] = freightQuotes.flatMap((quote) => {
      if (
        quote.amount === null ||
        !Number.isFinite(quote.amount) ||
        quote.amount < 0
      ) {
        return [];
      }
      const currency = quote.currency?.trim().toUpperCase() ||
        (quote.amount === 0 ? costCurrency : "");
      if (!currency) return [];
      try {
        return [{
          serviceName: quote.serviceName,
          estimatedDeliveryTime: quote.estimatedDeliveryTime,
          amount: quote.amount,
          currency,
          amountInCostCurrency: convertCostAmount({
            amount: quote.amount,
            sourceCurrency: currency,
            targetCurrency: costCurrency,
            rate: rateForCurrency(currency),
          }),
        }];
      } catch {
        return [];
      }
    });
    const calculatedAt = new Date().toISOString();

    return {
      complete: true,
      costedSkus,
      costMin: Math.min(...landedCosts),
      costMax: Math.max(...landedCosts),
      costCurrency,
      warning: null,
      snapshot: {
        status: "COMPLETE",
        basis: "ITEM_PLUS_FREIGHT",
        scope: "ONE_UNIT_COUNTRY_BASELINE",
        includes: ["ITEM_PRICE", "ALIEXPRESS_FREIGHT"],
        countryCode,
        sendGoodsCountryCode,
        quantity: 1,
        itemCurrency,
        costCurrency,
        itemFxRateToCostCurrency: itemRate,
        freight: {
          status: "AVAILABLE",
          selectedServiceName: selectedFreight.serviceName,
          estimatedDeliveryTime: selectedFreight.estimatedDeliveryTime,
          originalAmount: selectedFreight.amount,
          originalCurrency: selectedFreight.currency,
          amountInCostCurrency: selectedFreight.amountInTargetCurrency,
          costCurrency,
          quoteCount: normalizedQuotes.length,
          quotes: normalizedQuotes,
          error: null,
        },
        calculatedAt,
      },
    };
  } catch (error) {
    return pendingCosting({
      skuPricing: input.skuPricing,
      itemCurrency,
      countryCode,
      sendGoodsCountryCode,
      error: compactError(error),
    });
  }
}

export function aliExpressImportCostBreakdown(
  row: AliExpressImportSkuCost,
  costing: AliExpressImportCosting,
) {
  return {
    status: costing.snapshot.status,
    basis: costing.snapshot.basis,
    itemPrice: row.itemPrice,
    itemCurrency: row.itemCurrency,
    itemCostInCostCurrency: row.itemCostInCostCurrency,
    freightCostInCostCurrency: row.freightCostInCostCurrency,
    landedCost: row.landedCost,
    costCurrency: row.costCurrency,
    countryCode: costing.snapshot.countryCode,
    freightServiceName: costing.snapshot.freight.selectedServiceName,
    freightError: costing.snapshot.freight.error,
    calculatedAt: costing.snapshot.calculatedAt,
  };
}
