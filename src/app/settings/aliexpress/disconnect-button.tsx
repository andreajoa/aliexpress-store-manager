"use client";

import { useState } from "react";

export function DisconnectAliExpressButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/aliexpress/connection", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Não foi possível desconectar.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível desconectar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={disconnect}
        className="rounded-lg border border-red-800 px-4 py-2 text-sm font-semibold text-red-300 disabled:opacity-50"
      >
        {busy ? "Desconectando…" : "Desconectar conta"}
      </button>
      {message && <p className="mt-2 text-xs text-zinc-400">{message}</p>}
    </div>
  );
}
