import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAliExpressSession } from "@/lib/aliexpress-connection";
import {
  calculateLandedUnitCost,
  convertCostAmount,
  selectCheapestFreightQuote,
} from "@/lib/aliexpress-landed-cost";
import {
  AliExpressProviderUnavailableError,
  getAliExpressOperationalProduct,
} from "@/lib/aliexpress-operational-provider";
import { fetchFxRate } from "@/lib/fx-rate";
import {
  resolveAliExpressProductId,
  type OmkarProduct,
  type OmkarSkuPricing,
  type OmkarVariantGroup,
} from "@/lib/omkar";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 120;

const payloadSchema = z.object({
  url: z.string().trim().url(),
});

function decimal(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function uniqueUrls(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && /^https?:\/\//i.test(value),
      ),
    ),
  );
}

function buildOptionMap(groups: OmkarVariantGroup[]) {
  const result = new Map<
    string,
    {
      attributeName: string;
      optionName: string;
      imageUrl: string | null;
    }
  >();

  for (const group of groups) {
    for (const option of group.options || []) {
      result.set(String(option.value_id), {
        attributeName: group.attribute_name || "Variant",
        optionName: option.name || String(option.value_id),
        imageUrl: option.image_url || null,
      });
    }
  }

  return result;
}

function buildSkuAttributes(
  variantIds: string,
  optionMap: ReturnType<typeof buildOptionMap>,
) {
  const attributes: Record<string, string> = {};

  for (const id of variantIds.split(",").map((item) => item.trim()).filter(Boolean)) {
    const option = optionMap.get(id);
    if (option) {
      attributes[option.attributeName] = option.optionName;
    } else {
      attributes[`variant_${id}`] = id;
    }
  }

  return attributes;
}

function skuImage(
  variantIds: string,
  optionMap: ReturnType<typeof buildOptionMap>,
) {
  for (const id of variantIds.split(",").map((item) => item.trim())) {
    const image = optionMap.get(id)?.imageUrl;
    if (image) return image;
  }
  return null;
}

function validPrices(product: OmkarProduct) {
  return (product.sku_pricing || [])
    .map((sku) => sku.sale_price)
    .filter(
      (price): price is number =>
        typeof price === "number" && Number.isFinite(price) && price >= 0,
    );
}

function supplierVariantName(attributes: Record<string, string>, sourceSkuId: string) {
  const values = Object.values(attributes).filter(Boolean);
  return values.length > 0 ? values.join(" / ") : sourceSkuId;
}

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

async function rateToTarget(
  sourceCurrency: string,
  targetCurrency: string,
) {
  const source = sourceCurrency.trim().toUpperCase();
  const target = targetCurrency.trim().toUpperCase();
  if (source === target) return 1;
  const quote = await fetchFxRate({ from: source, to: target });
  return quote.rate;
}

type CostedSku = {
  sku: OmkarSkuPricing;
  itemPrice: number;
  itemCurrency: string;
  itemCostInCostCurrency: number;
  freightCostInCostCurrency: number;
  landedCost: number;
  costCurrency: string;
};

