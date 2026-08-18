import { createHmac } from "node:crypto";

export type AliExpressTopConfig = {
  appKey: string;
  appSecret: string;
  endpoint?: string;
};

export type FreightQuote = {
  serviceName: string;
  estimatedDeliveryTime: string | null;
  amount: number | null;
  currency: string | null;
};

const ALIEXPRESS_REQUEST_TIMEOUT_MS = 10_000;

function scalar(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function compactError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function topTimestamp(date = new Date()) {
  return String(date.getTime());
}

export function signTopParameters(
  params: Record<string, string>,
  appSecret: string,
) {
  const base = Object.keys(params)
    .filter((key) => key !== "sign")
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");

  return createHmac("sha256", appSecret)
    .update(base, "utf8")
    .digest("hex")
    .toUpperCase();
}

function responseKey(method: string) {
  return `${method.replaceAll(".", "_")}_response`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === null || value === undefined) return [];
  return [value as T];
}

function countryAliases(countryCode: string) {
  const normalized = countryCode.trim().toUpperCase();
  if (normalized === "UK") return ["UK", "GB"];
  if (normalized === "GB") return ["GB", "UK"];
  return [normalized];
}

function parseRegionalProductMap(value: unknown): Record<string, string> {
  let source: unknown = value;

  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }

  const record = asRecord(source);
  const result: Record<string, string> = {};

  for (const [country, rawId] of Object.entries(record)) {
    const id = scalar(rawId).trim();
    if (/^\d{10,}$/.test(id)) {
      result[country.trim().toUpperCase()] = id;
    }
  }

  return result;
}

export function regionalProductIdFromEnvelope(
  envelope: Record<string, unknown>,
  countryCode: string,
) {
  const result = asRecord(envelope.result);
  const converter = asRecord(result.product_id_converter_result);
  const regionalMap = parseRegionalProductMap(converter.sub_product_id);

  for (const alias of countryAliases(countryCode)) {
    if (regionalMap[alias]) return regionalMap[alias];
  }

  return null;
}

function freightQuotesFromEnvelope(
  envelope: Record<string, unknown>,
): FreightQuote[] {
  const result = asRecord(envelope.result);
  const resultSuccess = scalar(result.success).toLowerCase();

  if (resultSuccess === "false") {
    throw new Error(
      scalar(result.error_desc) ||
        "AliExpress não conseguiu calcular o frete para este produto.",
    );
  }

  const wrapper = result.aeop_freight_calculate_result_for_buyer_d_t_o_list;
  const wrapperRecord = asRecord(wrapper);
  const rowPayload =
    wrapperRecord.aeop_freight_calculate_result_for_buyer_dto ??
    wrapperRecord.aeop_freight_calculate_result_for_buyer_d_t_o ??
    wrapper;
  const rows = asArray<Record<string, unknown>>(rowPayload);
  const rowErrors: string[] = [];

  const quotes = rows.flatMap<FreightQuote>((row) => {
    const rowSuccess = scalar(row.success).toLowerCase();
    if (row.success === false || rowSuccess === "false") {
      const detail = scalar(row.error_desc || row.error_message || row.error_code);
      if (detail) rowErrors.push(detail);
      return [];
    }

    const freight = asRecord(row.freight);
    const serviceName = scalar(row.service_name);
    if (!serviceName) return [];

    const amountRaw = freight.amount;
    const amount =
      amountRaw === null || amountRaw === undefined || amountRaw === ""
        ? null
        : Number(amountRaw);

    return [{
      serviceName,
      estimatedDeliveryTime: scalar(row.estimated_delivery_time) || null,
      amount: Number.isFinite(amount) ? amount : null,
      currency: scalar(freight.currency_code) || null,
    }];
  });

  if (quotes.length === 0 && rowErrors.length > 0) {
    throw new Error(Array.from(new Set(rowErrors)).join(" | "));
  }

  return quotes;
}

