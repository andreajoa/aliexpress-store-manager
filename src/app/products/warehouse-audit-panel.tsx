"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type UsAuditItem = {
  productId: string;
  sourceProductId: string;
  title: string;
  usTotalStock: number;
  dispatchCountry: string;
  deliveryMinDays: number | null;
  deliveryMaxDays: number | null;
  ambDisplayMinDays: number | null;
  ambDisplayMaxDays: number | null;
};

type AuditState = {
  totalLinkedProducts: number;
  auditedCount: number;
  pendingCount: number;
  updatedWithDaysCount: number;
  usWarehouseProducts: UsAuditItem[];
};

async function fetchAuditSummary(signal?: AbortSignal): Promise<AuditState | null> {
  try {
    const res = await fetch("/api/products/warehouse-audit", {
      cache: "no-store",
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      totalLinkedProducts?: number;
      auditedCount?: number;
      pendingCount?: number;
      updatedWithDaysCount?: number;
      usWarehouseProducts?: UsAuditItem[];
    };
    if (!data.ok) return null;
    return {
      totalLinkedProducts: data.totalLinkedProducts ?? 0,
      auditedCount: data.auditedCount ?? 0,
      pendingCount: data.pendingCount ?? 0,
      updatedWithDaysCount: data.updatedWithDaysCount ?? 0,
      usWarehouseProducts: data.usWarehouseProducts ?? [],
    };
  } catch {
    return null;
  }
}

export function WarehouseAuditPanel({
  initialUsCount,
  totalProducts,
}: {
  initialUsCount: number;
  totalProducts: number;
}) {
  const [state, setState] = useState<AuditState | null>(null);
  const [running, setRunning] = useState(false);
  const [syncingAmb, setSyncingAmb] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  const loadSummary = useCallback(async () => {
    const summary = await fetchAuditSummary();
    if (summary) setState(summary);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void fetchAuditSummary(controller.signal).then((summary) => {
      if (active && summary) setState(summary);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const syncWithAmbBoutique = useCallback(async () => {
    setSyncingAmb(true);
    setSyncMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/products/warehouse-audit/sync-amb", {
        method: "POST",
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        syncedProducts?: number;
        throttled?: boolean;
        error?: string;
      } | null;

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Falha ao sincronizar com a AMB (HTTP ${response.status}).`);
      }

      setSyncMessage(
        data.throttled
          ? `AMB Boutique já sincronizada há poucos segundos (${data.syncedProducts ?? 0} produtos atualizados).`
          : `AMB Boutique sincronizada agora! ${data.syncedProducts ?? 0} produtos com prazo dinâmico atualizados na loja.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao sincronizar com a AMB Boutique.");
    } finally {
      setSyncingAmb(false);
    }
  }, []);

  async function runAudit(resetFirst = false) {
    setRunning(true);
    setError(null);
    setWarningMessage(null);
    setSyncMessage(null);
    stopRef.current = false;

    try {
      if (resetFirst) {
        const resetRes = await fetch("/api/products/warehouse-audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reset: true }),
        });
        if (!resetRes.ok) throw new Error("Não foi possível reiniciar a auditoria.");
        await loadSummary();
      }

      let consecutiveFailures = 0;
      let batchesRun = 0;

      while (!stopRef.current && batchesRun < 80) {
        batchesRun++;
        let batchData: {
          ok?: boolean;
          done?: boolean;
          totalLinkedProducts?: number;
          auditedCount?: number;
          pendingCount?: number;
          checked?: number;
          results?: Array<UsAuditItem & { hasUsInStock?: boolean; updated?: boolean }>;
          error?: string;
        } | null = null;

        try {
          const response = await fetch("/api/products/warehouse-audit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ limit: 5 }),
          });
          batchData = await response.json().catch(() => null);
          if (!response.ok || !batchData?.ok) {
            throw new Error(batchData?.error || `Lote retornou HTTP ${response.status}`);
          }
          consecutiveFailures = 0;
        } catch (batchErr) {
          consecutiveFailures++;
          const detail = batchErr instanceof Error ? batchErr.message : "tempo excedido";
          if (consecutiveFailures <= 2) {
            setWarningMessage(`Oscilação temporária na API (${detail}) — tentando continuar automaticamente...`);
            await new Promise((resolve) => setTimeout(resolve, 1500));
            continue;
          }
          throw new Error(`Auditoria pausada após falhas seguidas (${detail}). Clique em "Continuar auditoria" para retomar de onde parou.`);
        }

        setWarningMessage(null);
        setState((prev) => {
          const existingMap = new Map((prev?.usWarehouseProducts || []).map((item) => [item.sourceProductId, item]));
          for (const item of batchData?.results || []) {
            if (item.hasUsInStock) {
              existingMap.set(item.sourceProductId, item);
            }
          }
          return {
            totalLinkedProducts: batchData?.totalLinkedProducts ?? prev?.totalLinkedProducts ?? 0,
            auditedCount: batchData?.auditedCount ?? prev?.auditedCount ?? 0,
            pendingCount: batchData?.pendingCount ?? prev?.pendingCount ?? 0,
            updatedWithDaysCount: (prev?.updatedWithDaysCount ?? 0) + (batchData?.results?.filter((r) => r.updated).length ?? 0),
            usWarehouseProducts: [...existingMap.values()],
          };
        });

        if (batchData.done || (batchData.pendingCount ?? 0) === 0 || (batchData.checked ?? 0) === 0) {
          break;
        }
      }

      await loadSummary();
      if (!stopRef.current) {
        await syncWithAmbBoutique();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao auditar catálogo.");
      await loadSummary();
    } finally {
      setRunning(false);
    }
  }

  const totalLinked = state?.totalLinkedProducts ?? 0;
  const audited = state?.auditedCount ?? 0;
  const pending = state?.pendingCount ?? 0;
  const pct = totalLinked > 0 ? Math.round((audited / totalLinked) * 100) : 0;
  const usItems = state?.usWarehouseProducts ?? [];
  const usCountDisplay = state ? usItems.length : initialUsCount;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-400">
            Auditoria de Armazém EUA · Catálogo AMB
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {usCountDisplay} de {totalProducts} produtos com estoque nos EUA
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Audita em lotes rápidos de 5 produtos, salva progresso automático (retoma de onde parou sem voltar do zero) e sincroniza direto na AMB Boutique ao terminar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {running ? (
            <button
              type="button"
              onClick={() => { stopRef.current = true; }}
              className="rounded-xl border border-amber-700 bg-amber-950/60 px-4 py-3 text-sm font-semibold text-amber-200 hover:bg-amber-950"
            >
              Pausar ({audited}/{totalLinked || "..."})
            </button>
          ) : (
            <button
              type="button"
              disabled={syncingAmb}
              onClick={() => void runAudit(false)}
              className="rounded-xl bg-sky-400 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-sky-300 disabled:opacity-50"
            >
              {pending > 0 && audited > 0
                ? `Continuar auditoria (faltam ${pending})`
                : totalLinked > 0 && pending === 0
                  ? "Auditoria 100% em dia"
                  : "Auditar Armazém EUA e Prazos"}
            </button>
          )}

          {!running && audited > 0 && (
            <button
              type="button"
              disabled={syncingAmb}
              onClick={() => void runAudit(true)}
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Reauditar do zero
            </button>
          )}

          <button
            type="button"
            disabled={syncingAmb || running}
            onClick={() => void syncWithAmbBoutique()}
            className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {syncingAmb ? "Sincronizando AMB..." : "Sync now · Enviar pra AMB"}
          </button>
        </div>
      </div>

      {totalLinked > 0 && (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Progresso: <strong>{audited}/{totalLinked} ({pct}%)</strong> · Faltam: <strong>{pending}</strong> · Armazém EUA: <strong className="text-emerald-400">{usItems.length}</strong>
            </span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-sky-400 transition-all duration-300"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>
      )}

      {warningMessage && (
        <p className="mt-3 text-xs text-amber-300">{warningMessage}</p>
      )}

      {syncMessage && (
        <div className="mt-3 rounded-xl border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">
          {syncMessage}
        </div>
      )}

      {usItems.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Produtos da loja com estoque nos EUA ({usItems.length})
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
                US Warehouse · {item.usTotalStock} un.
                {item.deliveryMinDays != null
                  ? ` · Fornecedor ${item.deliveryMinDays === item.deliveryMaxDays ? `${item.deliveryMinDays}d` : `${item.deliveryMinDays}–${item.deliveryMaxDays}d`}`
                  : ""}
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
