"use client";

import { useState } from "react";

type Quote = {
  serviceName: string;
  estimatedDeliveryTime: string | null;
  amount: number | null;
  currency: string | null;
};

type Batch = {
  id: string;
  provider: string;
  status: string;
  externalOrderId: string | null;
  placementStatus?: string | null;
  logisticsServiceName?: string | null;
};

function AliExpressBatchControl({ orderId, batch }: { orderId: string; batch: Batch }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [service, setService] = useState(batch.logisticsServiceName || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const base = `/api/orders/${encodeURIComponent(orderId)}/fulfillment/batches/${encodeURIComponent(batch.id)}/aliexpress`;

  async function run(path: string, init?: RequestInit) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${base}/${path}`, { cache: "no-store", ...init });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Operação AliExpress falhou.");
      return data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operação AliExpress falhou.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function syncSkus() {
    const data = await run("sku-sync", { method: "POST" });
    if (data) setMessage("SKUs oficiais confirmados para este destino.");
  }

  async function quoteFreight() {
    const data = await run("quote");
    if (!data) return;
    setQuotes(data.quotes || []);
    if (!service && data.quotes?.length) setService(data.quotes[0].serviceName);
  }

  async function placeOrder() {
    if (!service) {
      setMessage("Calcule o frete e escolha um método de envio.");
      return;
    }
    if (!window.confirm("Criar agora o pedido NÃO PAGO no AliExpress com o endereço deste cliente?")) return;
    const data = await run("place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, logisticsServiceName: service }),
    });
    if (data) {
      const paymentUrl = data.result?.paymentUrl;
      if (paymentUrl) window.open(paymentUrl, "_blank", "noopener,noreferrer");
      window.location.reload();
    }
  }

  async function syncOrder() {
    const data = await run("sync", { method: "POST" });
    if (data) window.location.reload();
  }

  async function resolveUnknown() {
    if (!window.confirm("Confirme somente se você verificou no AliExpress que NENHUM pedido foi criado nessa tentativa. Liberar nova tentativa?")) return;
    const data = await run("resolve-unknown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmedNoOrderExists: true }),
    });
    if (data) window.location.reload();
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Lote {batch.id}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {batch.status}{batch.placementStatus ? ` · placement ${batch.placementStatus}` : ""}
          </p>
        </div>
        {batch.externalOrderId && (
          <span className="rounded-full bg-emerald-950 px-3 py-1 text-xs font-semibold text-emerald-300">
            AliExpress #{batch.externalOrderId}
          </span>
        )}
      </div>

      {batch.status === "PROCESSING" && batch.placementStatus !== "UNKNOWN" && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={syncSkus} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold disabled:opacity-50">
              Sincronizar SKU oficial
            </button>
            <button type="button" disabled={busy} onClick={quoteFreight} className="rounded-lg border border-sky-800 px-3 py-2 text-xs font-semibold text-sky-300 disabled:opacity-50">
              Calcular frete
            </button>
          </div>

          {quotes.length > 0 && (
            <div className="space-y-2">
              {quotes.map((quote) => (
                <label key={quote.serviceName} className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm">
                  <input type="radio" name={`freight-${batch.id}`} checked={service === quote.serviceName} onChange={() => setService(quote.serviceName)} />
                  <span>
                    <strong>{quote.serviceName}</strong>
                    <span className="ml-2 text-zinc-400">
                      {quote.amount === null ? "preço não informado" : `${quote.amount} ${quote.currency || ""}`}
                      {quote.estimatedDeliveryTime ? ` · ${quote.estimatedDeliveryTime}` : ""}
                    </span>
                  </span>
                </label>
              ))}
              <button type="button" disabled={busy || !service} onClick={placeOrder} className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">
                Criar pedido não pago no AliExpress
              </button>
            </div>
          )}
        </div>
      )}

      {batch.placementStatus === "UNKNOWN" && !batch.externalOrderId && (
        <div className="mt-4 rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200">
          O resultado da tentativa de criação ficou incerto. O Manager bloqueou novas tentativas para evitar pedido duplicado.
          <button type="button" disabled={busy} onClick={resolveUnknown} className="mt-3 block rounded-lg border border-amber-700 px-3 py-2 text-xs font-semibold disabled:opacity-50">
            Já verifiquei que nenhum pedido existe — liberar
          </button>
        </div>
      )}

      {["ORDERED", "SHIPPED"].includes(batch.status) && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={syncOrder} className="rounded-lg border border-sky-800 px-3 py-2 text-xs font-semibold text-sky-300 disabled:opacity-50">
            Sincronizar pedido e tracking
          </button>
          <a href="https://www.aliexpress.com/p/order/index.html" target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-800 px-3 py-2 text-xs font-semibold text-emerald-300">
            Abrir pedidos / pagamento ↗
          </a>
        </div>
      )}

      {busy && <p className="mt-3 text-xs text-zinc-500">Processando…</p>}
      {message && <p className="mt-3 text-xs text-zinc-400">{message}</p>}
    </div>
  );
}

export function AliExpressBatchPanel({ orderId, batches }: { orderId: string; batches: Batch[] }) {
  const aliExpressBatches = batches.filter((batch) => batch.provider === "ALIEXPRESS");
  if (aliExpressBatches.length === 0) return null;

  return (
    <section className="rounded-2xl border border-emerald-900/60 bg-zinc-900 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">AliExpress Open Platform</p>
      <h2 className="mt-2 text-xl font-semibold">Pedido automático do fornecedor</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
        O Manager usa o SKU oficial e o endereço do comprador para criar o pedido não pago. A confirmação do pagamento continua no ambiente AliExpress; nenhum cartão é armazenado aqui.
      </p>
      <div className="mt-5 space-y-3">
        {aliExpressBatches.map((batch) => <AliExpressBatchControl key={batch.id} orderId={orderId} batch={batch} />)}
      </div>
    </section>
  );
}