export class AliExpressTopClient {
  private readonly endpoint: string;
  private readonly config: AliExpressTopConfig;

  constructor(config: AliExpressTopConfig) {
    this.config = config;
    this.endpoint = config.endpoint || "https://api-sg.aliexpress.com/sync";
  }

  async execute(
    method: string,
    session: string,
    businessParams: Record<string, unknown> = {},
    fetchImpl: typeof fetch = fetch,
  ) {
    if (!session) throw new Error("Sessão AliExpress ausente.");

    const params: Record<string, string> = {
      method,
      app_key: this.config.appKey,
      session,
      timestamp: topTimestamp(),
      format: "json",
      simplify: "true",
      sign_method: "sha256",
    };

    for (const [key, value] of Object.entries(businessParams)) {
      if (value === undefined || value === null) continue;
      params[key] = scalar(value);
    }

    params.sign = signTopParameters(params, this.config.appSecret);

    const url = new URL(this.endpoint);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort("AliExpress official request timeout"),
      ALIEXPRESS_REQUEST_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `AliExpress Open Platform não respondeu em ${ALIEXPRESS_REQUEST_TIMEOUT_MS / 1000} segundos (${this.endpoint}).`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let json: Record<string, unknown>;

    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      const preview = text.trim().slice(0, 300);
      throw new Error(
        `AliExpress retornou resposta inválida (HTTP ${response.status})${preview ? `: ${preview}` : "."}`,
      );
    }

    const apiError = asRecord(json.error_response);
    if (Object.keys(apiError).length > 0) {
      const code = scalar(
        apiError.code || apiError.sub_code || "ALIEXPRESS_API_ERROR",
      );
      const message = scalar(
        apiError.sub_msg || apiError.msg || "Erro da API AliExpress",
      );
      throw new Error(`${code}: ${message}`);
    }

    const rootCode = scalar(json.code);
    if (rootCode && rootCode !== "0" && rootCode.toLowerCase() !== "success") {
      const message = scalar(
        json.message ||
          json.msg ||
          json.error_message ||
          json.error_msg ||
          "Erro da API AliExpress",
      );
      throw new Error(`${rootCode}: ${message}`);
    }

    if (!response.ok) {
      throw new Error(
        `AliExpress HTTP ${response.status}: ${text.trim().slice(0, 300) || "sem corpo de resposta"}.`,
      );
    }

