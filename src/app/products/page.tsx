import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { ImportForm } from "./import-form";
import { AliExpressSearchPanel } from "./aliexpress-search-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ProductsPage() {
  const products = await prisma.product.findMany({
    include: {
      images: true,
      variants: true,
    },

    orderBy: {
      importedAt: "desc",
    },
  });

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
            Importe produtos do AliExpress, revise os dados e
            prepare-os antes de publicar em qualquer loja.
          </p>
        </div>

        <div className="mt-8">
          <ImportForm />
        </div>

        <div className="mt-8">
          <AliExpressSearchPanel />
        </div>

        <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <p className="text-sm text-zinc-500">
            Produtos importados
          </p>

          <p className="mt-1 text-3xl font-semibold">
            {products.length}
          </p>

          {products.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-zinc-700 p-8 text-center text-zinc-500">
              Nenhum produto importado.
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {products.map((product) => (
                <article
                  key={product.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5"
                >
                  <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-6">
                        {product.optimizedTitle ||
                          product.sourceTitle}
                      </p>

                      <p className="mt-2 text-xs text-zinc-500">
                        AliExpress #{product.sourceProductId}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      <div className="text-sm text-zinc-400">
                        {product.images.length} imagens
                      </div>

                      <div className="text-sm text-zinc-400">
                        {product.variants.length} SKUs
                      </div>

                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${
                          product.status === "READY"
                            ? "border-emerald-800 bg-emerald-950/50 text-emerald-300"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400"
                        }`}
                      >
                        {product.status === "READY"
                          ? "Otimizado"
                          : "Importado"}
                      </span>

                      <Link
                        href={`/products/${product.id}`}
                        className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
                      >
                        Abrir produto
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
