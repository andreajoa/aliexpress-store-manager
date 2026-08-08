"use client";

import { useState } from "react";
import type { PublicationPlan } from "@/lib/publication-plan";

type ExecutionResult = {
  ready: boolean;
  outcome: "blocked" | "noop" | "pull-request-open";
  repository: string | null;
  baseBranch: string | null;
  publicationBranch: string | null;
  commitSha: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  blockers: Array<{ code: string; detail: string }>;
  execution: {
    performed: {
      gitObjects: number;
      branchCreates: number;
      commits: number;
      pullRequests: number;
      productionWrites: number;
      baseBranchWrites: number;
    };
  };
};

export function PublicationExecutionPanel({
  publicationId,
  plan,
}: {
  publicationId: string | null;
  plan: PublicationPlan;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExecutionResult | null>(null);

  const executable =
    Boolean(publicationId) &&
    plan.ready &&
    plan.adapter.transport === "github" &&
    plan.adapter.id === "github-json-catalog-v1" &&
    Boolean(plan.target.futureBranch) &&
    plan.target.futureBranch !== plan.target.baseBranch &&
    plan.target.futureBranch !== "main" &&
    plan.target.futureBranch !== "master";

  async function execute() {
    if (!publicationId || !executable || !confirmed) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch(`/api/publications/${publicationId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await response.json();

      if (!response.ok) {
        const blockerDetail = Array.isArray(data.blockers)
          ? data.blockers.map((item: { detail?: string }) => item.detail).filter(Boolean).join(" | ")
          : "";
        throw new Error(
          [data.error || "Não foi possível executar a publicação.", blockerDetail]
            .filter(Boolean)
            .join(" "),
        );
      }

      setResult(data.result || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha inesperada na publicação.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-orange-900/70 bg-orange-950/15 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-orange-300">Execução GitHub</p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-400">
            Quando habilitada, esta ação cria somente uma branch isolada, commit e Pull Request em draft. O executor nunca atualiza diretamente a branch base e nunca faz merge ou publicação em produção.
          </p>
        </div>
        <span className="rounded-full border border-emerald-900 bg-emerald-950/30 px-3 py-1 text-[11px] text-emerald-300">
          MAIN PROTEGIDA
        </span>
      </div>

      {!executable && (
        <div className="mt-4 rounded-lg border border-amber-900 bg-amber-950/20 p-3 text-xs text-amber-300">
          O Publication Plan ainda não está apto para execução GitHub segura.
        </div>
      )}

      {executable && !result && (
        <>
          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
            <p>Repositório: <span className="font-mono text-zinc-300">{plan.target.repository}</span></p>
            <p className="mt-1">Base: <span className="font-mono text-zinc-300">{plan.target.baseBranch}</span></p>
            <p className="mt-1 break-all">Branch nova: <span className="font-mono text-orange-300">{plan.target.futureBranch}</span></p>
          </div>

          <label className="mt-4 flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-5 text-zinc-400">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1"
            />
            <span>
              Confirmo a criação de branch, objetos Git, commit e Pull Request em draft. Entendo que nenhuma alteração será aplicada à branch base ou à produção nesta etapa.
            </span>
          </label>

          <button
            type="button"
            onClick={() => void execute()}
            disabled={!confirmed || loading}
            className="mt-3 rounded-lg border border-orange-800 bg-orange-950/30 px-4 py-2 text-xs font-semibold text-orange-200 hover:bg-orange-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Criando branch e PR..." : "Criar branch segura + Pull Request"}
          </button>
        </>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950/20 p-3 text-xs leading-5 text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-emerald-900 bg-emerald-950/20 p-3">
            <p className="text-xs font-semibold text-emerald-300">
              {result.outcome === "pull-request-open"
                ? `Pull Request #${result.pullRequestNumber} criado em draft`
                : "Nenhuma alteração material necessária"}
            </p>
            {result.publicationBranch && (
              <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">
                {result.publicationBranch}
              </p>
            )}
            {result.pullRequestUrl && (
              <a
                href={result.pullRequestUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex text-xs font-medium text-sky-300 hover:underline"
              >
                Abrir Pull Request →
              </a>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500 sm:grid-cols-6">
            <span>Objetos Git: {result.execution.performed.gitObjects}</span>
            <span>Branches: {result.execution.performed.branchCreates}</span>
            <span>Commits: {result.execution.performed.commits}</span>
            <span>PRs: {result.execution.performed.pullRequests}</span>
            <span>Base writes: {result.execution.performed.baseBranchWrites}</span>
            <span>Produção: {result.execution.performed.productionWrites}</span>
          </div>
        </div>
      )}
    </div>
  );
}
