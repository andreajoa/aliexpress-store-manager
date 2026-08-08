import Link from "next/link";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function money(value: { toString(): string }, currency: string) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(Number(value.toString()));
}

function statusClasses(status: string) {
  if (["DELIVERED"].includes(status)) return "bg-emerald-950 text-emerald-300";
  if (["SHIPPED", "ORDERED_ALIEXPRESS"].includes(status)) return "bg-sky-950 text-sky-300";
  if (["CANCELLED", "REFUNDED"].includes(status)) return "bg-red-950 text-red-300";
  return "bg-amber-950 text-amber-300";
}

export default async function OrdersPage() {
  const orders = await prisma.order.findMany({
    include: {
      store: { select: { name: true } },
      _count: { select: { items: true, fulfillmentBatches: true } },
    },
    orderBy: { orderedAt: "desc" },
    take: 200,
  });

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <Link href="/" className="text-sm text-zinc-400 hover:text-white">
          ← Voltar ao dashboard
        </Link>

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
              Operações
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">Pedidos</h1>
            <p className="mt-2 text-zinc-400">
              Vendas recebidas das lojas, seleção de fornecedor, fulfillment e rastreamento.
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-3 text-sm text-zinc-400">
            {orders.length} pedido(s)
          </div>
        </div>

        {orders.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center text-zinc-500">
            Nenhum pedido recebido ainda.
          </div>
        ) : (
          <div className="mt-8 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            <div className="divide-y divide-zinc-800">
              {orders.map((order) => (
                <Link
                  key={order.id}
                  href={`/orders/${order.id}`}
                  className="grid gap-4 p-5 transition hover:bg-zinc-800/50 md:grid-cols-[1.4fr_1fr_1fr_1fr_auto] md:items-center"
                >
                  <div>
                    <p className="font-semibold">{order.externalOrderId}</p>
                    <p className="mt-1 text-xs text-zinc-500">{order.store.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Cliente</p>
                    <p className="mt-1 text-sm text-zinc-300">{order.customerName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Total</p>
                    <p className="mt-1 text-sm font-medium">{money(order.total, order.currency)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Itens / lotes</p>
                    <p className="mt-1 text-sm text-zinc-300">
                      {order._count.items} / {order._count.fulfillmentBatches}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses(order.status)}`}>
                      {order.status}
                    </span>
                    <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">
                      {order.fulfillmentStatus}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