async function buildLandedCostSnapshot(input: {
  productId: string;
  skuPricing: OmkarSkuPricing[];
  itemCurrency: string;
}) {
  const itemPrices = input.skuPricing
    .map((sku) => sku.sale_price)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value >= 0,
    );
  if (itemPrices.length !== input.skuPricing.length || itemPrices.length === 0) {
    throw new Error(
      "Não foi possível calcular o custo total porque há SKU sem preço original válido.",
    );
  }

  const countryCode = normalizeCostCountry(
    process.env.ALIEXPRESS_COST_COUNTRY,
  );
  const costCurrency = normalizeCostCurrency(
    process.env.ALIEXPRESS_COST_CURRENCY,
  );
  const sendGoodsCountryCode = normalizeCostCountry(
    process.env.ALIEXPRESS_SEND_GOODS_COUNTRY || "CN",
  );
  const itemCurrency = input.itemCurrency.trim().toUpperCase();
  const itemPriceMin = Math.min(...itemPrices);

  const { session, client } = await requireAliExpressSession();
  const freightQuotes = await client.calculateFreight({
    session,
    productId: input.productId,
    quantity: 1,
    countryCode,
    sendGoodsCountryCode,
    price: String(itemPriceMin),
    priceCurrency: itemCurrency,
  });

  if (freightQuotes.length === 0) {
    throw new Error(
      `AliExpress não retornou frete oficial para ${countryCode}. O produto não foi salvo com custo incompleto.`,
    );
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

  const costedSkus: CostedSku[] = input.skuPricing.map((sku) => {
    const itemPrice = sku.sale_price;
    if (
      typeof itemPrice !== "number" ||
      !Number.isFinite(itemPrice) ||
      itemPrice < 0
    ) {
      throw new Error(`SKU ${sku.sku_id} sem preço original válido.`);
    }
    const landed = calculateLandedUnitCost({
      itemPrice,
      itemCurrency,
      targetCurrency: costCurrency,
      itemRate,
      freightAmountInTargetCurrency:
        selectedFreight.amountInTargetCurrency,
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

  const landedCosts = costedSkus.map((row) => row.landedCost);
  const calculatedAt = new Date().toISOString();
  const normalizedQuotes = freightQuotes.flatMap((quote) => {
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

  const snapshot = {
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
      selectedServiceName: selectedFreight.serviceName,
      estimatedDeliveryTime: selectedFreight.estimatedDeliveryTime,
      originalAmount: selectedFreight.amount,
      originalCurrency: selectedFreight.currency,
      amountInCostCurrency: selectedFreight.amountInTargetCurrency,
      costCurrency,
      quoteCount: normalizedQuotes.length,
      quotes: normalizedQuotes,
    },
    calculatedAt,
  };

  return {
    snapshot,
    costedSkus,
    costMin: Math.min(...landedCosts),
    costMax: Math.max(...landedCosts),
    costCurrency,
  };
}

function costBreakdown(
  row: CostedSku,
  snapshot: Awaited<ReturnType<typeof buildLandedCostSnapshot>>["snapshot"],
) {
  return {
    basis: snapshot.basis,
    itemPrice: row.itemPrice,
    itemCurrency: row.itemCurrency,
    itemCostInCostCurrency: row.itemCostInCostCurrency,
    freightCostInCostCurrency: row.freightCostInCostCurrency,
    landedCost: row.landedCost,
    costCurrency: row.costCurrency,
    countryCode: snapshot.countryCode,
    freightServiceName: snapshot.freight.selectedServiceName,
    calculatedAt: snapshot.calculatedAt,
  };
}

export async function POST(request: Request) {
  try {
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Informe uma URL válida." },
        { status: 400 },
      );
    }

    const requestedUrl = parsed.data.url;
    const productId = await resolveAliExpressProductId(requestedUrl);

    const existingRequested = await prisma.product.findUnique({
      where: {
        sourceProvider_sourceProductId: {
          sourceProvider: "ALIEXPRESS",
          sourceProductId: productId,
        },
      },
      select: { id: true },
    });

    /*
     * CAMADA OPERACIONAL REDUNDANTE
     * 1. API oficial AliExpress, quando a conta está autorizada.
     * 2. Omkar com novas tentativas curtas para falhas transitórias.
     * 3. ScrapingBee stealth e Chromium empacotado executados em paralelo.
     * Nenhum produto é persistido sem SKU, preço, estoque E frete oficial.
     */
    const operational = await getAliExpressOperationalProduct(productId);
    const sourceProduct = operational.product;
    const resolvedProductId = operational.resolvedProductId;

    if (String(sourceProduct.id) !== resolvedProductId) {
      throw new Error(
        `O AliExpress retornou Product ID ${sourceProduct.id}, diferente do ID operacional ${resolvedProductId}. Nada foi salvo.`,
      );
    }

    const existingResolved = resolvedProductId === productId
      ? existingRequested
      : await prisma.product.findUnique({
          where: {
            sourceProvider_sourceProductId: {
              sourceProvider: "ALIEXPRESS",
              sourceProductId: resolvedProductId,
            },
          },
          select: { id: true },
        });

    if (
      existingRequested &&
      existingResolved &&
      existingRequested.id !== existingResolved.id
    ) {
      throw new Error(
        "Há dois registros locais conflitantes para o mesmo produto AliExpress. Corrija a duplicidade antes de atualizar custos.",
      );
    }
    const existingProductId = existingResolved?.id || existingRequested?.id || null;

    const originalSkuPrices = validPrices(sourceProduct);
    if (originalSkuPrices.length === 0) {
      throw new Error(
        "O produto foi localizado, mas nenhum preço válido de SKU foi retornado.",
      );
    }

    const images = uniqueUrls([
      ...(sourceProduct.images_hd || []),
      ...(sourceProduct.images || []),
    ]);
    if (images.length === 0) {
      throw new Error("O produto não possui imagens válidas para importação.");
    }

    const groups = sourceProduct.variants || [];
    const optionMap = buildOptionMap(groups);
    const skuPricing = sourceProduct.sku_pricing || [];
    const sourceUrl = sourceProduct.listing_url || requestedUrl;
    const itemCurrency = (
      sourceProduct.currency || "USD"
    ).toUpperCase();
    const description = null;
    const importedAt = new Date();

    // A API de produto retorna o preço do item. O frete é uma API separada.
    // O custo usado para precificar passa a ser o landed cost oficial:
    // preço do SKU convertido + menor frete oficial disponível para 1 unidade.
    const costing = await buildLandedCostSnapshot({
      productId: resolvedProductId,
      skuPricing,
      itemCurrency,
    });
    const costedBySkuId = new Map(
      costing.costedSkus.map((row) => [String(row.sku.sku_id), row]),
    );

    if (existingProductId) {
      const refreshed = await prisma.$transaction(async (tx) => {
        const current = await tx.product.findUnique({
          where: { id: existingProductId },
          include: {
            variants: true,
            supplierProducts: {
              where: {
                provider: "ALIEXPRESS",
                sourceProductId: resolvedProductId,
              },
              include: { variants: true },
            },
          },
        });
        if (!current) throw new Error("Produto existente não foi encontrado para atualização.");

        for (const variant of current.variants) {
          if (!costedBySkuId.has(variant.sourceSkuId)) {
            throw new Error(
              `SKU ${variant.sourceSkuId} não existe mais na resposta operacional. Os custos não foram alterados.`,
            );
          }
        }

        const currentSpecifications = JSON.parse(
          JSON.stringify(current.specifications || {}),
        );
        const currentRawPayload = JSON.parse(
          JSON.stringify(current.rawPayload || {}),
        );

        await tx.product.update({
          where: { id: current.id },
          data: {
            sourceCurrency: costing.costCurrency,
            costMin: decimal(costing.costMin),
            costMax: decimal(costing.costMax),
            specifications: {
              ...currentSpecifications,
              shippingInfo: costing.snapshot.freight,
              importFreight: costing.snapshot,
              costing: costing.snapshot,
            },
            rawPayload: {
              ...currentRawPayload,
              costSnapshot: costing.snapshot,
            },
          },
        });

        await Promise.all(
          current.variants.map((variant) => {
            const row = costedBySkuId.get(variant.sourceSkuId)!;
            const rawPayload = JSON.parse(JSON.stringify(variant.rawPayload || {}));
            return tx.productVariant.update({
              where: { id: variant.id },
              data: {
                costPrice: decimal(row.landedCost),
                sourceCurrency: costing.costCurrency,
                rawPayload: {
                  ...rawPayload,
                  costBreakdown: costBreakdown(row, costing.snapshot),
                },
              },
            });
          }),
        );

        for (const supplier of current.supplierProducts) {
          const supplierRawPayload = JSON.parse(
            JSON.stringify(supplier.rawPayload || {}),
          );
          await tx.supplierProduct.update({
            where: { id: supplier.id },
            data: {
              sourceCurrency: costing.costCurrency,
              costMin: decimal(costing.costMin),
              costMax: decimal(costing.costMax),
              rawPayload: {
                ...supplierRawPayload,
                costSnapshot: costing.snapshot,
              },
              lastCheckedAt: importedAt,
            },
          });
          await Promise.all(
            supplier.variants.map((variant) => {
              const row = costedBySkuId.get(variant.sourceSkuId);
              if (!row) {
                throw new Error(
                  `SKU fornecedor ${variant.sourceSkuId} não existe mais na resposta operacional.`,
                );
              }
              return tx.supplierVariant.update({
                where: { id: variant.id },
                data: {
                  sourcePrice: decimal(row.landedCost),
                },
              });
            }),
          );
        }

        return tx.product.findUnique({
          where: { id: current.id },
          include: { images: true, variants: true },
        });
      }, {
        maxWait: 5_000,
        timeout: 30_000,
      });

      if (!refreshed) throw new Error("Falha ao recarregar o produto atualizado.");
      const totalStock = refreshed.variants.reduce(
        (total, variant) => total + (variant.stock || 0),
        0,
      );

      return NextResponse.json({
        ok: true,
        refreshed: true,
        operationalProvider: operational.provider,
        warnings: operational.warnings,
        costing: costing.snapshot,
        product: {
          id: refreshed.id,
          sourceProductId: refreshed.sourceProductId,
          title: refreshed.sourceTitle,
          currency: refreshed.sourceCurrency,
          costMin: refreshed.costMin?.toString() || null,
          costMax: refreshed.costMax?.toString() || null,
          images: refreshed.images.length,
          variants: refreshed.variants.length,
          totalStock,
          supplierReady: true,
        },
      }, { status: 200 });
    }

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          sourceProvider: "ALIEXPRESS",
          sourceProductId: resolvedProductId,
          sourceUrl,
          sourceSellerId: sourceProduct.seller?.id
            ? String(sourceProduct.seller.id)
            : null,
          sourceTitle: sourceProduct.title,
          sourceDescription: description,
          sourceCurrency: costing.costCurrency,
          costMin: decimal(costing.costMin),
          costMax: decimal(costing.costMax),
          specifications: {
            categoryId: sourceProduct.category_id || null,
            seller: {
              name: sourceProduct.seller?.name || null,
              id: sourceProduct.seller?.id || null,
              logoUrl: sourceProduct.seller?.logo_url || null,
            },
            package: sourceProduct.package || null,
            videoUrl: sourceProduct.video_url || null,
            baseCurrency: sourceProduct.base_currency || null,
            originalItemCurrency: itemCurrency,
            hasWelcomeDeal: sourceProduct.has_welcome_deal ?? null,
            enrichmentSpecifications: [],
            shippingInfo: costing.snapshot.freight,
            importFreight: costing.snapshot,
            costing: costing.snapshot,
            stockInfo: "",
            operationalProvider: operational.provider,
            requestedProductId: productId,
            resolvedProductId,
          },
          rawPayload: {
            operationalProvider: operational.provider,
            operationalWarnings: operational.warnings,
            requestedProductId: productId,
            resolvedProductId,
            operationalProduct: JSON.parse(JSON.stringify(sourceProduct)),
            costSnapshot: costing.snapshot,
            scrapingBee: null,
          },
          status: "IMPORTED",
          images: {
            create: images.map((imageSourceUrl, index) => ({
              sourceUrl: imageSourceUrl,
              sortOrder: index,
              selected: true,
              imageType: "GALLERY",
            })),
          },
          variants: {
            create: skuPricing.map((sku) => {
              const variantIds = sku.variant_ids || "";
              const attributes = buildSkuAttributes(variantIds, optionMap);
              const row = costedBySkuId.get(String(sku.sku_id));
              if (!row) {
                throw new Error(`SKU ${sku.sku_id} ficou sem cálculo de custo total.`);
              }
              return {
                sourceSkuId: String(sku.sku_id),
                sku: String(sku.sku_id),
                attributes,
                costPrice: decimal(row.landedCost),
                sourceCurrency: costing.costCurrency,
                stock:
                  typeof sku.available_quantity === "number"
                    ? Math.max(0, Math.floor(sku.available_quantity))
                    : null,
                available:
                  typeof sku.available_quantity === "number"
                    ? sku.available_quantity > 0
                    : false,
                imageUrl: skuImage(variantIds, optionMap),
                rawPayload: {
                  ...JSON.parse(JSON.stringify(sku)),
                  costBreakdown: costBreakdown(row, costing.snapshot),
                },
              };
            }),
          },
        },
        include: {
          images: true,
          variants: true,
        },
      });

      const supplier = await tx.supplierProduct.create({
        data: {
          productId: created.id,
          provider: "ALIEXPRESS",
          sourceProductId: resolvedProductId,
          sourceUrl,
          sellerId: sourceProduct.seller?.id
            ? String(sourceProduct.seller.id)
            : null,
          sellerName: sourceProduct.seller?.name || null,
          role: "PRIMARY",
          priority: 0,
          status: "ACTIVE",
          sourceCurrency: costing.costCurrency,
          costMin: decimal(costing.costMin),
          costMax: decimal(costing.costMax),
          rawPayload: {
            operationalProvider: operational.provider,
            operationalWarnings: operational.warnings,
            requestedProductId: productId,
            resolvedProductId,
            product: JSON.parse(JSON.stringify(sourceProduct)),
            costSnapshot: costing.snapshot,
          },
          lastCheckedAt: importedAt,
        },
      });

      const skuById = new Map(
        skuPricing.map((sku) => [String(sku.sku_id), sku]),
      );
      const officialSkuAttrs = sourceProduct.official_sku_attrs &&
        typeof sourceProduct.official_sku_attrs === "object" &&
        !Array.isArray(sourceProduct.official_sku_attrs)
        ? sourceProduct.official_sku_attrs as Record<string, string>
        : {};

      const supplierVariantRows = created.variants.map((canonicalVariant) => {
        const sku = skuById.get(canonicalVariant.sourceSkuId);
        if (!sku) {
          throw new Error(
            `SKU ${canonicalVariant.sourceSkuId} não pôde ser vinculado ao fornecedor PRIMARY.`,
          );
        }

        const attributes = canonicalVariant.attributes as Record<string, string>;
        return {
          supplierProductId: supplier.id,
          sourceSkuId: canonicalVariant.sourceSkuId,
          orderSkuAttr: officialSkuAttrs[canonicalVariant.sourceSkuId] || null,
          name: supplierVariantName(attributes, canonicalVariant.sourceSkuId),
          sourcePrice: canonicalVariant.costPrice,
          stock: canonicalVariant.stock ?? 0,
          attributes,
          imageUrl: canonicalVariant.imageUrl,
        };
      });

      const supplierVariants = await tx.supplierVariant.createManyAndReturn({
        data: supplierVariantRows,
        select: {
          id: true,
          sourceSkuId: true,
        },
      });

      const supplierVariantBySourceSkuId = new Map(
        supplierVariants.map((variant) => [variant.sourceSkuId, variant]),
      );

      if (supplierVariantBySourceSkuId.size !== created.variants.length) {
        throw new Error(
          "Nem todas as variantes do fornecedor foram persistidas. A importação foi revertida.",
        );
      }

      await tx.supplierVariantMapping.createMany({
        data: created.variants.map((canonicalVariant) => {
          const supplierVariant = supplierVariantBySourceSkuId.get(
            canonicalVariant.sourceSkuId,
          );
          if (!supplierVariant) {
            throw new Error(
              `SKU ${canonicalVariant.sourceSkuId} ficou sem vínculo após a gravação em lote.`,
            );
          }

          return {
            supplierProductId: supplier.id,
            supplierVariantId: supplierVariant.id,
            canonicalVariantId: canonicalVariant.id,
            confidence: 1,
            method: "AUTO" as const,
            evidence: {
              source: "aliexpress-import-exact-sku",
              sourceSkuId: canonicalVariant.sourceSkuId,
              operationalProvider: operational.provider,
              costBasis: costing.snapshot.basis,
            },
            active: true,
            verifiedAt: importedAt,
          };
        }),
      });

      return created;
    }, {
      maxWait: 5_000,
      timeout: 20_000,
    });

    const totalStock = product.variants.reduce(
      (total, variant) => total + (variant.stock || 0),
      0,
    );

    return NextResponse.json(
      {
        ok: true,
        operationalProvider: operational.provider,
        warnings: operational.warnings,
        costing: costing.snapshot,
        product: {
          id: product.id,
          sourceProductId: product.sourceProductId,
          title: product.sourceTitle,
          description: product.sourceDescription,
          currency: product.sourceCurrency,
          costMin: product.costMin?.toString() || null,
          costMax: product.costMax?.toString() || null,
          images: product.images.length,
          variants: product.variants.length,
          totalStock,
          supplierReady: true,
          seller: sourceProduct.seller?.name || null,
          video: Boolean(sourceProduct.video_url),
          package: sourceProduct.package || null,
          freight: costing.snapshot.freight,
          skuPreview: product.variants.slice(0, 10).map((variant) => ({
            sku: variant.sourceSkuId,
            attributes: variant.attributes,
            landedCost: variant.costPrice?.toString() || null,
            costCurrency: variant.sourceCurrency,
            stock: variant.stock,
            imageUrl: variant.imageUrl,
          })),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("AliExpress import failed:", error);

    const providerUnavailable = error instanceof AliExpressProviderUnavailableError;

    return NextResponse.json(
      {
        ok: false,
        code: providerUnavailable ? error.code : "ALIEXPRESS_IMPORT_FAILED",
        retryable: providerUnavailable ? error.retryable : false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível importar o produto.",
      },
      { status: providerUnavailable ? 503 : 502 },
    );
  }
}
