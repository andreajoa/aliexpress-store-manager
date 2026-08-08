"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OptimizeButton({
  productId,
  alreadyOptimized,
}: {
  productId: string;
  alreadyOptimized: boolean;
}) {
  const router =
    useRouter();

  const [loading, setLoading] =
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

  return (
    <div>
      <button
        type="button"
        onClick={optimize}
        disabled={loading}
        className="w-full rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading
          ? "Criando apresentação..."
          : alreadyOptimized
            ? "Gerar nova versão"
            : "Otimizar produto com Gemini"}
      </button>

      {error && (
        <div className="mt-3 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
