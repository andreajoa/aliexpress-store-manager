"use client";

import { useState } from "react";

export function StoreWebhookPanel({
  storeId,
  enabled,
  tokenCreatedAt,
  lastSeenAt,
}: {
  storeId: string;
  enabled: boolean;
  tokenCreatedAt: string | null;
  lastSeenAt: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [webhookPath, setWebhookPath] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function rotate() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/webhook-token`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Token não criado.");
      setToken(data.token);
      setWebhookPath(data.webhookPath);
      setMessage("Novo token criado. Ele será mostrado somente nesta sessão.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Token não criado.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/webhook-token`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Webhook não desativado.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Webhook não desativado.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copiado.`);
    } catch {
      setMessage(`Não foi possível copiar ${label.toLowerCase()}.`);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Webhook de pedidos</p>
          <p className="mt-1 text-xs text-zinc-500">
            Recebe order.paid da loja com um token exclusivo. O Manager guarda somente o hash do segredo.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Status: {enabled ? "ativo" : "desativado"}
            {tokenCreatedAt ? ` · token ${new Date(tokenCreatedAt).toLocaleString("pt-BR")}` : ""}
            {lastSeenAt ? ` · último evento ${new Date(lastSeenAt).toLocaleString("pt-BR")}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={rotate}
            className="rounded-lg border border-emerald-800 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-50"
          >
            {busy ? "Aguarde…" : enabled ? "Rotacionar token" : "Ativar webhook"}
          </button>
          {enabled && (
            <button
              type="button"
              disabled={busy}
              onClick={disable}
              className="rounded-lg border border-red-900 px-3 py-2 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-50"
            >
              Desativar
            </button>
          )}
        </div>
      </div>

      {token && (
        <div className="mt-4 rounded-lg border border-amber-800 bg-amber-950/20 p-4">
          <p className="text-xs font-semibold text-amber-300">SEGREDO VISÍVEL UMA ÚNICA VEZ</p>
          <code className="mt-2 block break-all text-xs text-zinc-200">{token}</code>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copy(token, "Token")}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs hover:bg-zinc-800"
            >
              Copiar token
            </button>
            {webhookPath && (
              <button
                type="button"
                onClick={() => copy(webhookPath, "Caminho do webhook")}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs hover:bg-zinc-800"
              >
                Copiar caminho
              </button>
            )}
          </div>
        </div>
      )}

      {message && <p className="mt-3 text-xs text-zinc-400">{message}</p>}
    </div>
  );
}
