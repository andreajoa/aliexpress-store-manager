"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ApproveButton({
  productId,
}: {
  productId: string;
}) {
  const router =
    useRouter();

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  async function approve() {
    setLoading(true);
    setError("");

    try {
      const response =
        await fetch(
          `/api/products/${productId}/approve`,
          {
            method: "POST",
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Não foi possível aprovar."
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
        onClick={approve}
        disabled={loading}
        className="w-full rounded-xl border border-emerald-600 bg-emerald-950/50 px-5 py-3 font-semibold text-emerald-300 transition hover:bg-emerald-900/50 disabled:opacity-50"
      >
        {loading
          ? "Aprovando..."
          : "Aprovar copy"}
      </button>

      {error && (
        <p className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
