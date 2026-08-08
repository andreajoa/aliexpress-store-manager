import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { OrderFulfillmentPanel } from "./order-fulfillment-panel";
import { AliExpressBatchPanel } from "./aliexpress-batch-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function money(value: { toString(): string } | null, currency: string) {
  if (!value) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(Number(value.toString()));
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      store: { select: { name: true, baseUrl: true } },
      shippingAddress: true,
      items: {
        include: {
          product: { select: { optimizedTitle: true, sourceTitle: true } },
          variant: { select: { sourceSkuId: true, attributes: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      fulfillmentBatches: {
        include: {
          items: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!order) notFound();

  const batches = order.fulfillmentBatches.map((batch) => ({
    id: batch.id,
    provider: batch.provider,
    sourceProductId: batch.sourceProductId,
    sourceUrl: batch.sourceUrl,
    currency: batch.currency,
    status: batch.status,
    externalOrderId: batch.externalOrderId,
    trackingCode: batch.trackingCode,
    trackingUrl: batch.trackingUrl,
    carrier: batch.carrier,
    placementStatus: batch.placementStatus,
    logisticsServiceName: batch.logisticsServiceName,
    items: batch.items.map((item) => ({
      id: item.id,
      title: item.titleSnapshot,
      sourceSkuId: item.fulfillmentSourceSkuId,
      quantity: item.quantity,
      unitCost: item.fulfillmentUnitCost?.toString() || null,
    })),
  }));

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <Link href="/orders" className="text-sm text-zinc-400 hover:text-white">
          ← Voltar aos pedidos
        </Link>

        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
              Pedido · {order.store.name}
            </p>
            <h1 className="mt-2 text-3xl font-semibold">{order.externalOrderId}</h1>
            <p className="mt-2 text-sm text-zinc-500">
              Recebido em {order.orderedAt.toLocaleString("pt-BR")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-semibold">{order.status}</span>
            <span className="rounded-full bg-sky-950 px-3 py-1 text-xs font-semibold text-sky-300">
              {order.fulfillmentStatus}
            </span>
            <span className="rounded-full bg-emerald-950 px-3 py-1 text-xs font-semibold text-emerald-300">
              {order.paymentStatus}
            </span>
            {order.sourceOrderScope === "MANAGED_ITEMS" && (
              <span className="rounded-full bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-300">
                Itens gerenciados
              </span>
            )}
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-6">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <h2 className="text-xl font-semibold">Itens vendidos</h2>
              {order.sourceOrderScope === "MANAGED_ITEMS" && (
                <div className="mt-4 rounded-xl border border-amber-900/70 bg-amber-950/20 p-4 text-sm text-amber-200">
                  Este registro contém somente os itens controlados pelo Store Manager. O pagamento integral da loja foi {money(order.sourceOrderTotal, order.currency)}; nenhum valor de frete ou desconto dos itens legados foi atribuído artificialmente a este subconjunto.
                </div>
              )}
              <div className="mt-5 space-y-3">
                {order.items.map((item) => (
                  <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">
                          {item.product?.optimizedTitle || item.product?.sourceTitle || item.titleSnapshot}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">{item.titleSnapshot}</p>
                        {item.variant && (
                          <p className="mt-2 text-xs text-zinc-400">
                            SKU canônico {item.variant.sourceSkuId} · {JSON.stringify(item.variant.attributes)}
                          </p>
                        )}
                      </div>
                      <div className="text-sm sm:text-right">
                        <p>{item.quantity} × {money(item.unitPrice, order.currency)}</p>
                        <p className="mt-1 font-semibold">{money(item.totalPrice, order.currency)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-2 border-t border-zinc-800 pt-4 text-sm">
                <div className="flex justify-between text-zinc-400"><span>Subtotal gerenciado</span><span>{money(order.subtotal, order.currency)}</span></div>
                <div className="flex justify-between text-zinc-400"><span>Frete atribuído</span><span>{money(order.shippingAmount, order.currency)}</span></div>
                <div className="flex justify-between text-zinc-400"><span>Desconto atribuído</span><span>{money(order.discountAmount, order.currency)}</span></div>
                <div className="flex justify-between pt-2 text-lg font-semibold"><span>Total gerenciado</span><span>{money(order.total, order.currency)}</span></div>
                {order.sourceOrderScope === "MANAGED_ITEMS" && (
                  <div className="flex justify-between pt-2 text-zinc-400"><span>Total integral da loja</span><span>{money(order.sourceOrderTotal, order.currency)}</span></div>
                )}
              </div>
            </div>

            <OrderFulfillmentPanel
              orderId={order.id}
              fulfillmentStatus={order.fulfillmentStatus}
              batches={batches}
            />
            <AliExpressBatchPanel orderId={order.id} batches={batches} />
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <h2 className="text-lg font-semibold">Cliente</h2>
              <p className="mt-4 text-sm text-zinc-300">{order.customerName}</p>
              {order.customerEmail && <p className="mt-1 text-sm text-zinc-500">{order.customerEmail}</p>}
              {order.customerPhone && <p className="mt-1 text-sm text-zinc-500">{order.customerPhone}</p>}
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <h2 className="text-lg font-semibold">Endereço de entrega</h2>
              {order.shippingAddress ? (
                <div className="mt-4 space-y-1 text-sm text-zinc-400">
                  <p className="text-zinc-200">{order.shippingAddress.recipient}</p>
                  <p>{order.shippingAddress.line1}{order.shippingAddress.number ? `, ${order.shippingAddress.number}` : ""}</p>
                  {order.shippingAddress.line2 && <p>{order.shippingAddress.line2}</p>}
                  {order.shippingAddress.district && <p>{order.shippingAddress.district}</p>}
                  <p>{order.shippingAddress.city} - {order.shippingAddress.state}</p>
                  <p>CEP {order.shippingAddress.postalCode} · {order.shippingAddress.countryCode}</p>
                  {order.shippingAddress.instructions && (
                    <p className="mt-3 rounded-lg bg-zinc-950 p-3 text-xs">{order.shippingAddress.instructions}</p>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-red-300">Endereço não recebido.</p>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
              <h2 className="text-lg font-semibold">Origem</h2>
              <p className="mt-3 text-sm text-zinc-400">{order.store.name}</p>
              <a
                href={order.store.baseUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block break-all text-xs text-emerald-400 hover:text-emerald-300"
              >
                {order.store.baseUrl}
              </a>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
