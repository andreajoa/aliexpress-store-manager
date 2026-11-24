"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type UsAuditItem = {
  productId: string;
  sourceProductId: string;
  title: string;
  ambSlugs?: string[];
  isLinkedToAmb?: boolean;
  hasUsWarehouse?: boolean;
  hasUsInStock?: boolean;
  usTotalStock: number;
  dispatchCountry: string;
  deliveryMinDays: number | null;
  deliveryMaxDays: number | null;
  ambDisplayMinDays: number | null;
  ambDisplayMaxDays: number | null;
  error?: string | null;
};

type AuditState = {
  totalProducts: number;
  totalLinkedProducts: number;
  auditedCount: number;
  failedCount: number;
  pendingCount: number;
  updatedWithDaysCount: number;
  usInStockCount: number;
  usOutOfStockCount: number;
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
      totalProducts?: number;
      totalLinkedProducts?: number;
      auditedCount?: number;
      failedCount?: number;
      pendingCount?: number;
      updatedWithDaysCount?: number;
      usInStockCount?: number;
      usOutOfStockCount?: number;
      usWarehouseProducts?: UsAuditItem[];
    };
    if (!data.ok) return null;
    const list = data.usWarehouseProducts ?? [];
    const inStock = data.usInStockCount ?? list.filter((item) => item.hasUsInStock).length;
    return {
      totalProducts: data.totalProducts ?? 0,
      totalLinkedProducts: data.totalLinkedProducts ?? 0,
      auditedCount: data.auditedCount ?? 0,
      failedCount: data.failedCount ?? 0,
      pendingCount: data.pendingCount ?? 0,
      updatedWithDaysCount: data.updatedWithDaysCount ?? 0,
      usInStockCount: inStock,
      usOutOfStockCount: data.usOutOfStockCount ?? Math.max(0, list.length - inStock),
      usWarehouseProducts: list,
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
  const router = useRouter();
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
          : `AMB Boutique sincronizada agora! ${data.syncedProducts ?? 0} produtos com prazo dinâmico e status US Warehouse atualizados na loja.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao sincronizar com a AMB Boutique.");
    } finally {
      setSyncingAmb(false);
    }
  }, [router]);

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

      while (!stopRef.current && batchesRun < 140) {
        batchesRun++;
        let batchData: {
          ok?: boolean;
          done?: boolean;
          totalProducts?: number;
          totalLinkedProducts?: number;
          auditedCount?: number;
          pendingCount?: number;
          checked?: number;
          succeededCount?: number;
          rateLimited?: boolean;
          results?: Array<UsAuditItem & { checked?: boolean; updated?: boolean }>;
          error?: string;
        } | null = null;

        try {
          const response = await fetch("/api/products/warehouse-audit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ limit: 3 }),
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
            await new Promise((resolve) => setTimeout(resolve, 2500));
            continue;
          }
          throw new Error(`Auditoria pausada após falhas seguidas (${detail}). Clique em "Continuar auditoria" para retomar.`);
        }

        if (batchData.rateLimited) {
          setWarningMessage("AliExpress pediu pausa breve (AppApiCallLimit) — aguardando 4s antes do próximo lote...");
          await new Promise((resolve) => setTimeout(resolve, 4000));
        } else {
          setWarningMessage(null);
        }

        setState((prev) => {
          const existingMap = new Map((prev?.usWarehouseProducts || []).map((item) => [item.sourceProductId, item]));
          for (const item of batchData?.results || []) {
            if (item.hasUsWarehouse || item.hasUsInStock) {
              existingMap.set(item.sourceProductId, item);
            }
          }
          const mergedList = [...existingMap.values()].sort((a, b) => {
            if (Boolean(a.hasUsInStock) !== Boolean(b.hasUsInStock)) return a.hasUsInStock ? -1 : 1;
            return b.usTotalStock - a.usTotalStock;
          });
          const inStock = mergedList.filter((item) => item.hasUsInStock).length;
          return {
            totalProducts: batchData?.totalProducts ?? prev?.totalProducts ?? totalProducts,
            totalLinkedProducts: batchData?.totalLinkedProducts ?? prev?.totalLinkedProducts ?? 0,
            auditedCount: batchData?.auditedCount ?? prev?.auditedCount ?? 0,
            failedCount: prev?.failedCount ?? 0,
            pendingCount: batchData?.pendingCount ?? prev?.pendingCount ?? 0,
            updatedWithDaysCount: (prev?.updatedWithDaysCount ?? 0) + (batchData?.results?.filter((r) => r.updated).length ?? 0),
            usInStockCount: inStock,
            usOutOfStockCount: mergedList.length - inStock,
            usWarehouseProducts: mergedList,
          };
        });

        if (batchData.done || (batchData.pendingCount ?? 0) === 0 || (batchData.checked ?? 0) === 0) {
          break;
        }
      }

      await loadSummary();
      router.refresh();
      if (!stopRef.current) {
        await syncWithAmbBoutique();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao auditar catálogo.");
      await loadSummary();
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  const totalScope = state?.totalProducts ?? totalProducts;
  const audited = state?.auditedCount ?? 0;
  const failed = state?.failedCount ?? 0;
  const pending = state?.pendingCount ?? 0;
  const pct = totalScope > 0 ? Math.round((audited / totalScope) * 100) : 0;
  const usItems = state?.usWarehouseProducts ?? [];
  const usInStockDisplay = state ? state.usInStockCount : initialUsCount;
  const usOutOfStockDisplay = state ? state.usOutOfStockCount : 0;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
            Auditoria de Armazém EUA · Todos os Fornecedores
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {usInStockDisplay} com estoque nos EUA
            {usOutOfStockDisplay > 0 ? ` · ${usOutOfStockDisplay} US sem estoque` : ""} (de {totalScope} produtos)
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Audita todos os {totalScope} produtos em cadência segura (evitando AppApiCallLimit), separa US com estoque vs sem estoque e sincroniza o selo &ldquo;Ships from U.S.&rdquo; na AMB Boutique.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {running ? (
            <button
              type="button"
              onClick={() => { stopRef.current = true; }}
              className="rounded-xl border border-amber-700 bg-amber-950/60 px-4 py-3 text-sm font-semibold text-amber-200 hover:bg-amber-950"
            >
              Pausar ({audited}/{totalScope || "..."})
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
                : totalScope > 0 && pending === 0
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

      {totalScope > 0 && (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Auditados com sucesso: <strong>{audited}/{totalScope} ({pct}%)</strong>
              {" · "}Pendentes: <strong>{pending}</strong>
              {failed > 0 ? (
                <>
                  {" · "}Falhas/Rate-limit a reprocessar: <strong className="text-amber-300">{failed}</strong>
                </>
              ) : null}
              {" · "}US em estoque: <strong className="text-emerald-400">{usInStockDisplay}</strong>
            </span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all duration-300"
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
            Fornecedores com Armazém nos EUA ({usItems.length})
          </p>
          {usItems.map((item) => {
            const inStock = Boolean(item.hasUsInStock);
            return (
              <div
                key={item.sourceProductId}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-xs ${
                  inStock
                    ? "border-emerald-900/60 bg-emerald-950/25"
                    : "border-amber-900/50 bg-amber-950/20"
                }`}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <a
                    href={`/products/${item.productId}`}
                    className={`font-medium underline-offset-2 hover:underline ${
                      inStock ? "text-emerald-200" : "text-amber-200"
                    }`}
                  >
                    {item.title}
                  </a>
                  {item.isLinkedToAmb ? (
                    <span className="rounded border border-emerald-800/70 bg-emerald-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                      Na loja AMB ({item.ambSlugs?.length || 1})
                    </span>
                  ) : (
                    <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                      Importado
                    </span>
                  )}
                </div>
                <span className={inStock ? "text-emerald-300" : "text-amber-300"}>
                  {inStock
                    ? `US Warehouse · ${item.usTotalStock} un.`
                    : "US Warehouse · Sem estoque (0 un. · oculto na loja)"}
                  {item.deliveryMinDays != null
                    ? ` · Fornecedor ${item.deliveryMinDays === item.deliveryMaxDays ? `${item.deliveryMinDays}d` : `${item.deliveryMinDays}–${item.deliveryMaxDays}d`}`
                    : ""}
                  {item.ambDisplayMinDays != null ? ` (AMB: ${item.ambDisplayMinDays}–${item.ambDisplayMaxDays}d)` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-400">{error}</p>
      )}
    </section>
  );
}
