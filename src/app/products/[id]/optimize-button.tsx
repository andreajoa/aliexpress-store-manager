"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  COPY_LANGUAGE_OPTIONS,
  DEFAULT_COPY_LANGUAGE,
  type CopyLanguage,
} from "@/lib/copy-language";

export function OptimizeButton({
  productId,
  alreadyOptimized,
}: {
  productId: string;
  alreadyOptimized: boolean;
}) {
  const router =
    useRouter();

  const [language, setLanguage] =
    useState<CopyLanguage>(
      DEFAULT_COPY_LANGUAGE
    );

  const [loading, setLoading] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [error, setError] =
    useState("");

  async function optimize() {
    setLoading(true);
    setError("");

    try {
      const response =
        await fetch(
          `/api/products/${productId}/optimize`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              language,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Não foi possível otimizar o produto."
        );
      }

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro inesperado."
      );
    } finally {
      setLoading(false);
    }
  }

  async function deleteProduct() {
    const confirmed = window.confirm(
      "Excluir este produto do Store Manager?\n\nIsso remove os dados do produto, variantes, fornecedores, imagens e publicações registradas no Manager. Pedidos históricos são preservados. Se o produto já estiver publicado em uma loja externa, ele não será apagado automaticamente dessa loja."
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setError("");

    try {
      const response = await fetch(
        `/api/products/${productId}`,
        {
          method: "DELETE",
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Não foi possível excluir o produto."
        );
      }

      if (data.warning) {
        window.alert(data.warning);
      }

      router.push("/products");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro inesperado."
      );
    } finally {
      setDeleting(false);
    }
  }

  const busy =
    loading || deleting;

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Idioma da copy
        </span>
        <select
          value={language}
          onChange={(event) =>
            setLanguage(
              event.target.value as CopyLanguage
            )
          }
          disabled={busy}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {COPY_LANGUAGE_OPTIONS.map(
            (option) => (
              <option
                key={option.value}
                value={option.value}
              >
                {option.label}
              </option>
            )
          )}
        </select>
      </label>

      <button
        type="button"
        onClick={optimize}
        disabled={busy}
        className="w-full rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading
          ? "Criando apresentação..."
          : alreadyOptimized
            ? "Gerar nova versão"
            : "Otimizar produto com Gemini"}
      </button>

      <button
        type="button"
        onClick={deleteProduct}
        disabled={busy}
        className="w-full rounded-xl border border-red-900 bg-red-950/30 px-5 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-950/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {deleting
          ? "Excluindo produto..."
          : "Excluir produto"}
      </button>

      {error && (
        <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
