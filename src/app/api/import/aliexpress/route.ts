import { NextResponse } from "next/server";
import { z } from "zod";

import { scrapeAliExpressProduct } from "@/lib/aliexpress";
import { getAliExpressOperationalProduct } from "@/lib/aliexpress-operational-provider";
import {
  extractAliExpressProductId,
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

function supplierVariantName(attributes: Record<string, string>, sourceSkuId: string) {
  const values = Object.values(attributes).filter(Boolean);
  return values.length > 0 ? values.join(" / ") : sourceSkuId;
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
    const productId = extractAliExpressProductId(requestedUrl);

    // Evita gastar quota/Chromium com um produto que já existe.
    const existing = await prisma.product.findUnique({
      where: {
        sourceProvider_sourceProductId: {
          sourceProvider: "ALIEXPRESS",
          sourceProductId: productId,
        },
      },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          duplicate: true,
          productId: existing.id,
          error: "Este produto do AliExpress já foi importado.",
        },
        { status: 409 },
      );
    }

    /*
     * CAMADA OPERACIONAL REDUNDANTE
     * 1. Omkar: caminho rápido quando saudável.
     * 2. Browser AliExpress: captura o mesmo payload estruturado usado pela página.
     * Nenhum produto é persistido sem SKU, preço e estoque verificáveis.
     */
    const operational = await getAliExpressOperationalProduct(productId);
    const sourceProduct = operational.product;

    if (String(sourceProduct.id) !== productId) {
      throw new Error(
        `O AliExpress retornou Product ID ${sourceProduct.id}, diferente do solicitado ${productId}. Nada foi salvo.`,
      );
    }

    // ScrapingBee é somente enriquecimento editorial. Nunca é fonte de SKU/estoque.
    let enrichment:
      | Awaited<ReturnType<typeof scrapeAliExpressProduct>>
      | null = null;

    try {
      enrichment = await scrapeAliExpressProduct(requestedUrl);
    } catch (error) {
      console.warn("ScrapingBee enrichment skipped:", error);
    }

    const skuPrices = validPrices(sourceProduct);
    if (skuPrices.length === 0) {
      throw new Error(
        "O produto foi localizado, mas nenhum preço válido de SKU foi retornado.",
      );
    }

    const costMin = Math.min(...skuPrices);
    const costMax = Math.max(...skuPrices);
    const images = uniqueUrls([
      ...(sourceProduct.images_hd || []),
      ...(sourceProduct.images || []),
      ...(enrichment?.images || []),
    ]);

    if (images.length === 0) {
      throw new Error("O produto não possui imagens válidas para importação.");
    }

    const groups = sourceProduct.variants || [];
    const optionMap = buildOptionMap(groups);
    const skuPricing = sourceProduct.sku_pricing || [];
    const sourceUrl = sourceProduct.listing_url || requestedUrl;
    const currency = (
      sourceProduct.currency || enrichment?.currency || "USD"
    ).toUpperCase();
    const description = enrichment?.description || null;
    const importedAt = new Date();

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          sourceProvider: "ALIEXPRESS",
          sourceProductId: productId,
          sourceUrl,
          sourceSellerId: sourceProduct.seller?.id
            ? String(sourceProduct.seller.id)
            : null,
          sourceTitle: sourceProduct.title,
          sourceDescription: description,
          sourceCurrency: currency,
          costMin: decimal(costMin),
          costMax: decimal(costMax),
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
            hasWelcomeDeal: sourceProduct.has_welcome_deal ?? null,
            enrichmentSpecifications: enrichment?.specifications || [],
            shippingInfo: enrichment?.shippingInfo || "",
            stockInfo: enrichment?.stockInfo || "",
            operationalProvider: operational.provider,
          },
          rawPayload: {
            operationalProvider: operational.provider,
            operationalWarnings: operational.warnings,
            operationalProduct: JSON.parse(JSON.stringify(sourceProduct)),
            scrapingBee: enrichment
              ? JSON.parse(JSON.stringify(enrichment.raw))
              : null,
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
              return {
                sourceSkuId: String(sku.sku_id),
                sku: String(sku.sku_id),
                attributes,
                costPrice: decimal(sku.sale_price),
                sourceCurrency: currency,
                stock:
                  typeof sku.available_quantity === "number"
                    ? Math.max(0, Math.floor(sku.available_quantity))
                    : null,
                available:
                  typeof sku.available_quantity === "number"
                    ? sku.available_quantity > 0
                    : false,
                imageUrl: skuImage(variantIds, optionMap),
                rawPayload: JSON.parse(JSON.stringify(sku)),
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
          sourceProductId: productId,
          sourceUrl,
          sellerId: sourceProduct.seller?.id
            ? String(sourceProduct.seller.id)
            : null,
          sellerName: sourceProduct.seller?.name || null,
          role: "PRIMARY",
          priority: 0,
          status: "ACTIVE",
          sourceCurrency: currency,
          costMin: decimal(costMin),
          costMax: decimal(costMax),
          rawPayload: {
            operationalProvider: operational.provider,
            operationalWarnings: operational.warnings,
            product: JSON.parse(JSON.stringify(sourceProduct)),
          },
          lastCheckedAt: importedAt,
        },
      });

      const skuById = new Map(
        skuPricing.map((sku) => [String(sku.sku_id), sku]),
      );

      for (const canonicalVariant of created.variants) {
        const sku = skuById.get(canonicalVariant.sourceSkuId);
        if (!sku) {
          throw new Error(
            `SKU ${canonicalVariant.sourceSkuId} não pôde ser vinculado ao fornecedor PRIMARY.`,
          );
        }

        const attributes = canonicalVariant.attributes as Record<string, string>;
        const supplierVariant = await tx.supplierVariant.create({
          data: {
            supplierProductId: supplier.id,
            sourceSkuId: canonicalVariant.sourceSkuId,
            name: supplierVariantName(attributes, canonicalVariant.sourceSkuId),
            sourcePrice: canonicalVariant.costPrice,
            stock: canonicalVariant.stock ?? 0,
            attributes,
            imageUrl: canonicalVariant.imageUrl,
          },
        });

        await tx.supplierVariantMapping.create({
          data: {
            supplierProductId: supplier.id,
            supplierVariantId: supplierVariant.id,
            canonicalVariantId: canonicalVariant.id,
            confidence: 1,
            method: "AUTO",
            evidence: {
              source: "aliexpress-import-exact-sku",
              sourceSkuId: canonicalVariant.sourceSkuId,
              operationalProvider: operational.provider,
            },
            active: true,
            verifiedAt: importedAt,
          },
        });
      }

      return created;
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
          skuPreview: product.variants.slice(0, 10).map((variant) => ({
            sku: variant.sourceSkuId,
            attributes: variant.attributes,
            price: variant.costPrice?.toString() || null,
            stock: variant.stock,
            imageUrl: variant.imageUrl,
          })),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("AliExpress import failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível importar o produto.",
      },
      { status: 502 },
    );
  }
}
