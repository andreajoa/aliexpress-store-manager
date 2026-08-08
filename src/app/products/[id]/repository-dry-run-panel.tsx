"use client";

import { useState } from "react";
import type { PublicationPlan } from "@/lib/publication-plan";
import { PublicationExecutionPanel } from "./publication-execution-panel";
import { PublicationLifecyclePanel } from "./publication-lifecycle-panel";

type RepositoryChange = {
  path: string;
  kind: "add" | "modify" | "unchanged";
  contentType: "json" | "binary";
  beforeSha256: string | null;
  afterSha256: string;
  beforeBytes: number;
  afterBytes: number;
};

type RepositoryResult = {
  ready: boolean;
  adapter: {
    transport: string;
    id: string | null;
  };
  blockers: Array<{ code: string; detail: string }>;
  warnings: Array<{ code: string; detail: string }>;
  changes: RepositoryChange[];
  workflowOperations: Array<{
    order: number;
    kind: string;
    target: string;
    path: string | null;
    description: string;
    remoteWriteRequired: boolean;
  }>;
  summary: {
    added: number;
    modified: number;
    unchanged: number;
    totalFiles: number;
  };
  execution: {
    performed: {
      filesystemWrites: number;
      gitWrites: number;
      commits: number;
      pullRequests: number;
      remoteWrites: number;
    };
  };
};

function changeLabel(kind: RepositoryChange["kind"]) {
  if (kind === "add") return "ADD";
  if (kind === "modify") return "MODIFY";
  return "UNCHANGED";
}

function changeClasses(kind: RepositoryChange["kind"]) {
  if (kind === "add") return "border-emerald-800 bg-emerald-950/30 text-emerald-300";
  if (kind === "modify") return "border-amber-800 bg-amber-950/30 text-amber-300";
  return "border-zinc-700 bg-zinc-900 text-zinc-400";
}

function shortHash(value: string | null) {
  return value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "—";
}

export function RepositoryDryRunPanel({
  publicationId,
  plan,
}: {
  publicationId: string | null;
  plan: PublicationPlan;
}) {
  const [snapshotText, setSnapshotText] = useState("");
  const [result, setResult] = useState<RepositoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const catalogPath =
    plan.operations.find((operation) => operation.kind === "catalog.product.upsert")?.path || null;

  async function runRepositoryDryRun() {
    if (!publicationId) {
      setError("Publication ainda não disponível.");
      return;
    }
    if (!snapshotText.trim()) {
      setError("Cole um Repository Snapshot JSON antes de simular.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const snapshot = JSON.parse(snapshotText) as unknown;
      const response = await fetch(`/api/publications/${publicationId}/repository-dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível calcular o Repository Dry-Run.");
      }
      setResult(data.result || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Snapshot JSON inválido.");
    } finally {
      setLoading(false);
    }
  }

  if (!plan.ready) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-violet-900/70 bg-violet-950/20 p-4">
          <p className="text-sm font-semibold text-violet-300">Repository Dry-Run</p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Não executado porque o Publication Plan ainda possui bloqueios. Se uma publicação remota já foi iniciada, acompanhe o ciclo abaixo.
          </p>
        </div>
        <PublicationLifecyclePanel publicationId={publicationId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-violet-900/70 bg-violet-950/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-violet-300">Repository Dry-Run</p>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Cole um snapshot somente leitura do repositório para calcular o diff exato.
            </p>
          </div>
          <span className="rounded-full border border-emerald-900 bg-emerald-950/30 px-3 py-1 text-[11px] text-emerald-300">
            ZERO WRITES
          </span>
        </div>

        {catalogPath && (
          <p className="mt-3 break-all text-xs text-zinc-500">
            Catálogo esperado: <span className="font-mono text-zinc-400">{catalogPath}</span>
          </p>
        )}

        <textarea
          value={snapshotText}
          onChange={(event) => setSnapshotText(event.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={"{\"files\":{\"data/products.json\":\"{\\\"version\\\":1,\\\"products\\\":[]}\"}}"}
          className="mt-4 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-300 outline-none focus:border-violet-700"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runRepositoryDryRun()}
            disabled={loading}
            className="rounded-lg border border-violet-800 px-3 py-2 text-xs font-medium text-violet-300 hover:bg-violet-950 disabled:opacity-50"
          >
            {loading ? "Calculando diff..." : "Calcular Repository Dry-Run"}
          </button>
          <p className="text-[11px] text-zinc-600">
            O snapshot é processado em memória e não é publicado.
          </p>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-900 bg-red-950/20 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-[11px] text-zinc-500">ADD</p>
                <p className="mt-1 font-semibold text-emerald-300">{result.summary.added}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-[11px] text-zinc-500">MODIFY</p>
                <p className="mt-1 font-semibold text-amber-300">{result.summary.modified}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-[11px] text-zinc-500">UNCHANGED</p>
                <p className="mt-1 font-semibold text-zinc-300">{result.summary.unchanged}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-[11px] text-zinc-500">TOTAL</p>
                <p className="mt-1 font-semibold text-zinc-300">{result.summary.totalFiles}</p>
              </div>
            </div>

            {result.blockers.length > 0 && (
              <div className="rounded-lg border border-red-900 bg-red-950/20 p-3">
                <p className="text-xs font-semibold text-red-300">Bloqueios do repositório</p>
                <div className="mt-2 space-y-2">
                  {result.blockers.map((blocker) => (
                    <p key={blocker.code} className="text-xs text-zinc-400">
                      <span className="font-medium text-red-300">{blocker.code}</span> — {blocker.detail}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {result.changes.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Diff de arquivos</p>
                <div className="mt-2 space-y-2">
                  {result.changes.map((change) => (
                    <div key={change.path} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="break-all font-mono text-xs text-zinc-300">{change.path}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${changeClasses(change.kind)}`}>
                          {changeLabel(change.kind)}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-[11px] text-zinc-500 sm:grid-cols-2">
                        <p>Antes: <span className="font-mono">{shortHash(change.beforeSha256)}</span></p>
                        <p>Depois: <span className="font-mono">{shortHash(change.afterSha256)}</span></p>
                        <p>Bytes antes: {change.beforeBytes}</p>
                        <p>Bytes depois: {change.afterBytes}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.workflowOperations.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Workflow remoto planejado</p>
                <div className="mt-2 space-y-2">
                  {result.workflowOperations.map((operation) => (
                    <div key={`${operation.order}-${operation.kind}`} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <p className="text-xs font-medium text-violet-300">{operation.order}. {operation.kind}</p>
                      <p className="mt-1 text-xs text-zinc-500">{operation.description}</p>
                      <p className="mt-1 break-all text-[11px] text-zinc-600">{operation.target}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-emerald-900 bg-emerald-950/20 p-3">
              <p className="text-xs font-semibold text-emerald-300">Nenhuma alteração remota foi executada</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-500 sm:grid-cols-5">
                <span>Filesystem: {result.execution.performed.filesystemWrites}</span>
                <span>Git: {result.execution.performed.gitWrites}</span>
                <span>Commits: {result.execution.performed.commits}</span>
                <span>PRs: {result.execution.performed.pullRequests}</span>
                <span>Remoto: {result.execution.performed.remoteWrites}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <PublicationExecutionPanel publicationId={publicationId} plan={plan} />
      <PublicationLifecyclePanel publicationId={publicationId} />
    </div>
  );
}
