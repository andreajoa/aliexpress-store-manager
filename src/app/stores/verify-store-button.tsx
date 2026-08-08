"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CatalogSummary = {
  count: number;
  currency: string;
};

export function VerifyStoreButton({
  storeId,
  status,
}: {
  storeId: string;
  status: string;
}) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [catalog, setCatalog] =
    useState<CatalogSummary | null>(null);

  async function verifyStore() {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `/api/stores/${storeId}/verify`,
        {
          method: "POST",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Não foi possível validar o conector."
        );
      }

      setMessage(
        `Conector ${data.connector.version || ""} validado com sucesso.`
      );

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível conectar a loja."
      );
    } finally {
      setLoading(false);
    }
  }

  async function readCatalog() {
    setCatalogLoading(true);
    setMessage("");
    setError("");
    setCatalog(null);

    try {
      const response = await fetch(
        `/api/stores/${storeId}/catalog`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Não foi possível ler o catálogo."
        );
      }

      setCatalog({
        count: data.catalog.count,
        currency: data.catalog.currency,
      });

      setMessage(
        `Catálogo lido com segurança: ${data.catalog.count} produtos encontrados.`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível ler o catálogo."
      );
    } finally {
      setCatalogLoading(false);
    }
  }

  return (
    <div className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
      <button
        type="button"
        onClick={verifyStore}
        disabled={loading}
        className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
          status === "ACTIVE"
            ? "border border-emerald-800 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-950/70"
            : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
        }`}
      >
        {loading
          ? "Testando conexão..."
          : status === "ACTIVE"
            ? "Testar conexão novamente"
            : "Validar Store Connector"}
      </button>

      {status === "ACTIVE" && (
        <button
          type="button"
          onClick={readCatalog}
          disabled={catalogLoading}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition hover:border-emerald-700 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {catalogLoading
            ? "Lendo catálogo..."
            : "Ler catálogo da loja"}
        </button>
      )}

      {catalog && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">
            Catálogo remoto
          </p>

          <div className="mt-2 flex items-end justify-between">
            <div>
              <p className="text-3xl font-semibold">
                {catalog.count}
              </p>

              <p className="text-sm text-zinc-500">
                produtos encontrados
              </p>
            </div>

            <span className="text-sm text-zinc-400">
              {catalog.currency}
            </span>
          </div>
        </div>
      )}

      {message && (
        <p className="text-sm text-emerald-400">
          {message}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
