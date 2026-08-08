import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getDashboardData() {
  const [
    storesTotal,
    storesActive,
    products,
    publications,
    orders,
  ] = await Promise.all([
    prisma.store.count(),
    prisma.store.count({
      where: {
        status: "ACTIVE",
      },
    }),
    prisma.product.count(),
    prisma.publication.count(),
    prisma.order.count(),
  ]);

  return {
    storesTotal,
    storesActive,
    products,
    publications,
    orders,
  };
}

export default async function Home() {
  const stats = await getDashboardData();

  const cards = [
    {
      label: "Lojas conectadas",
      value: stats.storesActive,
      description: `${stats.storesActive} conectadas de ${stats.storesTotal} cadastradas`,
    },
    {
      label: "Produtos",
      value: stats.products,
      description: "Produtos importados do AliExpress",
    },
    {
      label: "Publicações",
      value: stats.publications,
      description: "Produtos enviados para lojas",
    },
    {
      label: "Pedidos",
      value: stats.orders,
      description: "Vendas recebidas das lojas",
    },
  ];

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
              AliExpress Store Manager
            </p>

            <h1 className="mt-2 text-4xl font-semibold tracking-tight">
              Central de operações
            </h1>

            <p className="mt-2 max-w-2xl text-zinc-400">
              Importe produtos do AliExpress, otimize a apresentação,
              publique em suas lojas e acompanhe os pedidos em um único lugar.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/products"
              className="inline-flex justify-center rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              Importar produto
            </Link>

            <Link
              href="/stores"
              className="inline-flex justify-center rounded-xl border border-zinc-700 px-5 py-3 font-semibold text-white transition hover:bg-zinc-900"
            >
              Gerenciar lojas
            </Link>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
            >
              <p className="text-sm text-zinc-400">
                {card.label}
              </p>

              <p className="mt-3 text-4xl font-semibold">
                {card.value}
              </p>

              <p className="mt-2 text-sm text-zinc-500">
                {card.description}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-7">
            <p className="text-sm font-medium text-emerald-400">
              FLUXO DO SISTEMA
            </p>

            <h2 className="mt-2 text-2xl font-semibold">
              Do AliExpress até sua loja
            </h2>

            <div className="mt-6 space-y-4">
              {[
                "Cole a URL de um produto do AliExpress",
                "Extraia imagens, variantes, preços e informações",
                "Organize e otimize a copy com inteligência artificial",
                "Revise preço, imagens e conteúdo",
                "Escolha uma loja conectada",
                "Publique o produto",
                "Receba as vendas no painel",
                "Processe o fulfillment e acompanhe o rastreio",
              ].map((item, index) => (
                <div
                  key={item}
                  className="flex items-start gap-4"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-400">
                    {index + 1}
                  </div>

                  <p className="pt-1 text-zinc-300">
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-900/60 bg-emerald-950/20 p-7">
            <p className="text-sm font-medium text-emerald-400">
              STATUS
            </p>

            <h2 className="mt-2 text-2xl font-semibold">
              Infraestrutura pronta
            </h2>

            <div className="mt-5 rounded-xl border border-emerald-900 bg-zinc-950/50 p-4">
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full bg-emerald-400" />

                <span className="font-medium">
                  Neon PostgreSQL
                </span>
              </div>

              <p className="mt-3 text-sm text-zinc-400">
                Banco conectado e pronto para armazenar lojas,
                produtos e pedidos.
              </p>
            </div>

            <div className="mt-6">
              <p className="text-sm text-zinc-500">
                Próxima etapa
              </p>

              <p className="mt-1 font-medium">
                Importar o primeiro produto do AliExpress.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
