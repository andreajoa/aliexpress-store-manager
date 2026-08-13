"use client";

import { useState } from "react";

type Candidate = {
  supplierId: string;
  sellerName: string | null;
  sourceProductId: string | null;
  sourceUrl: string | null;
  role: string;
  priority: number;
  currency: string | null;
  eligible: boolean;
  totalSourceCost: number | null;
  issues: Array<{ code: string; detail: string }>;
};

export function SupplierSwitchControl({
  orderId,
  batchId,
}: {
  orderId: string;
  batchId: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [recommended, setRecommended] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const endpoint = `/api/orders/${encodeURIComponent(orderId)}/fulfillment/batches/${encodeURIComponent(batchId)}/supplier-switch`;

  async function load() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Alternativas indisponíveis.");
      setCandidates(data.candidates || []);
      setRecommended(data.recommendedSupplierProductId || null);
      setSelected(data.recommendedSupplierProductId || "");
      setOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Alternativas indisponíveis.");
    } finally {
      setBusy(false);
    }
  }

  async function switchSupplier() {
    if (!selected) {
      setMessage("Selecione um fornecedor elegível.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          targetSupplierProductId: selected,
          reason: reason.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Fornecedor não trocado.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fornecedor não trocado.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={load}
          className="rounded-lg border border-amber-800 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-950/30 disabled:opacity-50"
        >
          {busy ? "Avaliando…" : "Trocar fornecedor"}
        </button>
        {message && <p className="mt-2 text-xs text-zinc-400">{message}</p>}
      </div>
    );
  }

  const eligible = candidates.filter((candidate) => candidate.eligible);

  return (
    <div className="rounded-xl border border-amber-900/70 bg-amber-950/15 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-300">Troca antes da compra</p>
          <p className="mt-1 text-xs text-zinc-500">
            Só fornecedores com mapping completo, dados recentes e estoque seguro podem ser selecionados.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-500 hover:text-white">
          Fechar
        </button>
      </div>

      {eligible.length === 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-red-300">Nenhuma alternativa elegível agora.</p>
          {candidates.flatMap((candidate) => candidate.issues).slice(0, 6).map((issue, index) => (
            <p key={`${issue.code}-${index}`} className="text-xs text-zinc-500">
              {issue.code} · {issue.detail}
            </p>
          ))}
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-2">
            {eligible.map((candidate) => (
              <label key={candidate.supplierId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <input
                  type="radio"
                  name={`supplier-${batchId}`}
                  value={candidate.supplierId}
                  checked={selected === candidate.supplierId}
                  onChange={() => setSelected(candidate.supplierId)}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {candidate.sellerName || `AliExpress ${candidate.sourceProductId || candidate.supplierId}`}
                    {candidate.supplierId === recommended ? " · recomendado" : ""}
                  </span>
                  <span className="mt-1 block text-xs text-zinc-500">
                    {candidate.role} · prioridade {candidate.priority} · custo total {candidate.totalSourceCost ?? "—"} {candidate.currency || ""}
                  </span>
                </span>
                {candidate.sourceUrl && (
                  <a
                    href={candidate.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="text-xs text-sky-400 hover:text-sky-300"
                  >
                    Ver ↗
                  </a>
                )}
              </label>
            ))}
          </div>

          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="Motivo opcional da troca"
            className="mt-3 min-h-20 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />

          <button
            type="button"
            disabled={busy || !selected}
            onClick={switchSupplier}
            className="mt-3 rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
          >
            {busy ? "Trocando…" : "Confirmar troca"}
          </button>
        </>
      )}

      {message && <p className="mt-3 text-xs text-zinc-400">{message}</p>}
    </div>
  );
}
