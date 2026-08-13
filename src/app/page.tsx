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
    ordersPendingFulfillment,
  ] = await Promise.all([
    prisma.store.count(),
    prisma.store.count({ where: { status: "ACTIVE" } }),
    prisma.product.count(),
    prisma.publication.count(),
    prisma.order.count(),
    prisma.order.count({
      where: {
        paymentStatus: "PAID",
        fulfillmentStatus: { in: ["UNFULFILLED", "PROCESSING"] },
      },
    }),
  ]);

  return {
    storesTotal,
    storesActive,
    products,
    publications,
    orders,
    ordersPendingFulfillment,
  };
}

export default async function Home() {
  const stats = await getDashboardData();

  const cards = [
    {
      label: "Lojas conectadas",
      value: stats.storesActive,
      description: `${stats.storesActive} conectadas de ${stats.storesTotal} cadastradas`,
      href: "/stores",
    },
    {
      label: "Produtos",
      value: stats.products,
      description: "Produtos importados e Supplier Engine",
      href: "/products",
    },
    {
      label: "Publicações",
      value: stats.publications,
      description: "Publicações e Previews gerenciadas",
      href: "/products",
    },
    {
      label: "Pedidos",
      value: stats.orders,
      description: `${stats.ordersPendingFulfillment} aguardando ou em fulfillment`,
      href: "/orders",
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
              Importe produtos, mantenha fornecedores alternativos, publique com Preview e processe as vendas das lojas em um fluxo controlado.
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
              href="/orders"
              className="inline-flex justify-center rounded-xl border border-zinc-700 px-5 py-3 font-semibold text-white transition hover:bg-zinc-900"
            >
              Operar pedidos
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
            <Link
              key={card.label}
              href={card.href}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 transition hover:border-zinc-700 hover:bg-zinc-800/80"
            >
              <p className="text-sm text-zinc-400">{card.label}</p>
              <p className="mt-3 text-4xl font-semibold">{card.value}</p>
              <p className="mt-2 text-sm text-zinc-500">{card.description}</p>
            </Link>
          ))}
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-7">
            <p className="text-sm font-medium text-emerald-400">FLUXO DO SISTEMA</p>

            <h2 className="mt-2 text-2xl font-semibold">Do AliExpress até o pós-venda</h2>

            <div className="mt-6 space-y-4">
              {[
                "Importe o produto e preserve SKU, custo e estoque de origem",
                "Otimize copy, preço e imagens sem alterar os dados operacionais",
                "Adicione fornecedores principal, reserva e alternativos com mapping 1:1",
                "Publique em branch isolada, valide Preview e só então promova para produção",
                "Receba o pedido pago da loja por webhook autenticado e idempotente",
                "Selecione o fornecedor com dados recentes, mapping e estoque seguro",
                "Fixe o fornecedor/SKU em lotes de fulfillment e execute a compra",
                "Registre pedido externo, rastreamento e entrega por lote",
              ].map((item, index) => (
                <div key={item} className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-400">
                    {index + 1}
                  </div>
                  <p className="pt-1 text-zinc-300">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-900/60 bg-emerald-950/20 p-7">
            <p className="text-sm font-medium text-emerald-400">OPERAÇÃO</p>

            <h2 className="mt-2 text-2xl font-semibold">Gates de segurança ativos</h2>

            <div className="mt-5 space-y-3">
              {[
                "Publicação nunca escreve diretamente na main",
                "Faixa etária sem evidência bloqueia publicação",
                "Mapping incompatível bloqueia fornecedor",
                "Estoque reservado é descontado da disponibilidade",
                "Pedido desconhecido nunca é criado parcialmente",
              ].map((item) => (
                <div key={item} className="rounded-xl border border-emerald-900 bg-zinc-950/50 p-4 text-sm text-zinc-300">
                  {item}
                </div>
              ))}
            </div>

            <div className="mt-6">
              <p className="text-sm text-zinc-500">Atenção operacional</p>
              <p className="mt-1 font-medium">
                {stats.ordersPendingFulfillment > 0
                  ? `${stats.ordersPendingFulfillment} pedido(s) precisam de acompanhamento.`
                  : "Nenhum pedido aguardando fulfillment."}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
