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
    perSku?: Array<{
      skuId: string;
      itemPrice: number;
      itemCurrency: string;
      freightServiceName: string | null;
      freightAmountInCostCurrency: number | null;
      landedCost: number | null;
      costCurrency: string;
    }>;
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
  const costedSkus: AliExpressImportSkuCost[] = input.skuPricing.map((sku) => {
    const itemCurrency = (sku.currency_code || input.itemCurrency).trim().toUpperCase();
    return {
      sku,
      itemPrice: Number(sku.sale_price),
      itemCurrency,
      itemCostInCostCurrency: null,
      freightCostInCostCurrency: null,
      landedCost: null,
      costCurrency: input.itemCurrency,
    };
  });

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
  validateSkuPrices(input.skuPricing);

  const countryCode = normalizeCostCountry(process.env.ALIEXPRESS_COST_COUNTRY);
  const costCurrency = normalizeCostCurrency(process.env.ALIEXPRESS_COST_CURRENCY);
  const sendGoodsCountryCode = normalizeCostCountry(
    process.env.ALIEXPRESS_SEND_GOODS_COUNTRY || "CN",
  );
  const defaultItemCurrency = input.itemCurrency.trim().toUpperCase();

  let session: string;
  let client;
  try {
    const connection = await requireAliExpressSession();
    session = connection.session;
    client = connection.client;
  } catch (error) {
    return pendingCosting({
      skuPricing: input.skuPricing,
      itemCurrency: defaultItemCurrency,
      countryCode,
      sendGoodsCountryCode,
      error: compactError(error),
    });
  }

  const rateCache = new Map<string, Promise<number>>();
  const getRate = (sourceCurrency: string) => {
    const source = sourceCurrency.trim().toUpperCase();
    if (source === costCurrency) return Promise.resolve(1);
    const existing = rateCache.get(source);
    if (existing) return existing;
    const created = rateToTarget(source, costCurrency);
    rateCache.set(source, created);
    return created;
  };

  type SkuResult = {
    row: AliExpressImportSkuCost;
    freight: {
      serviceName: string;
      estimatedDeliveryTime: string | null;
      originalAmount: number;
      originalCurrency: string;
      amountInCostCurrency: number;
      quoteCount: number;
    };
  };

  const calculateSku = async (sku: OmkarSkuPricing): Promise<SkuResult> => {
    const itemPrice = Number(sku.sale_price);
    const itemCurrency = (sku.currency_code || defaultItemCurrency).trim().toUpperCase();
    const skuId = String(sku.sku_id || "").trim();

    if (!skuId) {
      throw new Error("SKU oficial ausente durante o cálculo do custo.");
    }

    const freightQuotes = await client.calculateFreight({
      session,
      productId: input.productId,
      quantity: 1,
      countryCode,
      sendGoodsCountryCode,
      price: String(itemPrice),
      priceCurrency: itemCurrency,
      skuId,
    });

    if (freightQuotes.length === 0) {
      throw new Error(`AliExpress não retornou frete oficial para o SKU ${skuId}.`);
    }

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

    await Promise.all(currenciesNeedingRate.map((currency) => getRate(currency)));

    const rateForCurrency = (currency: string) => {
      const normalized = currency.trim().toUpperCase();
      if (normalized === costCurrency) return 1;
      const ratePromise = rateCache.get(normalized);
      return ratePromise ? null : null;
    };

    const resolvedRates = new Map<string, number>();
    for (const currency of currenciesNeedingRate) {
      resolvedRates.set(currency, await getRate(currency));
    }

    const selectedFreight = selectCheapestFreightQuote({
      quotes: freightQuotes,
      targetCurrency: costCurrency,
      rateForCurrency: (currency) => {
        const normalized = currency.trim().toUpperCase();
        return normalized === costCurrency ? 1 : resolvedRates.get(normalized) ?? null;
      },
    });

    const itemRate = itemCurrency === costCurrency
      ? 1
      : resolvedRates.get(itemCurrency) ?? await getRate(itemCurrency);

    const landed = calculateLandedUnitCost({
      itemPrice,
      itemCurrency,
      targetCurrency: costCurrency,
      itemRate,
      freightAmountInTargetCurrency: selectedFreight.amountInTargetCurrency,
    });

    return {
      row: {
        sku,
        itemPrice,
        itemCurrency,
        itemCostInCostCurrency: landed.itemCostInTargetCurrency,
        freightCostInCostCurrency: landed.freightCostInTargetCurrency,
        landedCost: landed.landedCost,
        costCurrency: landed.currency,
      },
      freight: {
        serviceName: selectedFreight.serviceName,
        estimatedDeliveryTime: selectedFreight.estimatedDeliveryTime,
        originalAmount: Number(selectedFreight.amount || 0),
        originalCurrency: selectedFreight.currency || costCurrency,
        amountInCostCurrency: selectedFreight.amountInTargetCurrency,
        quoteCount: freightQuotes.length,
      },
    };
  };

  const skuResults: SkuResult[] = [];
  try {
    const concurrency = 4;
    for (let index = 0; index < input.skuPricing.length; index += concurrency) {
      const chunk = input.skuPricing.slice(index, index + concurrency);
      skuResults.push(...await Promise.all(chunk.map(calculateSku)));
    }
  } catch (error) {
    return pendingCosting({
      skuPricing: input.skuPricing,
      itemCurrency: defaultItemCurrency,
      countryCode,
      sendGoodsCountryCode,
      error: compactError(error),
    });
  }

  const landedCosts = skuResults
    .map((result) => result.row.landedCost)
    .filter((value): value is number => value !== null);

  if (landedCosts.length !== input.skuPricing.length) {
    return pendingCosting({
      skuPricing: input.skuPricing,
      itemCurrency: defaultItemCurrency,
      countryCode,
      sendGoodsCountryCode,
      error: "Nem todas as variantes tiveram preço + frete confirmados.",
    });
  }

  const serviceNames = Array.from(new Set(skuResults.map((result) => result.freight.serviceName)));
  const estimatedTimes = Array.from(
    new Set(
      skuResults
        .map((result) => result.freight.estimatedDeliveryTime)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const firstFreight = skuResults[0]?.freight;
  const allSameFreightAmount = skuResults.every(
    (result) =>
      result.freight.amountInCostCurrency === firstFreight?.amountInCostCurrency &&
      result.freight.originalCurrency === firstFreight?.originalCurrency,
  );

  const calculatedAt = new Date().toISOString();

  return {
    complete: true,
    costedSkus: skuResults.map((result) => result.row),
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
      itemCurrency: defaultItemCurrency,
      costCurrency,
      itemFxRateToCostCurrency: null,
      freight: {
        status: "AVAILABLE",
        selectedServiceName:
          serviceNames.length === 1 ? serviceNames[0] : "PER_SKU",
        estimatedDeliveryTime:
          estimatedTimes.length === 1 ? estimatedTimes[0] : null,
        originalAmount:
          allSameFreightAmount ? firstFreight?.originalAmount ?? null : null,
        originalCurrency:
          allSameFreightAmount ? firstFreight?.originalCurrency ?? null : null,
        amountInCostCurrency:
          allSameFreightAmount ? firstFreight?.amountInCostCurrency ?? null : null,
        costCurrency,
        quoteCount: skuResults.reduce((sum, result) => sum + result.freight.quoteCount, 0),
        quotes: [],
        error: null,
      },
      calculatedAt,
      perSku: skuResults.map((result) => ({
        skuId: String(result.row.sku.sku_id),
        itemPrice: result.row.itemPrice,
        itemCurrency: result.row.itemCurrency,
        freightServiceName: result.freight.serviceName,
        freightAmountInCostCurrency: result.row.freightCostInCostCurrency,
        landedCost: result.row.landedCost,
        costCurrency: result.row.costCurrency,
      })),
    },
  };
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
