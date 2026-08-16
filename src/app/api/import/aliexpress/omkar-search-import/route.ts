import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { searchOmkarProducts } from "@/lib/omkar-search";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      productId?: string;
      query?: string;
    };

    const productId = String(body.productId || "").trim();
    const query = String(body.query || "").trim();

    if (!productId && !query) {
      return NextResponse.json(
        { ok: false, error: "Envie productId ou query." },
        { status: 400 }
      );
    }

    let result = await searchOmkarProducts(query || productId, 1);
    let item = result.results.find((p) => p.id === productId);

    if (!item && query) {
      for (let page = 2; page <= Math.min(result.total_pages || 1, 5); page += 1) {
        result = await searchOmkarProducts(query, page);
        item = result.results.find((p) => p.id === productId);
        if (item) break;
      }
    }

    if (!item) {
      return NextResponse.json(
        { ok: false, error: "Produto não encontrado na busca do Omkar." },
        { status: 404 }
      );
    }

    const existing = await prisma.product.findUnique({
      where: {
        sourceProvider_sourceProductId: {
          sourceProvider: "ALIEXPRESS",
          sourceProductId: item.id,
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
        { status: 409 }
      );
    }

    const currency = (item.pricing.currency || "USD").toUpperCase();
    const salePrice = item.pricing.sale_price;
    const costMin = salePrice != null ? salePrice : null;
    const costMax = salePrice != null ? salePrice : null;
    const images = item.images || [];
    const importedAt = new Date();

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          sourceProvider: "ALIEXPRESS",
          sourceProductId: item.id,
          sourceUrl: item.link,
          sourceTitle: item.title,
          sourceDescription: null,
          sourceCurrency: currency,
          costMin: costMin,
          costMax: costMax,
          specifications: {
            categoryId: item.category_ids?.[0] ?? null,
            seller: {
              name: item.store_name || null,
              id: null,
              logoUrl: null,
            },
            package: null,
            videoUrl: null,
            baseCurrency: currency,
            hasWelcomeDeal: null,
            enrichmentSpecifications: [],
            shippingInfo: "",
            stockInfo: "",
            operationalProvider: "OMKAR_SEARCH",
            requestedProductId: item.id,
            resolvedProductId: item.id,
          },
          rawPayload: {
            operationalProvider: "OMKAR_SEARCH",
            operationalWarnings: [
              "Importado via busca do Omkar; detalhes de SKU não disponíveis.",
            ],
            requestedProductId: item.id,
            resolvedProductId: item.id,
            searchResult: JSON.parse(JSON.stringify(item)),
          },
          status: "IMPORTED",
          images: {
            create: images.map((sourceUrl, index) => ({
              sourceUrl,
              sortOrder: index,
              selected: true,
              imageType: "GALLERY",
            })),
          },
          variants: {
            create: {
              sourceSkuId: String(item.id),
              sku: String(item.id),
              attributes: {},
              costPrice: costMin,
              sourceCurrency: currency,
              stock: null,
              available: false,
              imageUrl: images[0] || null,
              rawPayload: {
                source: "omkar-search-fallback",
                pricing: item.pricing,
              },
            },
          },
        },
        include: {
          images: true,
          variants: true,
        },
      });

      await tx.supplierProduct.create({
        data: {
          productId: created.id,
          provider: "ALIEXPRESS",
          sourceProductId: item.id,
          sourceUrl: item.link,
          sellerId: null,
          sellerName: item.store_name || null,
          role: "PRIMARY",
          priority: 0,
          status: "ACTIVE",
          sourceCurrency: currency,
          costMin: costMin,
          costMax: costMax,
          rawPayload: {
            operationalProvider: "OMKAR_SEARCH",
            operationalWarnings: [
              "Importado via busca do Omkar; detalhes de SKU não disponíveis.",
            ],
            requestedProductId: item.id,
            resolvedProductId: item.id,
            searchResult: JSON.parse(JSON.stringify(item)),
          },
          lastCheckedAt: importedAt,
        },
      });

      return created;
    });

    return NextResponse.json(
      {
        ok: true,
        operationalProvider: "OMKAR_SEARCH",
        warnings: [
          "Importado via busca do Omkar; detalhes de SKU não disponíveis.",
        ],
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
          totalStock: 0,
          supplierReady: true,
          seller: item.store_name || null,
          video: false,
          package: null,
          skuPreview: [],
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("AliExpress Omkar search import failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível importar o produto.",
      },
      { status: 502 }
    );
  }
}
