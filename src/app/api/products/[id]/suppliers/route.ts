import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { resolveAliExpressProductId } from "@/lib/omkar";
import { aliExpressProductIdAliases } from "@/lib/aliexpress-catalog-id";
import { getAliExpressOperationalProduct } from "@/lib/aliexpress-operational-provider";
import { buildAliExpressImportCosting } from "@/lib/aliexpress-import-costing";
import {
  canonicalVariantsForMapping,
  normalizeSupplierProduct,
} from "@/lib/supplier-catalog";
import { suggestSupplierVariantMappings } from "@/lib/supplier-variant-mapper";

export const runtime = "nodejs";

const createSchema = z.object({
  url: z.string().trim().url(),
  role: z.enum(["PRIMARY", "BACKUP", "ALTERNATIVE"]).default("ALTERNATIVE"),
});

class DuplicateSupplierError extends Error {
  constructor(readonly supplierId: string) {
    super("Este fornecedor já está vinculado ao produto.");
  }
}

function confirmedCost(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function supplierJson(supplier: {
  id: string;
  sourceProductId: string;
  sourceUrl: string;
  sellerId: string | null;
  sellerName: string | null;
  role: string;
  priority: number;
  status: string;
  sourceCurrency: string | null;
  costMin: { toString(): string } | null;
  costMax: { toString(): string } | null;
  lastCheckedAt: Date | null;
  variants: Array<{
    id: string;
    sourceSkuId: string;
    name: string;
    sourcePrice: { toString(): string } | null;
    stock: number;
    attributes: unknown;
    imageUrl: string | null;
  }>;
  mappings: Array<{
    id: string;
    canonicalVariantId: string;
    supplierVariantId: string;
    confidence: { toString(): string } | null;
    method: string;
    active: boolean;
    verifiedAt: Date | null;
  }>;
}) {
  return {
    id: supplier.id,
    sourceProductId: supplier.sourceProductId,
    sourceUrl: supplier.sourceUrl,
    sellerId: supplier.sellerId,
    sellerName: supplier.sellerName,
    role: supplier.role,
    priority: supplier.priority,
    status: supplier.status,
    sourceCurrency: supplier.sourceCurrency,
    costMin: supplier.costMin?.toString() || null,
    costMax: supplier.costMax?.toString() || null,
    lastCheckedAt: supplier.lastCheckedAt?.toISOString() || null,
    variants: supplier.variants.map((variant) => ({
      id: variant.id,
      sourceSkuId: variant.sourceSkuId,
      name: variant.name,
      sourcePrice: variant.sourcePrice?.toString() || null,
      stock: variant.stock,
      attributes: variant.attributes,
      imageUrl: variant.imageUrl,
    })),
    mappings: supplier.mappings.map((mapping) => ({
      id: mapping.id,
      canonicalVariantId: mapping.canonicalVariantId,
      supplierVariantId: mapping.supplierVariantId,
      confidence: mapping.confidence?.toString() || null,
      method: mapping.method,
      active: mapping.active,
      verifiedAt: mapping.verifiedAt?.toISOString() || null,
    })),
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!product) {
    return NextResponse.json({ ok: false, error: "Produto não encontrado." }, { status: 404 });
  }

  const suppliers = await prisma.supplierProduct.findMany({
    where: { productId: id },
    include: {
      variants: { orderBy: { createdAt: "asc" } },
      mappings: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    ok: true,
    suppliers: suppliers.map(supplierJson),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const parsed = createSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Informe uma URL válida do AliExpress e um papel de fornecedor válido." },
        { status: 400 },
      );
    }

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        variants: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!product) {
      return NextResponse.json({ ok: false, error: "Produto não encontrado." }, { status: 404 });
    }

    const sourceProductId = await resolveAliExpressProductId(parsed.data.url);
    const sourceAliases = aliExpressProductIdAliases(sourceProductId);
    const duplicateWhere = {
      productId: id,
      provider: "ALIEXPRESS" as const,
      sourceProductId: { in: sourceAliases },
    };
    const duplicate = await prisma.supplierProduct.findFirst({
      where: duplicateWhere,
      select: { id: true },
    });

    if (duplicate) {
      throw new DuplicateSupplierError(duplicate.id);
    }

    const operational = await getAliExpressOperationalProduct(sourceProductId);
    const rawSnapshot = normalizeSupplierProduct(operational.product);
    if (
      !sourceAliases.includes(operational.resolvedProductId) ||
      !sourceAliases.includes(rawSnapshot.sourceProductId)
    ) {
      throw new Error("O fornecedor retornou um produto diferente do solicitado.");
    }

    const costing = await buildAliExpressImportCosting({
      productId: operational.resolvedProductId,
      skuPricing: operational.product.sku_pricing || [],
      itemCurrency: (operational.product.currency || rawSnapshot.sourceCurrency || "USD").toUpperCase(),
    });
    if (!costing.complete) {
      throw new Error(costing.warning || "Cadastro bloqueado: o custo total (produto + frete) ainda não foi confirmado.");
    }

    const landedBySku = new Map(
      costing.costedSkus.map((row) => [String(row.sku.sku_id), row]),
    );
    if (
      costing.snapshot.status !== "COMPLETE" ||
      costing.snapshot.freight.status !== "AVAILABLE" ||
      !confirmedCost(costing.costMin) || !confirmedCost(costing.costMax) ||
      landedBySku.size !== costing.costedSkus.length ||
      rawSnapshot.variants.some((variant) => {
        const row = landedBySku.get(variant.sourceSkuId);
        return !row || !confirmedCost(row.landedCost) ||
          !confirmedCost(row.itemCostInCostCurrency) ||
          !confirmedCost(row.freightCostInCostCurrency) ||
          row.costCurrency !== costing.costCurrency;
      })
    ) {
      throw new Error("Cadastro bloqueado: nem todos os SKUs têm custo total e frete confirmados.");
    }

    const snapshot = {
      ...rawSnapshot,
      sourceCurrency: costing.costCurrency,
      costMin: costing.costMin,
      costMax: costing.costMax,
      variants: rawSnapshot.variants.map((variant) => ({
        ...variant,
        price: landedBySku.get(variant.sourceSkuId)!.landedCost,
        sourcePrice: landedBySku.get(variant.sourceSkuId)!.landedCost,
      })),
    };
    const officialSkuAttrs = operational.product.official_sku_attrs &&
      typeof operational.product.official_sku_attrs === "object" &&
      !Array.isArray(operational.product.official_sku_attrs)
      ? operational.product.official_sku_attrs as Record<string, unknown>
      : {};
    const canonicalVariants = canonicalVariantsForMapping(product.variants);
    const report = suggestSupplierVariantMappings({
      canonicalVariants,
      supplierVariants: snapshot.variants,
    });

    const supplier = await prisma.$transaction(async (tx) => {
      // Recheck after external calls; a concurrent request may have linked the
      // supplier while this request was calculating its freight.
      const linked = await tx.supplierProduct.findFirst({
        where: duplicateWhere,
        select: { id: true },
      });
      if (linked) throw new DuplicateSupplierError(linked.id);

      if (parsed.data.role === "PRIMARY") {
        await tx.supplierProduct.updateMany({
          where: { productId: id, role: "PRIMARY", status: "ACTIVE" },
          data: { role: "BACKUP", priority: 50 },
        });
      }

      const created = await tx.supplierProduct.create({
        data: {
          productId: id,
          provider: snapshot.provider,
          sourceProductId: snapshot.sourceProductId,
          sourceUrl: snapshot.sourceUrl,
          sellerId: snapshot.sellerId,
          sellerName: snapshot.sellerName,
          role: parsed.data.role,
          priority:
            parsed.data.role === "PRIMARY" ? 0 : parsed.data.role === "BACKUP" ? 50 : 100,
          status: "ACTIVE",
          sourceCurrency: snapshot.sourceCurrency,
          costMin: snapshot.costMin,
          costMax: snapshot.costMax,
          rawPayload: JSON.parse(JSON.stringify({
            operationalProvider: operational.provider,
            operationalWarnings: operational.warnings,
            requestedProductId: operational.requestedProductId,
            resolvedProductId: operational.resolvedProductId,
            product: snapshot.rawPayload,
            costSnapshot: costing.snapshot,
          })),
          lastCheckedAt: new Date(),
          variants: {
            create: snapshot.variants.map((variant) => ({
              sourceSkuId: variant.sourceSkuId,
              orderSkuAttr: typeof officialSkuAttrs[variant.sourceSkuId] === "string"
                ? officialSkuAttrs[variant.sourceSkuId] as string
                : null,
              name: variant.name,
              sourcePrice: variant.sourcePrice,
              stock: variant.stock,
              attributes: JSON.parse(JSON.stringify(variant.attributes || {})),
              imageUrl: variant.imageUrl,
            })),
          },
        },
        include: { variants: true },
      });

      if (report.readyForAutomaticConfirmation) {
        const bySku = new Map(created.variants.map((variant) => [variant.sourceSkuId, variant]));
        await tx.supplierVariantMapping.createMany({
          data: report.suggestions.flatMap((suggestion) => {
            const selected = suggestion.selected;
            if (!selected) return [];
            const variant = bySku.get(selected.supplierSourceSkuId);
            if (!variant) return [];
            return [{
              supplierProductId: created.id,
              supplierVariantId: variant.id,
              canonicalVariantId: suggestion.canonicalVariantId,
              confidence: selected.confidence,
              method: "AUTO" as const,
              evidence: {
                reasons: selected.reasons,
                confidence: selected.confidence,
                sourceSkuId: selected.supplierSourceSkuId,
              },
              active: true,
              verifiedAt: new Date(),
            }];
          }),
        });
      }

      return tx.supplierProduct.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          variants: { orderBy: { createdAt: "asc" } },
          mappings: { orderBy: { createdAt: "asc" } },
        },
      });
    }, { timeout: 30_000, isolationLevel: "Serializable" });

    return NextResponse.json(
      {
        ok: true,
        supplier: supplierJson(supplier),
        mapping: report,
        mappingStatus: report.readyForAutomaticConfirmation ? "CONFIRMED_AUTO" : "REVIEW_REQUIRED",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof DuplicateSupplierError) {
      return NextResponse.json(
        { ok: false, duplicate: true, supplierId: error.supplierId, error: error.message },
        { status: 409 },
      );
    }
    console.error("Supplier create failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Não foi possível adicionar o fornecedor.",
      },
      { status: 500 },
    );
  }
}
