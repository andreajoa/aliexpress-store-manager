"use client";

import { useCallback, useEffect, useState } from "react";

type ScanState = {
  lastScannedAt: string | null;
  totalProducts: number;
  mappedProducts: number;
  pending: unknown[];
  removedProducts: unknown[];
  changedVariants: number;
  registeredExports: number;
};

const emptyState: ScanState = {
  lastScannedAt: null,
  totalProducts: 0,
  mappedProducts: 0,
  pending: [],
  removedProducts: [],
  changedVariants: 0,
  registeredExports: 0,
};

export function AmbCatalogPanel({ storeId }: { storeId: string }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ScanState>(emptyState);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/amb/catalog/scan`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Status indisponível.");
    setState({
      lastScannedAt: data.lastScannedAt || null,
      totalProducts: Number(data.totalProducts) || 0,
      mappedProducts: Number(data.mappedProducts) || 0,
      pending: Array.isArray(data.pending) ? data.pending : [],
      removedProducts: Array.isArray(data.removedProducts) ? data.removedProducts : [],
      changedVariants: Number(data.changedVariants) || 0,
      registeredExports: Number(data.registeredExports) || 0,
    });
  }, [storeId]);

  useEffect(() => {
    loadStatus().catch((error) => {
      setMessage(error instanceof Error ? error.message : "Status indisponível.");
    });
  }, [loadStatus]);

  async function scanNow() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/amb/catalog/scan`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Scan não concluído.");
      await loadStatus();
      setMessage(
        `Scan concluído: ${Number(data.totalProducts) || 0} produtos, ${Number(data.autoMapped) || 0} novos vínculos automáticos, ${Number(data.pending) || 0} pendências.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scan não concluído.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-sky-900/70 bg-sky-950/15 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-sky-200">AMB catálogo operacional</p>
          <p className="mt-1 max-w-2xl text-xs text-zinc-500">
            Detecta novos produtos que chegaram à AMB a partir dos ZIPs exportados pelo Manager e mantém o vínculo oculto com produto, cor, tamanho e SKU do fornecedor.
          </p>
          <p className="mt-2 text-xs text-zinc-400">
            {state.mappedProducts} vinculados · {state.totalProducts} vistos na loja · {state.registeredExports} exportações registradas
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {state.lastScannedAt ? `Último scan: ${new Date(state.lastScannedAt).toLocaleString("pt-BR")}` : "Ainda sem scan registrado."}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={scanNow}
          className="rounded-lg border border-sky-800 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-950/50 disabled:opacity-50"
        >
          {busy ? "Analisando…" : "Scan AMB now"}
        </button>
      </div>

      {(state.pending.length > 0 || state.changedVariants > 0 || state.removedProducts.length > 0) && (
        <div className="mt-4 rounded-lg border border-amber-900 bg-amber-950/20 p-3 text-xs text-amber-200">
          {state.pending.length > 0 ? `${state.pending.length} vínculo(s) exigem revisão. ` : ""}
          {state.changedVariants > 0 ? `${state.changedVariants} produto(s) tiveram tamanhos alterados. ` : ""}
          {state.removedProducts.length > 0 ? `${state.removedProducts.length} slug(s) mapeados não aparecem mais no catálogo.` : ""}
        </div>
      )}

      {state.pending.length === 0 && state.mappedProducts > 0 && (
        <div className="mt-4 rounded-lg border border-emerald-900 bg-emerald-950/20 p-3 text-xs text-emerald-300">
          Nenhum vínculo ambíguo no último scan.
        </div>
      )}

      {message && <p className="mt-3 text-xs text-zinc-400">{message}</p>}
    </div>
  );
}
