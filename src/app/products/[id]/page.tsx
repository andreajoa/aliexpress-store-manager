import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { OptimizeButton } from "./optimize-button";
import { ProductEditor } from "./product-editor";
import { EditorialStudio } from "./editorial-studio";
import { ExportCenter } from "./export-center";
import { PublicationPanel } from "./publication-panel";
import { SupplierPanel } from "./supplier-panel";
import { SupplierSyncButton } from "./supplier-sync-button";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function benefits(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function variantName(attributes: unknown, index: number) {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return `Variante ${index + 1}`;
  }

  const label = Object.entries(attributes as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");

  return label || `Variante ${index + 1}`;
}

function pendingItemCost(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const costBreakdown = (rawPayload as Record<string, unknown>).costBreakdown;
  if (
    !costBreakdown ||
    typeof costBreakdown !== "object" ||
    Array.isArray(costBreakdown)
  ) {
    return null;
  }

  const record = costBreakdown as Record<string, unknown>;
  if (record.status !== "PENDING_FREIGHT") return null;

  const itemPrice = Number(record.itemPrice);
  const itemCurrency =
    typeof record.itemCurrency === "string"
      ? record.itemCurrency.trim().toUpperCase()
      : "";

  if (!Number.isFinite(itemPrice) || itemPrice <= 0 || !itemCurrency) {
    return null;
  }

  return {
    price: String(Math.round(itemPrice * 100) / 100),
    currency: itemCurrency,
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      variants: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!product) notFound();

  const stores = await prisma.store.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, baseUrl: true },
    orderBy: { name: "asc" },
  });

  const canonicalVariants = product.variants.map((variant, index) => ({
    id: variant.id,
    name: variantName(variant.attributes, index),
  }));

  const pricingVariants = product.variants.map((variant) => {
    const provisional = variant.costPrice
      ? null
      : pendingItemCost(variant.rawPayload);

    return {
      id: variant.id,
      sourceSkuId: variant.sourceSkuId,
      attributes: variant.attributes as Record<string, string>,
      costPrice:
        variant.costPrice?.toString() ||
        provisional?.price ||
        null,
      salePrice: variant.salePrice?.toString() || null,
      sourceCurrency:
        variant.sourceCurrency ||
        provisional?.currency ||
        null,
      stock: variant.stock,
      available: variant.available,
      provisional: Boolean(provisional),
    };
  });

  const provisionalPricingCount = pricingVariants.filter(
    (variant) => variant.provisional,
  ).length;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <Link href="/products" className="text-sm text-zinc-400 hover:text-white">
          ← Voltar aos produtos
        </Link>

        <div className="mt-7 grid gap-7 lg:grid-cols-[0.75fr_1.25fr]">
          <section className="space-y-5">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Dados operacionais
              </p>
              <h1 className="mt-3 text-2xl font-semibold">{product.sourceTitle}</h1>
              <p className="mt-3 text-sm text-zinc-500">
                AliExpress ID: {product.sourceProductId}
              </p>

              <div className="mt-6 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-zinc-500">Imagens</p>
                  <p className="mt-1 text-xl font-semibold">{product.images.length}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">SKUs</p>
                  <p className="mt-1 text-xl font-semibold">{product.variants.length}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Custo mínimo</p>
                  <p className="mt-1 font-semibold">
                    {product.costMin?.toString() || "—"} {product.sourceCurrency}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Custo máximo</p>
                  <p className="mt-1 font-semibold">
                    {product.costMax?.toString() || "—"} {product.sourceCurrency}
                  </p>
                </div>
              </div>
            </div>

            {product.images[0] && (
              <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={product.images[0].sourceUrl}
                  alt={product.sourceTitle}
                  className="aspect-square w-full object-contain"
                />
              </div>
            )}

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="font-medium">Dados preservados</p>
              <p className="mt-2 text-sm text-zinc-500">
                SKU e custo-base permanecem ligados ao produto comercial. O estoque abaixo é a disponibilidade segura recalculada pelo Supplier Engine quando os fornecedores são sincronizados.
              </p>

              <div className="mt-4 space-y-3">
                {pricingVariants.map((variant, index) => (
                  <div
                    key={variant.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                  >
                    <p className="text-sm">{variantName(variant.attributes, index)}</p>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
                      <span>SKU canônico: {variant.sourceSkuId}</span>
                      <span>
                        {variant.provisional ? "Custo do item" : "Custo base"}: {variant.costPrice || "—"} {variant.sourceCurrency}
                        {variant.provisional ? " (frete pendente)" : ""}
                      </span>
                      <span>Estoque seguro: {variant.stock ?? "—"}</span>
                      <span>{variant.available ? "Disponível" : "Indisponível"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-5">
            {product.optimizedTitle ? (
              <>
                <div className="rounded-2xl border border-emerald-900 bg-emerald-950/20 p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
                        IA comercial
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">
                        A copy pode ser regenerada sem alterar SKUs ou custos.
                      </p>
                    </div>
                    <div className="w-full sm:w-52">
                      <OptimizeButton productId={product.id} alreadyOptimized />
                    </div>
                  </div>
                </div>

                {provisionalPricingCount > 0 && (
                  <div className="rounded-2xl border border-amber-700 bg-amber-950/30 p-5 text-sm leading-6 text-amber-200">
                    <strong>Precificação provisória:</strong>{" "}
                    {provisionalPricingCount} variante(s) ainda estão com o frete do AliExpress pendente. O botão “Calcular sugestões” usará o preço original do item preservado na importação como custo-base. O frete ainda não está incluído; use “Reserva adicional %” como margem de segurança até a logística ser sincronizada.
                  </div>
                )}

                <ProductEditor
                  productId={product.id}
                  status={product.status}
                  optimizedTitle={product.optimizedTitle || ""}
                  headline={product.headline || ""}
                  shortDescription={product.shortDescription || ""}
                  benefits={benefits(product.benefits)}
                  cta={product.cta || ""}
                  seoTitle={product.seoTitle || ""}
                  seoDescription={product.seoDescription || ""}
                  compareAtPrice={product.compareAtPrice?.toString() || null}
                  images={product.images.map((image) => ({
                    id: image.id,
                    sourceUrl: image.sourceUrl,
                    selected: image.selected,
                  }))}
                  variants={pricingVariants.map((variant) => ({
                    id: variant.id,
                    sourceSkuId: variant.sourceSkuId,
                    attributes: variant.attributes,
                    costPrice: variant.costPrice,
                    salePrice: variant.salePrice,
                    sourceCurrency: variant.sourceCurrency,
                    stock: variant.stock,
                    available: variant.available,
                  }))}
                />

                <SupplierSyncButton productId={product.id} />

                <SupplierPanel
                  productId={product.id}
                  canonicalVariants={canonicalVariants}
                />

                <EditorialStudio
                  productId={product.id}
                  productStatus={product.status}
                  stores={stores}
                  sourceImages={product.images.map((image) => ({
                    id: image.id,
                    url: image.storedUrl || image.sourceUrl,
                    selected: image.selected,
                  }))}
                  initialReferenceImageId={
                    product.editorialReferenceImageId ||
                    product.images.find((image) => image.selected)?.id ||
                    product.images[0]?.id ||
                    ""
                  }
                />

                <PublicationPanel
                  productId={product.id}
                  productStatus={product.status}
                  stores={stores}
                />

                <ExportCenter productId={product.id} stores={stores} />
              </>
            ) : (
              <div className="rounded-2xl border border-emerald-900 bg-emerald-950/20 p-6">
                <h2 className="text-2xl font-semibold">Produto pronto para otimização</h2>
                <p className="mt-2 text-zinc-400">
                  Gere a apresentação comercial antes de editar e precificar.
                </p>
                <div className="mt-6">
                  <OptimizeButton productId={product.id} alreadyOptimized={false} />
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
