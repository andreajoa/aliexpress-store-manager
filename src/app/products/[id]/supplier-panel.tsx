"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CanonicalVariant = {
  id: string;
  name: string;
};

type SupplierVariant = {
  id: string;
  sourceSkuId: string;
  name: string;
  sourcePrice: string | null;
  stock: number;
};

type SupplierMapping = {
  canonicalVariantId: string;
  supplierVariantId: string;
  active: boolean;
};

type Supplier = {
  id: string;
  sourceProductId: string;
  sourceUrl: string;
  sellerName: string | null;
  role: "PRIMARY" | "BACKUP" | "ALTERNATIVE";
  priority: number;
  status: string;
  sourceCurrency: string | null;
  costMin: string | null;
  costMax: string | null;
  lastCheckedAt: string | null;
  variants: SupplierVariant[];
  mappings: SupplierMapping[];
};

type SupplierWithUrls = Supplier & {
  baseUrl: string;
  mappingUrl: string;
  refreshUrl: string;
};

function roleLabel(role: Supplier["role"]) {
  if (role === "PRIMARY") return "Principal";
  if (role === "BACKUP") return "Reserva";
  return "Alternativo";
}

function SupplierCard({
  supplier,
  canonicalVariants,
  onReload,
}: {
  supplier: SupplierWithUrls;
  canonicalVariants: CanonicalVariant[];
  onReload: () => Promise<void>;
}) {
  const initialMapping = useMemo(() => {
    const result: Record<string, string> = {};
    for (const mapping of supplier.mappings) {
      if (mapping.active) {
        result[mapping.canonicalVariantId] = mapping.supplierVariantId;
      }
    }
    return result;
  }, [supplier.mappings]);

  const [mapping, setMapping] = useState<Record<string, string>>(initialMapping);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setMapping(initialMapping);
  }, [initialMapping]);

  const mappedCount = supplier.mappings.filter((item) => item.active).length;
  const complete = canonicalVariants.length > 0 && mappedCount === canonicalVariants.length;
  const totalStock = supplier.variants.reduce((total, variant) => total + variant.stock, 0);

  async function action(name: string, fn: () => Promise<Response>) {
    setBusy(name);
    setMessage(null);
    try {
      const response = await fn();
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Operação não concluída.");
      }
      setMessage("Atualizado com sucesso.");
      await onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operação não concluída.");
    } finally {
      setBusy(null);
    }
  }

  async function saveMapping() {
    const mappings = canonicalVariants.map((variant) => ({
      canonicalVariantId: variant.id,
      supplierVariantId: mapping[variant.id] || "",
    }));

    if (mappings.some((item) => !item.supplierVariantId)) {
      setMessage("Mapeie todas as variantes antes de salvar.");
      return;
    }

    setBusy("mapping");
    setMessage(null);

    try {
      const response = await fetch(supplier.mappingUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        const details = Array.isArray(data.issues) ? ` ${data.issues.join(" · ")}` : "";
        throw new Error((data.error || "Mapping não salvo.") + details);
      }

      setMessage("Mapping confirmado.");
      await onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mapping não salvo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs font-semibold text-zinc-300">
              {roleLabel(supplier.role)}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                complete
                  ? "bg-emerald-950 text-emerald-300"
                  : "bg-amber-950 text-amber-300"
              }`}
            >
              {complete ? "Mapping completo" : `${mappedCount}/${canonicalVariants.length} mapeadas`}
            </span>
            {supplier.status !== "ACTIVE" && (
              <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400">
                {supplier.status}
              </span>
            )}
          </div>

          <p className="mt-3 font-medium">
            {supplier.sellerName || `AliExpress ${supplier.sourceProductId}`}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            ID {supplier.sourceProductId} · estoque {totalStock}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            custo {supplier.costMin || "—"}–{supplier.costMax || "—"} {supplier.sourceCurrency || ""}
          </p>
          {supplier.lastCheckedAt && (
            <p className="mt-1 text-xs text-zinc-600">
              atualizado {new Date(supplier.lastCheckedAt).toLocaleString("pt-BR")}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || supplier.status === "DISABLED"}
            onClick={() => action("refresh", () => fetch(supplier.refreshUrl, { method: "POST" }))}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-xs hover:bg-zinc-900 disabled:opacity-50"
          >
            {busy === "refresh" ? "Atualizando…" : "Atualizar dados"}
          </button>

          {supplier.role !== "PRIMARY" && supplier.status === "ACTIVE" && complete && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                action("primary", () =>
                  fetch(supplier.baseUrl, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ role: "PRIMARY" }),
                  }),
                )
              }
              className="rounded-lg border border-emerald-800 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-50"
            >
              Tornar principal
            </button>
          )}

          {supplier.role !== "PRIMARY" && supplier.status !== "DISABLED" && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => action("disable", () => fetch(supplier.baseUrl, { method: "DELETE" }))}
              className="rounded-lg border border-red-900 px-3 py-2 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-50"
            >
              Desativar
            </button>
          )}
        </div>
      </div>

      {!complete && supplier.status === "ACTIVE" && (
        <div className="mt-5 border-t border-zinc-800 pt-5">
          <p className="text-sm font-medium">Mapping manual obrigatório</p>
          <p className="mt-1 text-xs text-zinc-500">
            Cada variante da loja deve apontar para exatamente um SKU deste fornecedor.
          </p>

          <div className="mt-4 space-y-3">
            {canonicalVariants.map((variant) => (
              <label
                key={variant.id}
                className="grid gap-2 sm:grid-cols-[1fr_1.2fr] sm:items-center"
              >
                <span className="text-sm text-zinc-300">{variant.name}</span>
                <select
                  value={mapping[variant.id] || ""}
                  onChange={(event) =>
                    setMapping((current) => ({
                      ...current,
                      [variant.id]: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                >
                  <option value="">Selecione o SKU correspondente</option>
                  {supplier.variants.map((supplierVariant) => (
                    <option key={supplierVariant.id} value={supplierVariant.id}>
                      {supplierVariant.name} · SKU {supplierVariant.sourceSkuId} · estoque {supplierVariant.stock}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={busy !== null}
            onClick={saveMapping}
            className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
          >
            {busy === "mapping" ? "Salvando…" : "Confirmar mapping"}
          </button>
        </div>
      )}

      {message && <p className="mt-4 text-xs text-zinc-400">{message}</p>}
    </div>
  );
}

export function SupplierPanel({
  productId,
  canonicalVariants,
}: {
  productId: string;
  canonicalVariants: CanonicalVariant[];
}) {
  const [suppliers, setSuppliers] = useState<SupplierWithUrls[]>([]);
  const [url, setUrl] = useState("");
  const [role, setRole] = useState<"PRIMARY" | "BACKUP" | "ALTERNATIVE">("ALTERNATIVE");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/products/${encodeURIComponent(productId)}/suppliers`, {
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Não foi possível carregar fornecedores.");
    }

    setSuppliers(
      (data.suppliers as Supplier[]).map((supplier) => ({
        ...supplier,
        baseUrl: `/api/products/${encodeURIComponent(productId)}/suppliers/${encodeURIComponent(supplier.id)}`,
        mappingUrl: `/api/products/${encodeURIComponent(productId)}/suppliers/${encodeURIComponent(supplier.id)}/mapping`,
        refreshUrl: `/api/products/${encodeURIComponent(productId)}/suppliers/${encodeURIComponent(supplier.id)}/refresh`,
      })),
    );
  }, [productId]);

  useEffect(() => {
    void load().catch((error) =>
      setMessage(error instanceof Error ? error.message : "Falha ao carregar fornecedores."),
    );
  }, [load]);

  async function addSupplier() {
    if (!url.trim()) {
      setMessage("Cole a URL do novo fornecedor do AliExpress.");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}/suppliers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), role }),
      });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Fornecedor não adicionado.");
      }

      setUrl("");
      setMessage(
        data.mappingStatus === "CONFIRMED_AUTO"
          ? "Fornecedor adicionado com mapping automático confirmado."
          : "Fornecedor adicionado. Revise o mapping antes de usá-lo em pedidos.",
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fornecedor não adicionado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-400">
          Supplier Engine
        </p>
        <h2 className="mt-2 text-xl font-semibold">Fornecedores e Mapping</h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          O produto comercial permanece o mesmo. Cada fornecedor pode ter SKUs próprios, mas só fica apto a atender pedidos quando todas as variantes estiverem mapeadas 1:1.
        </p>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_170px_150px]">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.aliexpress.com/item/..."
          className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-zinc-500"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as typeof role)}
          className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm"
        >
          <option value="ALTERNATIVE">Alternativo</option>
          <option value="BACKUP">Reserva</option>
          <option value="PRIMARY">Principal</option>
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={addSupplier}
          className="rounded-xl bg-sky-400 px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-sky-300 disabled:opacity-50"
        >
          {busy ? "Importando…" : "Adicionar"}
        </button>
      </div>

      {message && <p className="mt-3 text-sm text-zinc-400">{message}</p>}

      <div className="mt-6 space-y-4">
        {suppliers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 p-5 text-sm text-zinc-500">
            Nenhum fornecedor persistente disponível ainda.
          </div>
        ) : (
          suppliers.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              canonicalVariants={canonicalVariants}
              onReload={load}
            />
          ))
        )}
      </div>
    </section>
  );
}
