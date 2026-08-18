import {
  AliExpressTopClient,
  regionalProductIdFromEnvelope,
  type AliExpressTopConfig,
  type FreightQuote,
} from "./aliexpress-top-client";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function validProductId(value: string) {
  return /^\d{10,}$/.test(value);
}

function parseSocialFreight(
  envelope: Record<string, unknown>,
): FreightQuote[] {
  const result = record(envelope.result);
  const amountRaw = result.freight_amount;
  const amount = amountRaw === null || amountRaw === undefined || amountRaw === ""
    ? null
    : Number(amountRaw);
  const currency = text(result.currency).toUpperCase();
  const company = text(result.company) || "AliExpress freight";
  const deliveryDate = text(result.delivery_date);
  const commitDay = text(result.commit_day);

  if (amount === null || !Number.isFinite(amount) || amount < 0) {
    return [];
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return [];
  }

  return [{
    serviceName: company,
    estimatedDeliveryTime: deliveryDate || commitDay || null,
    amount,
    currency,
  }];
}

function compactError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class AliExpressOperationalClient extends AliExpressTopClient {
  constructor(config: AliExpressTopConfig) {
    super(config);
  }

  private async socialFreightCandidates(input: {
    session: string;
    productId: string;
    countryCode: string;
    priceCurrency?: string | null;
  }) {
    const ids: string[] = [input.productId];

    try {
      const productEnvelope = await this.getDropshipProduct({
        session: input.session,
        productId: input.productId,
        shipToCountry: input.countryCode,
        targetCurrency: input.priceCurrency || "USD",
        targetLanguage: "EN",
      });

      const regionalId = regionalProductIdFromEnvelope(
        productEnvelope,
        input.countryCode,
      );
      if (regionalId) ids.unshift(regionalId);

      const result = record(productEnvelope.result);
      const converter = record(result.product_id_converter_result);
      const mainId = text(converter.main_product_id);
      if (validProductId(mainId)) ids.push(mainId);
    } catch {
      // The original product id remains a valid fallback candidate.
    }

    return Array.from(new Set(ids.filter(validProductId)));
  }

  private async calculateSocialFreight(input: {
    session: string;
    productId: string;
    quantity: number;
    countryCode: string;
    priceCurrency?: string | null;
  }): Promise<FreightQuote[]> {
    const productIds = await this.socialFreightCandidates(input);
    const failures: string[] = [];

    for (const productId of productIds) {
      try {
        // Official API: aliexpress.social.product.freight.query.
        // ship_from_country is intentionally omitted so AliExpress resolves
        // the actual dispatch country instead of us assuming CN.
        const envelope = await this.execute(
          "aliexpress.social.product.freight.query",
          input.session,
          {
            product_id: productId,
            quantity: input.quantity,
            ship_to_country: input.countryCode,
            currency: input.priceCurrency || "USD",
          },
        );
        const quotes = parseSocialFreight(envelope);
        if (quotes.length > 0) return quotes;
        failures.push(`${productId}: resposta sem freight_amount/currency válidos`);
      } catch (error) {
        failures.push(`${productId}: ${compactError(error)}`);
      }
    }

    throw new Error(
      `AliExpress social freight também falhou: ${failures.join(" || ") || "sem candidatos"}`,
    );
  }

  override async calculateFreight(input: {
    session: string;
    productId: string;
    quantity: number;
    countryCode: string;
    sendGoodsCountryCode?: string;
    price?: string | null;
    priceCurrency?: string | null;
  }): Promise<FreightQuote[]> {
    try {
      return await super.calculateFreight(input);
    } catch (primaryError) {
      // During fulfillment we need an orderable logistics service code from
      // buyer.freight.calculate. Do not replace that with the social API.
      // Landed-cost import is distinguishable because it always supplies price.
      if (!input.price) throw primaryError;

      try {
        return await this.calculateSocialFreight({
          session: input.session,
          productId: input.productId,
          quantity: input.quantity,
          countryCode: input.countryCode,
          priceCurrency: input.priceCurrency,
        });
      } catch (fallbackError) {
        throw new Error(
          `${compactError(primaryError)} | Fallback oficial de custo: ${compactError(fallbackError)}`,
        );
      }
    }
  }
}
