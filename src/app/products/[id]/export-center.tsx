"use client";

import {
  useState,
} from "react";

type Store = {
  id: string;
  name: string;
  baseUrl: string;
};

export function ExportCenter({
  productId,
  stores,
}: {
  productId: string;
  stores: Store[];
}) {
  const [
    storeId,
    setStoreId,
  ] =
    useState(
      stores[0]?.id ||
        ""
    );

  const [
    loading,
    setLoading,
  ] =
    useState<
      "product" |
      "store" |
      null
    >(null);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    error,
    setError,
  ] =
    useState("");

  async function run(
    type:
      | "product"
      | "store"
  ) {
    setLoading(type);
    setMessage("");
    setError("");

    try {
      const response =
        await fetch(
          type ===
            "product"
            ? "/api/exports/product"
            : "/api/exports/store",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                type ===
                  "product"
                  ? {
                      productId,
                      storeId,
                    }
                  : {
                      storeId,
                    }
              ),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Falha na exportação."
        );
      }

      setMessage(
        type ===
          "product"
          ? `Produto salvo em: ${data.folder}`
          : `${data.products} produto(s) salvos em: ${data.folder}`
      );
    } catch (err) {
      setError(
        err instanceof
          Error
          ? err.message
          : "Erro inesperado."
      );
    } finally {
      setLoading(null);
    }
  }

  if (
    stores.length ===
    0
  ) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
        Export Center
      </p>

      <h2 className="mt-2 text-2xl font-semibold">
        Arquivo local dos produtos
      </h2>

      <p className="mt-2 text-sm leading-6 text-zinc-500">
        Nada é salvo automaticamente. Escolha quando deseja criar a cópia organizada no Downloads do Mac.
      </p>

      <label className="mt-5 block">
        <span className="mb-2 block text-sm text-zinc-400">
          Pasta da loja
        </span>

        <select
          value={
            storeId
          }
          onChange={(
            event
          ) =>
            setStoreId(
              event.target
                .value
            )
          }
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3"
        >
          {stores.map(
            store => (
              <option
                key={
                  store.id
                }
                value={
                  store.id
                }
              >
                {
                  store.name
                }
              </option>
            )
          )}
        </select>
      </label>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() =>
            void run(
              "product"
            )
          }
          disabled={
            loading !==
            null
          }
          className="rounded-xl border border-emerald-800 bg-emerald-950/30 px-5 py-3 font-semibold text-emerald-300 disabled:opacity-50"
        >
          {loading ===
          "product"
            ? "Salvando..."
            : "Salvar este produto no Downloads"}
        </button>

        <button
          type="button"
          onClick={() =>
            void run(
              "store"
            )
          }
          disabled={
            loading !==
            null
          }
          className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 disabled:opacity-50"
        >
          {loading ===
          "store"
            ? "Salvando loja..."
            : "Salvar todos desta loja"}
        </button>
      </div>

      {message && (
        <div className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/30 p-4 text-sm text-emerald-300">
          {
            message
          }
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {
            error
          }
        </div>
      )}
    </section>
  );
}
