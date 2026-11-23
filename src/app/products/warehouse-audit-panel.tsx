"use client";

import { useState } from "react";

type AuditItem = {
  productId: string;
  sourceProductId: string;
  title: string;
  hasUsWarehouse: boolean;
  hasUsInStock: boolean;
  dispatchCountry: string;
  deliveryMinDays: number | null;
  deliveryMaxDays: number | null;
  ambDisplayMinDays: number | null;
  ambDisplayMaxDays: number | null;
  updated: boolean;
  error: string | null;
};

export function WarehouseAuditPanel({
  initialUsCount,
  totalProducts,
}: {
  initialUsCount: number;
  totalProducts: number;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ checked: number; total: number; usFound: number; updated: number } | null>(null);
  const [usItems, setUsItems] = useState<AuditItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function runFullAudit() {
    setRunning(true);
    setError(null);
    setUsItems([]);
    let offset = 0;
    let total = 0;
    let checkedTotal = 0;
    let usTotal = 0;
    let updatedTotal = 0;
    const foundUs: AuditItem[] = [];

    try {
      while (true) {
        const response = await fetch("/api/products/warehouse-audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset, limit: 12 }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          done?: boolean;
          nextOffset?: number | null;
          totalLinkedProducts?: number;
          checked?: number;
          usFound?: number;
          updatedDeliveryCount?: number;
          results?: AuditItem[];
          error?: string;
        };

        if (!response.ok || !data.ok) {
          throw new Error(data.error || "Falha ao auditar produtos.");
        }

        total = data.totalLinkedProducts ?? total;
        checkedTotal += data.checked ?? 0;
        usTotal += data.usFound ?? 0;
        updatedTotal += data.updatedDeliveryCount ?? 0;

        for (const item of data.results || []) {
          if (item.hasUsInStock) foundUs.push(item);
        }

        setProgress({ checked: checkedTotal, total, usFound: usTotal, updated: updatedTotal });
        setUsItems([...foundUs]);

        if (data.done || data.nextOffset == null) break;
        offset = data.nextOffset;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao auditar catálogo.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-400">
            Auditoria de Armazém EUA · Catálogo Atual
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {initialUsCount} de {totalProducts} produtos já possuem estoque nos EUA no banco
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Varre os produtos vinculados na AMB direto na API oficial do AliExpress para detectar armazéns nos EUA e atualizar os prazos de entrega reais imediatamente.
          </p>
        </div>

        <button
          type="button"
          disabled={running}
          onClick={() => void runFullAudit()}
          className="shrink-0 rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-sky-300 disabled:opacity-50"
        >
          {running ? "Auditando na API..." : "Auditar Armazém EUA e Prazos"}
        </button>
      </div>

      {progress && (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
          Verificados: <strong>{progress.checked}/{progress.total}</strong> fornecedores vinculados ·{" "}
          Armazém EUA com estoque: <strong className="text-emerald-400">{progress.usFound}</strong> ·{" "}
          Prazos atualizados no banco: <strong className="text-sky-300">{progress.updated}</strong>
        </div>
      )}

      {usItems.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Produtos da loja com estoque ativo nos EUA
          </p>
          {usItems.map((item) => (
            <div
              key={item.sourceProductId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-900/50 bg-emerald-950/20 px-4 py-2.5 text-xs"
            >
              <a href={`/products/${item.productId}`} className="font-medium text-emerald-200 underline-offset-2 hover:underline">
                {item.title}
              </a>
              <span className="text-emerald-300">
                US Warehouse · Fornecedor {item.deliveryMinDays ?? "?"}–{item.deliveryMaxDays ?? "?"}d
                {item.ambDisplayMinDays != null ? ` (AMB: ${item.ambDisplayMinDays}–${item.ambDisplayMaxDays}d)` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-400">{error}</p>
      )}
    </section>
  );
}
