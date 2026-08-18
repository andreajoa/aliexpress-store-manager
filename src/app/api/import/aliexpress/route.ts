import { NextResponse } from "next/server";
import { z } from "zod";

import {
  aliExpressImportCostBreakdown,
  buildAliExpressImportCosting,
} from "@/lib/aliexpress-import-costing";
import {
  AliExpressProviderUnavailableError,
  getAliExpressOperationalProduct,
} from "@/lib/aliexpress-operational-provider";
import {
  resolveAliExpressProductId,
  type OmkarProduct,
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

function supplierVariantName(
  attributes: Record<string, string>,
  sourceSkuId: string,
) {
  const values = Object.values(attributes).filter(Boolean);
  return values.length > 0 ? values.join(" / ") : sourceSkuId;
}

function importWarnings(
  operationalWarnings: string[],
  costingWarning: string | null,
) {
  return Array.from(
    new Set(
      [...operationalWarnings, costingWarning]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim()),
    ),
  );
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

    if (existingRequested) {
      return NextResponse.json(
        {
          ok: false,
          duplicate: true,
          productId: existingRequested.id,
          error: "Este produto do AliExpress já foi importado.",
        },
        { status: 409 },
      );
    }

    /*
     * A importação depende de dados operacionais verificáveis do produto:
     * SKU, preço, estoque e imagens. O frete é uma segunda responsabilidade.
     * Se a AppKey não puder consultar frete, o produto ainda é importado, mas
     * costPrice permanece NULL e a precificação automática fica bloqueada.
     */
    const operational = await getAliExpressOperationalProduct(productId);
    const sourceProduct = operational.product;
    const resolvedProductId = operational.resolvedProductId;

    if (String(sourceProduct.id) !== resolvedProductId) {
      throw new Error(
        `O AliExpress retornou Product ID ${sourceProduct.id}, diferente do ID operacional ${resolvedProductId}. Nada foi salvo.`,
      );
    }

    if (resolvedProductId !== productId) {
      const existingResolved = await prisma.product.findUnique({
        where: {
          sourceProvider_sourceProductId: {
            sourceProvider: "ALIEXPRESS",
            sourceProductId: resolvedProductId,
          },
        },
        select: { id: true },
      });

      if (existingResolved) {
        return NextResponse.json(
          {
            ok: false,
            duplicate: true,
            productId: existingResolved.id,
            error: "Este produto do AliExpress já foi importado.",
          },
          { status: 409 },
        );
      }
    }

    const skuPrices = validPrices(sourceProduct);
    if (skuPrices.length === 0) {
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
    const itemCurrency = (sourceProduct.currency || "USD").toUpperCase();
    const importedAt = new Date();

    const costing = await buildAliExpressImportCosting({
      productId: resolvedProductId,
      skuPricing,
      itemCurrency,
    });
    const costedBySkuId = new Map(
      costing.costedSkus.map((row) => [String(row.sku.sku_id), row]),
    );
    const warnings = importWarnings(operational.warnings, costing.warning);

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
          sourceDescription: null,
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
            operationalWarnings: warnings,
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
                throw new Error(
                  `SKU ${sku.sku_id} ficou sem registro de custo de importação.`,
                );
              }

              return {
                sourceSkuId: String(sku.sku_id),
                sku: String(sku.sku_id),
                attributes,
                costPrice: decimal(row.landedCost),
                sourceCurrency: row.costCurrency,
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
                  originalItemPrice: row.itemPrice,
                  originalItemCurrency: row.itemCurrency,
                  costBreakdown: aliExpressImportCostBreakdown(row, costing),
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
            operationalWarnings: warnings,
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
              costingStatus: costing.snapshot.status,
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
        warnings,
        costing: costing.snapshot,
        costingComplete: costing.complete,
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
