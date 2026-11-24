import Link from "next/link";

import { aliExpressProductIdAliases } from "@/lib/aliexpress-catalog-id";
import { extractSupplierWarehouseStatus } from "@/lib/aliexpress-warehouse";
import { parseAmbBridgeConfig } from "@/lib/amb-bridge-contract";
import { prisma } from "@/lib/prisma";
import { ImportForm } from "./import-form";
import { AliExpressSearchPanel } from "./aliexpress-search-panel";
import { WarehouseAuditPanel } from "./warehouse-audit-panel";
import { ProductsCatalogList, type CatalogProductRow } from "./products-catalog-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ProductsPage() {
  const [store, products] = await Promise.all([
    prisma.store.findUnique({
      where: { id: "amb-boutique-store" },
      select: { connectorCapabilities: true },
    }),
    prisma.product.findMany({
      include: {
        images: { select: { id: true } },
        variants: { select: { attributes: true, stock: true, available: true } },
        supplierProducts: {
          where: { status: "ACTIVE" },
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            sellerName: true,
            rawPayload: true,
            variants: { select: { attributes: true, stock: true } },
          },
        },
      },
      orderBy: {
        importedAt: "desc",
      },
    }),
  ]);

  const bridge = parseAmbBridgeConfig(store?.connectorCapabilities);
  const slugsByAlias = new Map<string, string[]>();
  if (bridge) {
    for (const [slug, binding] of Object.entries(bridge.products)) {
      for (const alias of aliExpressProductIdAliases(binding.sourceProductId)) {
        const list = slugsByAlias.get(alias) || [];
        if (!list.includes(slug)) list.push(slug);
        slugsByAlias.set(alias, list);
      }
    }
  }

  const catalogRows: CatalogProductRow[] = products.map((product) => {
    const primarySupplier = product.supplierProducts[0] || null;
    const variants = primarySupplier?.variants.length
      ? primarySupplier.variants.map((v) => ({ attributes: v.attributes, stock: v.stock, available: v.stock > 0 }))
      : product.variants;

    // Check primary supplier first; also detect if any backup/alternative active supplier has US warehouse
    const primaryStatus = extractSupplierWarehouseStatus({
      supplierRawPayload: primarySupplier?.rawPayload,
      variants,
    });

    const anyAltUs = product.supplierProducts.slice(1).map((sup) =>
      extractSupplierWarehouseStatus({
        supplierRawPayload: sup.rawPayload,
        variants: sup.variants.map((v) => ({ attributes: v.attributes, stock: v.stock, available: v.stock > 0 })),
      }),
    );

    const bestUs = primaryStatus.hasUsInStock
      ? primaryStatus
      : anyAltUs.find((s) => s.hasUsInStock) ||
        (primaryStatus.hasUsWarehouse ? primaryStatus : anyAltUs.find((s) => s.hasUsWarehouse)) ||
        primaryStatus;

    return {
      id: product.id,
      sourceProductId: product.sourceProductId,
      title: product.optimizedTitle || product.sourceTitle,
      imageCount: product.images.length,
      variantCount: product.variants.length,
      status: product.status,
      sellerName: primarySupplier?.sellerName || null,
      ambSlugs: slugsByAlias.get(product.sourceProductId) || [],
      hasUsWarehouse: bestUs.hasUsWarehouse,
      hasUsInStock: bestUs.hasUsInStock,
      usTotalStock: bestUs.usTotalStock,
      dispatchCountry: bestUs.dispatchCountry,
      checked: bestUs.checked,
      error: bestUs.error,
      deliveryMinDays: bestUs.deliveryMinDays,
      deliveryMaxDays: bestUs.deliveryMaxDays,
      ambDisplayMinDays: bestUs.ambDisplayMinDays,
      ambDisplayMaxDays: bestUs.ambDisplayMaxDays,
    };
  });

  // Always pin US Warehouse (in stock first, then out of stock) at the top
  catalogRows.sort((a, b) => {
    if (a.hasUsInStock !== b.hasUsInStock) return a.hasUsInStock ? -1 : 1;
    if (a.hasUsWarehouse !== b.hasUsWarehouse) return a.hasUsWarehouse ? -1 : 1;
    if (b.usTotalStock !== a.usTotalStock) return b.usTotalStock - a.usTotalStock;
    return 0;
  });

  const usInStockCount = catalogRows.filter((item) => item.hasUsInStock).length;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <Link
          href="/"
          className="text-sm text-zinc-400 transition hover:text-white"
        >
          ← Voltar ao dashboard
        </Link>

        <div className="mt-6">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
            AliExpress Store Manager
          </p>

          <h1 className="mt-2 text-4xl font-semibold">
            Produtos
          </h1>

          <p className="mt-2 text-zinc-400">
            Importe produtos do AliExpress, identifique fornecedores com armazém nos EUA e sincronize prazos direto com a AMB Boutique.
          </p>
        </div>

        <div className="mt-8">
          <ImportForm />
        </div>

        <div className="mt-8">
          <WarehouseAuditPanel initialUsCount={usInStockCount} totalProducts={products.length} />
        </div>

        <div className="mt-8">
          <AliExpressSearchPanel />
        </div>

        <ProductsCatalogList items={catalogRows} />
      </div>
    </main>
  );
}
