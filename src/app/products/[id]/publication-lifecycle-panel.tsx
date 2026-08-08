"use client";

import { useCallback, useEffect, useState } from "react";

type Lifecycle = {
  configuration: {
    githubToken: boolean;
    vercelToken: boolean;
  };
  publication: {
    id: string;
    status: string;
    externalUrl: string | null;
    githubBranch: string | null;
    githubCommitSha: string | null;
    pullRequestNumber: number | null;
    previewUrl: string | null;
    lastError: string | null;
    publishedAt: string | null;
  };
  pullRequest: {
    number: number;
    state: string;
    draft: boolean;
    merged: boolean;
    url: string;
  } | null;
  githubError: string | null;
};

export function PublicationLifecyclePanel({ publicationId }: { publicationId: string | null }) {
  const [data, setData] = useState<Lifecycle | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"preview" | "merge" | "production" | null>(null);
  const [error, setError] = useState("");
  const [mergeConfirmed, setMergeConfirmed] = useState(false);

  const load = useCallback(async () => {
    if (!publicationId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/publications/${publicationId}/lifecycle`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar o ciclo de publicação.");
      setData(json as Lifecycle);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar ciclo de publicação.");
    } finally {
      setLoading(false);
    }
  }, [publicationId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  async function run(kind: "preview" | "merge" | "production") {
    if (!publicationId) return;
    setAction(kind);
    setError("");
    try {
      const endpoint =
        kind === "preview"
          ? "preview"
          : kind === "merge"
            ? "approve-merge"
            : "production-verify";
      const response = await fetch(`/api/publications/${publicationId}/${endpoint}`, {
        method: "POST",
        ...(kind === "merge"
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ confirm: true }),
            }
          : {}),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "A etapa não foi concluída.");
      if (kind === "merge") setMergeConfirmed(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha inesperada na etapa.");
    } finally {
      setAction(null);
    }
  }

  if (!publicationId) return null;

  const publication = data?.publication;
  const pullRequest = data?.pullRequest;
  const hasRemoteExecution = Boolean(publication?.pullRequestNumber && publication?.githubCommitSha);
  const previewVerified = Boolean(publication?.previewUrl);
  const merged = Boolean(pullRequest?.merged);
  const published = publication?.status === "PUBLISHED";

  return (
    <div className="rounded-xl border border-sky-900/70 bg-sky-950/15 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-sky-300">Ciclo remoto de publicação</p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-400">
            Branch/PR → Preview verificado → aprovação explícita do merge → verificação da página em produção.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || Boolean(action)}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-900 disabled:opacity-40"
        >
          {loading ? "Atualizando..." : "Atualizar estado"}
        </button>
      </div>

      {data && (
        <div className="mt-4 grid gap-2 text-[11px] sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-zinc-600">1. Branch + PR</p>
            <p className={hasRemoteExecution ? "mt-1 text-emerald-300" : "mt-1 text-zinc-500"}>
              {hasRemoteExecution ? `PR #${publication?.pullRequestNumber}` : "Aguardando"}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-zinc-600">2. Preview</p>
            <p className={previewVerified ? "mt-1 text-emerald-300" : "mt-1 text-zinc-500"}>
              {previewVerified ? "Verificado" : "Aguardando"}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-zinc-600">3. Merge</p>
            <p className={merged ? "mt-1 text-emerald-300" : "mt-1 text-zinc-500"}>
              {merged ? "Concluído" : "Aguardando"}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-zinc-600">4. Produção</p>
            <p className={published ? "mt-1 text-emerald-300" : "mt-1 text-zinc-500"}>
              {published ? "Verificada" : "Aguardando"}
            </p>
          </div>
        </div>
      )}

      {data && (!data.configuration.githubToken || !data.configuration.vercelToken) && (
        <div className="mt-4 rounded-lg border border-amber-900 bg-amber-950/20 p-3 text-xs text-amber-300">
          Configuração online pendente:
          {!data.configuration.githubToken ? " GITHUB_PUBLISH_TOKEN" : ""}
          {!data.configuration.vercelToken ? " VERCEL_API_TOKEN" : ""}.
        </div>
      )}

      {hasRemoteExecution && !previewVerified && !merged && (
        <button
          type="button"
          onClick={() => void run("preview")}
          disabled={Boolean(action)}
          className="mt-4 rounded-lg border border-sky-800 bg-sky-950/30 px-4 py-2 text-xs font-semibold text-sky-200 disabled:opacity-40"
        >
          {action === "preview" ? "Verificando Preview..." : "Localizar e verificar Preview"}
        </button>
      )}

      {previewVerified && !merged && (
        <div className="mt-4 space-y-3">
          {publication?.previewUrl && (
            <a href={publication.previewUrl} target="_blank" rel="noreferrer" className="inline-flex text-xs text-sky-300 hover:underline">
              Abrir Preview verificado →
            </a>
          )}
          <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-5 text-zinc-400">
            <input
              type="checkbox"
              checked={mergeConfirmed}
              onChange={(event) => setMergeConfirmed(event.target.checked)}
              className="mt-1"
            />
            <span>
              Aprovo incorporar este Pull Request somente porque o Preview foi verificado. O endpoint revalida o Preview e o SHA do PR imediatamente antes do merge.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void run("merge")}
            disabled={!mergeConfirmed || Boolean(action)}
            className="rounded-lg border border-orange-800 bg-orange-950/30 px-4 py-2 text-xs font-semibold text-orange-200 disabled:opacity-40"
          >
            {action === "merge" ? "Revalidando e incorporando..." : "Aprovar merge seguro"}
          </button>
        </div>
      )}

      {merged && !published && (
        <button
          type="button"
          onClick={() => void run("production")}
          disabled={Boolean(action)}
          className="mt-4 rounded-lg border border-emerald-800 bg-emerald-950/30 px-4 py-2 text-xs font-semibold text-emerald-200 disabled:opacity-40"
        >
          {action === "production" ? "Verificando produção..." : "Verificar página em produção"}
        </button>
      )}

      {published && publication?.externalUrl && (
        <div className="mt-4 rounded-lg border border-emerald-900 bg-emerald-950/20 p-3 text-xs text-emerald-300">
          Publicação concluída e verificada. <a href={publication.externalUrl} target="_blank" rel="noreferrer" className="underline">Abrir produto →</a>
        </div>
      )}

      {pullRequest?.url && (
        <a href={pullRequest.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-[11px] text-zinc-500 hover:text-zinc-300">
          Pull Request no GitHub →
        </a>
      )}

      {(error || data?.githubError || publication?.lastError) && (
        <div className="mt-4 rounded-lg border border-red-900 bg-red-950/20 p-3 text-xs leading-5 text-red-300">
          {error || data?.githubError || publication?.lastError}
        </div>
      )}
    </div>
  );
}
