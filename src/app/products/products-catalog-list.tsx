"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type CatalogProductRow = {
  id: string;
  sourceProductId: string;
  title: string;
  imageCount: number;
  variantCount: number;
  status: string;
  sellerName: string | null;
  ambSlugs: string[];
  hasUsWarehouse: boolean;
  hasUsInStock: boolean;
  usTotalStock: number;
  dispatchCountry: string;
  checked: boolean;
  error: string | null;
  deliveryMinDays: number | null;
  deliveryMaxDays: number | null;
  ambDisplayMinDays: number | null;
  ambDisplayMaxDays: number | null;
};

type WarehouseFilter = "all" | "us_in_stock" | "us_out_of_stock" | "cn" | "pending";

export function ProductsCatalogList({ items }: { items: CatalogProductRow[] }) {
  const [filter, setFilter] = useState<WarehouseFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    let usInStock = 0;
    let usOutOfStock = 0;
    let cn = 0;
    let pending = 0;

    for (const item of items) {
      if (item.hasUsInStock) usInStock++;
      else if (item.hasUsWarehouse) usOutOfStock++;
      else if (item.checked) cn++;
      else pending++;
    }

    return {
      all: items.length,
      usInStock,
      usOutOfStock,
      cn,
      pending,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "us_in_stock" && !item.hasUsInStock) return false;
      if (filter === "us_out_of_stock" && !(item.hasUsWarehouse && !item.hasUsInStock)) return false;
      if (filter === "cn" && (item.hasUsWarehouse || item.hasUsInStock || !item.checked)) return false;
      if (filter === "pending" && (item.hasUsWarehouse || item.hasUsInStock || item.checked)) return false;

      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.sourceProductId.toLowerCase().includes(q) ||
        (item.sellerName?.toLowerCase().includes(q) ?? false) ||
        item.ambSlugs.some((slug) => slug.toLowerCase().includes(q))
      );
    });
  }, [filter, items, query]);

  const tabs: Array<{ id: WarehouseFilter; label: string; count: number; accent: string }> = [
    { id: "all", label: "Todos", count: counts.all, accent: "border-zinc-600 bg-zinc-800 text-white" },
    { id: "us_in_stock", label: "US Warehouse · Em estoque", count: counts.usInStock, accent: "border-emerald-600 bg-emerald-950 text-emerald-200" },
    { id: "us_out_of_stock", label: "US Warehouse · Sem estoque", count: counts.usOutOfStock, accent: "border-amber-600 bg-amber-950 text-amber-200" },
    { id: "cn", label: "China / CN", count: counts.cn, accent: "border-zinc-600 bg-zinc-800 text-zinc-200" },
    { id: "pending", label: "Pendente / Erro", count: counts.pending, accent: "border-orange-600 bg-orange-950 text-orange-200" },
  ];

  return (
    <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm text-zinc-500">
            Produtos importados (US Warehouse fixado no topo)
          </p>
          <p className="mt-1 text-3xl font-semibold">
            {filtered.length}{" "}
            <span className="text-base font-normal text-zinc-500">de {items.length}</span>
          </p>
        </div>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nome, ID AliExpress, fornecedor ou slug AMB..."
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none lg:w-96"
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`rounded-lg border px-3.5 py-2 text-xs font-semibold transition ${
                active
                  ? tab.accent
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-700 p-8 text-center text-zinc-500">
          Nenhum produto encontrado nesse filtro.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {filtered.map((product) => (
            <article
              key={product.id}
              className={`rounded-xl border p-5 ${
                product.hasUsInStock
                  ? "border-emerald-800/70 bg-emerald-950/15"
                  : product.hasUsWarehouse
                    ? "border-amber-800/60 bg-amber-950/10"
                    : "border-zinc-800 bg-zinc-950/60"
              }`}
            >
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold leading-6">{product.title}</p>
                    {product.ambSlugs.length > 0 && (
                      <span className="rounded border border-sky-800/70 bg-sky-950/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                        Na loja AMB ({product.ambSlugs.length})
                      </span>
                    )}
                  </div>

                  <p className="mt-1.5 text-xs text-zinc-500">
                    AliExpress #{product.sourceProductId}
                    {product.sellerName ? ` · ${product.sellerName}` : ""}
                    {product.deliveryMinDays != null
                      ? ` · Entrega fornecedor ${
                          product.deliveryMinDays === product.deliveryMaxDays
                            ? `${product.deliveryMinDays}d`
                            : `${product.deliveryMinDays}–${product.deliveryMaxDays}d`
                        }`
                      : ""}
                    {product.ambDisplayMinDays != null
                      ? ` (AMB: ${product.ambDisplayMinDays}–${product.ambDisplayMaxDays}d)`
                      : ""}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-xs text-zinc-400">
                    {product.imageCount} img · {product.variantCount} SKUs
                  </div>

                  {product.hasUsInStock ? (
                    <span className="rounded-lg border border-emerald-700 bg-emerald-950/80 px-3 py-1 text-xs font-semibold text-emerald-200">
                      US Warehouse · {product.usTotalStock} un.
                    </span>
                  ) : product.hasUsWarehouse ? (
                    <span className="rounded-lg border border-amber-700 bg-amber-950/70 px-3 py-1 text-xs font-semibold text-amber-200">
                      US Warehouse · Sem estoque (0 un.)
                    </span>
                  ) : product.checked ? (
                    <span className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400">
                      {product.dispatchCountry || "CN"}
                    </span>
                  ) : (
                    <span
                      title={product.error || "Ainda não auditado na API oficial"}
                      className="rounded-lg border border-orange-800/60 bg-orange-950/30 px-3 py-1 text-xs text-orange-300"
                    >
                      {product.error ? "Erro / Reauditar" : "Não auditado"}
                    </span>
                  )}

                  <span
                    className={`rounded-lg border px-3 py-1 text-xs font-medium ${
                      product.status === "READY" || product.status === "PUBLISHED"
                        ? "border-emerald-800 bg-emerald-950/50 text-emerald-300"
                        : "border-zinc-700 bg-zinc-900 text-zinc-400"
                    }`}
                  >
                    {product.status === "PUBLISHED"
                      ? "Publicado"
                      : product.status === "READY"
                        ? "Otimizado"
                        : "Importado"}
                  </span>

                  <Link
                    href={`/products/${product.id}`}
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
                  >
                    Abrir produto
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
