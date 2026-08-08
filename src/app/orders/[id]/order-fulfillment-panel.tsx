"use client";

import { useState } from "react";

import { SupplierSwitchControl } from "./supplier-switch-control";

type Plan = {
  ready: boolean;
  frozen: boolean;
  requiresReview: boolean;
  blockers: Array<{ code: string; detail: string }>;
  batches: Array<{
    supplierProductId: string;
    provider: string;
    sourceProductId: string;
    sourceUrl: string;
    currency: string | null;
    role: string;
    items: Array<{
      orderItemId: string;
      title: string;
      sourceSkuId: string;
      quantity: number;
      sourceUnitCost: number;
    }>;
  }>;
};

type Batch = {
  id: string;
  provider: string;
  sourceProductId: string;
  sourceUrl: string;
  currency: string | null;
  status: string;
  externalOrderId: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  items: Array<{
    id: string;
    title: string;
    sourceSkuId: string | null;
    quantity: number;
    unitCost: string | null;
  }>;
};

function BatchControls({
  orderId,
  batch,
}: {
  orderId: string;
  batch: Batch;
}) {
  const [externalOrderId, setExternalOrderId] = useState(batch.externalOrderId || "");
  const [trackingCode, setTrackingCode] = useState(batch.trackingCode || "");
  const [trackingUrl, setTrackingUrl] = useState(batch.trackingUrl || "");
  const [carrier, setCarrier] = useState(batch.carrier || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function recordOrder() {
    if (!externalOrderId.trim()) {
      setMessage("Informe o número do pedido realizado no fornecedor.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/fulfillment/batches/${encodeURIComponent(batch.id)}/ordered`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true, externalOrderId: externalOrderId.trim() }),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Pedido externo não registrado.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pedido externo não registrado.");
    } finally {
      setBusy(false);
    }
  }

  async function updateTracking(status: "SHIPPED" | "DELIVERED") {
    if (!trackingCode.trim() && !batch.trackingCode) {
      setMessage("Informe o código de rastreamento.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/fulfillment/batches/${encodeURIComponent(batch.id)}/tracking`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            trackingCode: trackingCode.trim() || undefined,
            trackingUrl: trackingUrl.trim() || undefined,
            carrier: carrier.trim() || undefined,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Rastreamento não atualizado.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rastreamento não atualizado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-400">
            {batch.provider} · {batch.status}
          </p>
          <p className="mt-2 font-semibold">Produto fornecedor {batch.sourceProductId}</p>
          <p className="mt-1 text-xs text-zinc-500">Lote {batch.id}</p>
        </div>
        <a
          href={batch.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-sky-800 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-950/50"
        >
          Abrir no fornecedor ↗
        </a>
      </div>

      <div className="mt-4 space-y-2">
        {batch.items.map((item) => (
          <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-sm">
            <p>{item.title}</p>
            <p className="mt-1 text-xs text-zinc-500">
              SKU {item.sourceSkuId || "—"} · quantidade {item.quantity} · custo {item.unitCost || "—"} {batch.currency || ""}
            </p>
          </div>
        ))}
      </div>

      {batch.status === "PROCESSING" && (
        <div className="mt-4">
          <SupplierSwitchControl orderId={orderId} batchId={batch.id} />
        </div>
      )}

      {batch.status === "PROCESSING" && (
        <div className="mt-4 border-t border-zinc-800 pt-4">
          <label className="text-xs text-zinc-500">Número do pedido feito no fornecedor</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={externalOrderId}
              onChange={(event) => setExternalOrderId(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              placeholder="Ex.: 1234567890"
            />
            <button
              type="button"
              disabled={busy}
              onClick={recordOrder}
              className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
            >
              Registrar compra
            </button>
          </div>
        </div>
      )}

      {["ORDERED", "SHIPPED"].includes(batch.status) && (
        <div className="mt-4 grid gap-3 border-t border-zinc-800 pt-4 sm:grid-cols-3">
          <input
            value={trackingCode}
            onChange={(event) => setTrackingCode(event.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            placeholder="Código de rastreamento"
          />
          <input
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            placeholder="Transportadora"
          />
          <input
            value={trackingUrl}
            onChange={(event) => setTrackingUrl(event.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            placeholder="URL de rastreio"
          />
          <div className="flex gap-2 sm:col-span-3">
            {batch.status === "ORDERED" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => updateTracking("SHIPPED")}
                className="rounded-lg border border-sky-700 px-4 py-2 text-sm font-semibold text-sky-300 disabled:opacity-50"
              >
                Marcar enviado
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => updateTracking("DELIVERED")}
              className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-300 disabled:opacity-50"
            >
              Marcar entregue
            </button>
          </div>
        </div>
      )}

      {batch.status === "DELIVERED" && (
        <p className="mt-4 rounded-lg bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Lote entregue ao cliente.
        </p>
      )}

      {message && <p className="mt-3 text-xs text-zinc-400">{message}</p>}
    </div>
  );
}

export function OrderFulfillmentPanel({
  orderId,
  fulfillmentStatus,
  batches,
}: {
  orderId: string;
  fulfillmentStatus: string;
  batches: Batch[];
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function calculatePlan() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/fulfillment/plan`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!data.plan) throw new Error(data.error || "Plano indisponível.");
      setPlan(data.plan as Plan);
      if (!data.plan.ready) setMessage("O plano possui bloqueios que precisam ser resolvidos.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Plano indisponível.");
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    if (!plan?.ready || plan.requiresReview) {
      setMessage("Calcule e valide um plano seguro antes de preparar o fulfillment.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/fulfillment/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Fulfillment não preparado.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fulfillment não preparado.");
    } finally {
      setBusy(false);
    }
  }

  async function copyPackage() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/fulfillment/package`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Pacote indisponível.");
      await navigator.clipboard.writeText(JSON.stringify(data.package, null, 2));
      setMessage("Pacote de fulfillment copiado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível copiar o pacote.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
            Fulfillment Engine
          </p>
          <h2 className="mt-2 text-xl font-semibold">Fornecedor, compra e rastreio</h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            A seleção usa mapping, estoque reservado, dados recentes e a política Principal → Reserva → Alternativo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {fulfillmentStatus === "UNFULFILLED" && (
            <button
              type="button"
              disabled={busy}
              onClick={calculatePlan}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy ? "Calculando…" : "Calcular plano"}
            </button>
          )}
          {batches.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={copyPackage}
              className="rounded-lg border border-sky-800 px-4 py-2 text-sm font-semibold text-sky-300 hover:bg-sky-950/40 disabled:opacity-50"
            >
              Copiar pacote
            </button>
          )}
        </div>
      </div>

      {plan && fulfillmentStatus === "UNFULFILLED" && (
        <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${plan.ready ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"}`}>
              {plan.ready ? "Plano pronto" : "Plano bloqueado"}
            </span>
            <span className="text-xs text-zinc-500">{plan.batches.length} lote(s)</span>
          </div>

          {plan.blockers.length > 0 && (
            <div className="mt-4 space-y-2">
              {plan.blockers.map((blocker, index) => (
                <div key={`${blocker.code}-${index}`} className="rounded-lg border border-red-900/70 bg-red-950/20 p-3 text-sm text-red-200">
                  <strong>{blocker.code}</strong> · {blocker.detail}
                </div>
              ))}
            </div>
          )}

          {plan.ready && (
            <div className="mt-4 space-y-3">
              {plan.batches.map((batch) => (
                <div key={batch.supplierProductId} className="rounded-lg border border-zinc-800 p-3">
                  <p className="text-sm font-medium">{batch.role} · {batch.provider} {batch.sourceProductId}</p>
                  <div className="mt-2 space-y-1 text-xs text-zinc-500">
                    {batch.items.map((item) => (
                      <p key={item.orderItemId}>
                        {item.title} · SKU {item.sourceSkuId} · qtd. {item.quantity} · custo {item.sourceUnitCost} {batch.currency || ""}
                      </p>
                    ))}
                  </div>
                </div>
              ))}

              <button
                type="button"
                disabled={busy}
                onClick={prepare}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
              >
                Confirmar e fixar fornecedores
              </button>
            </div>
          )}
        </div>
      )}

      {batches.length > 0 && (
        <div className="mt-6 space-y-4">
          {batches.map((batch) => (
            <BatchControls key={batch.id} orderId={orderId} batch={batch} />
          ))}
        </div>
      )}

      {message && <p className="mt-4 text-sm text-zinc-400">{message}</p>}
    </section>
  );
}