    const envelope = asRecord(json[responseKey(method)]);
    return Object.keys(envelope).length > 0 ? envelope : json;
  }

  async getDropshipProduct(input: {
    session: string;
    productId: string;
    shipToCountry: string;
    targetCurrency?: string;
    targetLanguage?: string;
  }) {
    return this.execute("aliexpress.ds.product.get", input.session, {
      product_id: input.productId,
      ship_to_country: input.shipToCountry,
      target_currency: input.targetCurrency || "USD",
      target_language: input.targetLanguage || "EN",
    });
  }

  private async freightProductCandidates(input: {
    session: string;
    productId: string;
    countryCode: string;
    priceCurrency?: string | null;
  }) {
    const candidates: string[] = [];

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
      if (regionalId) candidates.push(regionalId);

      const result = asRecord(productEnvelope.result);
      const converter = asRecord(result.product_id_converter_result);
      const mainId = scalar(converter.main_product_id).trim();
      if (/^\d{10,}$/.test(mainId)) candidates.push(mainId);
    } catch {
      // A consulta de produto é apenas usada para resolver o ID regional.
      // O ID recebido continua sendo uma tentativa válida de fallback.
    }

    candidates.push(input.productId);
    return Array.from(new Set(candidates.filter((id) => /^\d{10,}$/.test(id))));
  }

  async calculateFreight(input: {
    session: string;
    productId: string;
    quantity: number;
    countryCode: string;
    sendGoodsCountryCode?: string;
    price?: string | null;
    priceCurrency?: string | null;
  }): Promise<FreightQuote[]> {
    const productIds = await this.freightProductCandidates({
      session: input.session,
      productId: input.productId,
      countryCode: input.countryCode,
      priceCurrency: input.priceCurrency,
    });
    const failures: string[] = [];

    for (const productId of productIds) {
      const pricingModes = input.price
        ? [true, false]
        : [false];

      for (const includePrice of pricingModes) {
        try {
          const envelope = await this.execute(
            "aliexpress.logistics.buyer.freight.calculate",
            input.session,
            {
              param_aeop_freight_calculate_for_buyer_d_t_o: {
                country_code: input.countryCode,
                product_id: productId,
                product_num: input.quantity,
                send_goods_country_code:
                  input.sendGoodsCountryCode || "CN",
                ...(includePrice && input.price
                  ? { price: input.price }
                  : {}),
                ...(includePrice && input.priceCurrency
                  ? { price_currency: input.priceCurrency }
                  : {}),
              },
            },
          );

          const quotes = freightQuotesFromEnvelope(envelope);
          if (quotes.length > 0) return quotes;

          failures.push(
            `${productId}${includePrice ? "/com-preço" : "/sem-preço"}: sem opções de frete`,
          );
        } catch (error) {
          failures.push(
            `${productId}${includePrice ? "/com-preço" : "/sem-preço"}: ${compactError(error)}`,
          );
        }
      }
    }

    throw new Error(
      "AliExpress não conseguiu calcular o frete para o produto. " +
        `Tentativas: ${failures.join(" || ") || "nenhuma opção retornada"}`,
    );
  }

  async placeOrder(input: {
    session: string;
    logisticsAddress: Record<string, unknown>;
    productItems: Array<{
      productId: string;
      quantity: number;
      skuAttr: string;
      logisticsServiceName: string;
      orderMemo?: string;
    }>;
  }) {
    for (const item of input.productItems) {
      if (!item.skuAttr.trim()) {
        throw new Error("sku_attr oficial é obrigatório para a variante.");
      }
      if (!item.logisticsServiceName.trim()) {
        throw new Error("Método de envio AliExpress é obrigatório.");
      }
    }

    const envelope = await this.execute(
      "aliexpress.trade.buy.placeorder",
      input.session,
      {
        param_place_order_request4_open_api_d_t_o: {
          logistics_address: input.logisticsAddress,
          product_items: input.productItems.map((item) => ({
            product_count: item.quantity,
            product_id: item.productId,
            sku_attr: item.skuAttr,
            logistics_service_name: item.logisticsServiceName,
            ...(item.orderMemo ? { order_memo: item.orderMemo } : {}),
          })),
        },
      },
    );

    const result = asRecord(envelope.result);
    const success =
      result.is_success === true ||
      scalar(result.is_success).toLowerCase() === "true";

    if (!success) {
      throw new Error(
        `${scalar(result.error_code) || "ALIEXPRESS_ORDER_FAILED"}: ${scalar(result.error_msg) || "AliExpress recusou o pedido."}`,
      );
    }

    const orderList = asRecord(result.order_list);
    const numbers = asArray<unknown>(orderList.number)
      .map(scalar)
      .filter(Boolean);

    if (numbers.length === 0) {
      throw new Error(
        "AliExpress confirmou o pedido sem retornar número de ordem.",
      );
    }

    return { orderIds: numbers, raw: result };
  }

  async getOrder(input: { session: string; orderId: string }) {
    return this.execute("aliexpress.trade.ds.order.get", input.session, {
      single_order_query: { order_id: input.orderId },
    });
  }

  async trackingInfo(input: {
    session: string;
    logisticsNo: string;
    orderId: string;
    serviceName: string;
    countryCode: string;
  }) {
    return this.execute("aliexpress.logistics.ds.trackinginfo.query", input.session, {
      logistics_no: input.logisticsNo,
      origin: "ESCROW",
      out_ref: input.orderId,
      service_name: input.serviceName,
      to_area: input.countryCode,
    });
  }
}
