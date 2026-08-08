import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { OptimizeButton } from "./optimize-button";
import { ProductEditor } from "./product-editor";
import { EditorialStudio } from "./editorial-studio";
import { ExportCenter } from "./export-center";
import { PublicationPanel } from "./publication-panel";

export const dynamic =
  "force-dynamic";

export const runtime =
  "nodejs";

function benefits(
  value: unknown
): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string"
      )
    : [];
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const { id } = await params;

  const product =
    await prisma.product.findUnique({
      where: { id },

      include: {
        images: {
          orderBy: {
            sortOrder: "asc",
          },
        },

        variants: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

  if (!product) {
    notFound();
  }

  const stores =
    await prisma.store.findMany({
      where: {
        status: "ACTIVE",
      },

      select: {
        id: true,
        name: true,
        baseUrl: true,
      },

      orderBy: {
        name: "asc",
      },
    });

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <Link
          href="/products"
          className="text-sm text-zinc-400 hover:text-white"
        >
          ← Voltar aos produtos
        </Link>

        <div className="mt-7 grid gap-7 lg:grid-cols-[0.75fr_1.25fr]">
          <section className="space-y-5">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Dados operacionais
              </p>

              <h1 className="mt-3 text-2xl font-semibold">
                {product.sourceTitle}
              </h1>

              <p className="mt-3 text-sm text-zinc-500">
                AliExpress ID:{" "}
                {product.sourceProductId}
              </p>

              <div className="mt-6 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-zinc-500">
                    Imagens
                  </p>

                  <p className="mt-1 text-xl font-semibold">
                    {product.images.length}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-zinc-500">
                    SKUs
                  </p>

                  <p className="mt-1 text-xl font-semibold">
                    {product.variants.length}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-zinc-500">
                    Custo mínimo
                  </p>

                  <p className="mt-1 font-semibold">
                    {product.costMin?.toString() ||
                      "—"}{" "}
                    {product.sourceCurrency}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-zinc-500">
                    Custo máximo
                  </p>

                  <p className="mt-1 font-semibold">
                    {product.costMax?.toString() ||
                      "—"}{" "}
                    {product.sourceCurrency}
                  </p>
                </div>
              </div>
            </div>

            {product.images[0] && (
              <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    product.images[0]
                      .sourceUrl
                  }
                  alt={
                    product.sourceTitle
                  }
                  className="aspect-square w-full object-contain"
                />
              </div>
            )}

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <p className="font-medium">
                Dados preservados
              </p>

              <p className="mt-2 text-sm text-zinc-500">
                SKU, custo e estoque continuam vinculados ao AliExpress.
              </p>

              <div className="mt-4 space-y-3">
                {product.variants.map(
                  (variant) => (
                    <div
                      key={
                        variant.id
                      }
                      className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                    >
                      <p className="text-sm">
                        {Object.entries(
                          variant.attributes as Record<
                            string,
                            string
                          >
                        )
                          .map(
                            ([
                              key,
                              value,
                            ]) =>
                              `${key}: ${value}`
                          )
                          .join(" · ") ||
                          "Padrão"}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
                        <span>
                          SKU:{" "}
                          {variant.sourceSkuId}
                        </span>

                        <span>
                          Custo:{" "}
                          {variant.costPrice?.toString() ||
                            "—"}{" "}
                          {variant.sourceCurrency}
                        </span>

                        <span>
                          Estoque:{" "}
                          {variant.stock ??
                            "—"}
                        </span>
                      </div>
                    </div>
                  )
                )}
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
                      <OptimizeButton
                        productId={
                          product.id
                        }
                        alreadyOptimized
                      />
                    </div>
                  </div>
                </div>

                <ProductEditor
                  productId={
                    product.id
                  }

                  status={
                    product.status
                  }

                  optimizedTitle={
                    product.optimizedTitle ||
                    ""
                  }

                  headline={
                    product.headline ||
                    ""
                  }

                  shortDescription={
                    product.shortDescription ||
                    ""
                  }

                  benefits={
                    benefits(
                      product.benefits
                    )
                  }

                  cta={
                    product.cta ||
                    ""
                  }

                  seoTitle={
                    product.seoTitle ||
                    ""
                  }

                  seoDescription={
                    product.seoDescription ||
                    ""
                  }

                  compareAtPrice={
                    product.compareAtPrice?.toString() ||
                    null
                  }

                  images={
                    product.images.map(
                      (image) => ({
                        id:
                          image.id,

                        sourceUrl:
                          image.sourceUrl,

                        selected:
                          image.selected,
                      })
                    )
                  }

                  variants={
                    product.variants.map(
                      (variant) => ({
                        id:
                          variant.id,

                        sourceSkuId:
                          variant.sourceSkuId,

                        attributes:
                          variant.attributes as Record<
                            string,
                            string
                          >,

                        costPrice:
                          variant.costPrice?.toString() ||
                          null,

                        salePrice:
                          variant.salePrice?.toString() ||
                          null,

                        sourceCurrency:
                          variant.sourceCurrency,

                        stock:
                          variant.stock,

                        available:
                          variant.available,
                      })
                    )
                  }
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

                <ExportCenter
                  productId={product.id}
                  stores={stores}
                />
              </>
            ) : (
              <div className="rounded-2xl border border-emerald-900 bg-emerald-950/20 p-6">
                <h2 className="text-2xl font-semibold">
                  Produto pronto para otimização
                </h2>

                <p className="mt-2 text-zinc-400">
                  Gere a apresentação comercial antes de editar e precificar.
                </p>

                <div className="mt-6">
                  <OptimizeButton
                    productId={
                      product.id
                    }
                    alreadyOptimized={
                      false
                    }
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
