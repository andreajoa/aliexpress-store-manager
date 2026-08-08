"use client";

import { useState } from "react";

export function SupplierSyncButton({ productId }: { productId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/products/${encodeURIComponent(productId)}/suppliers/refresh-all`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok || (!data.ok && !data.partial)) {
        throw new Error(data.error || "Não foi possível sincronizar os fornecedores.");
      }
      setMessage(
        data.failedSuppliers
          ? `${data.refreshedSuppliers} fornecedor(es) atualizado(s); ${data.failedSuppliers} exigem atenção.`
          : `${data.refreshedSuppliers} fornecedor(es) atualizado(s) e disponibilidade recalculada.`,
      );
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível sincronizar os fornecedores.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-sky-900/70 bg-sky-950/20 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-sky-300">Disponibilidade multi-fornecedor</p>
          <p className="mt-1 text-xs text-zinc-400">
            Atualiza preço, estoque e SKUs de todos os fornecedores ativos e recalcula o estoque seguro das variantes da loja.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={sync}
          className="rounded-xl border border-sky-700 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-950/60 disabled:opacity-50"
        >
          {busy ? "Sincronizando…" : "Atualizar todos"}
        </button>
      </div>
      {message && <p className="mt-3 text-xs text-zinc-400">{message}</p>}
    </div>
  );
}
