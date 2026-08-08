import {
  evaluateStoreCompatibility,
  type CompatibilityLevel,
} from "@/lib/store-compatibility";

type StoreCompatibilityPanelProps = {
  store: {
    status: string;
    connectionType: string;
    baseUrl: string;
    apiEndpoint: string | null;
    githubOwner: string | null;
    githubRepo: string | null;
    githubBranch: string | null;
    connectorVersion: string | null;
    connectorCapabilities: unknown;
    intelligenceSource: string | null;
    lastScannedAt: Date | string | null;
  };
};

function levelLabel(level: CompatibilityLevel) {
  if (level === "AVAILABLE") return "Disponível";
  if (level === "LIMITED") return "Limitado";
  return "Bloqueado";
}

function levelClasses(level: CompatibilityLevel) {
  if (level === "AVAILABLE") {
    return "border-emerald-800 bg-emerald-950/30 text-emerald-300";
  }
  if (level === "LIMITED") {
    return "border-amber-800 bg-amber-950/30 text-amber-300";
  }
  return "border-red-900 bg-red-950/30 text-red-300";
}

function overallLabel(level: CompatibilityLevel) {
  if (level === "AVAILABLE") return "Compatibilidade completa";
  if (level === "LIMITED") return "Compatibilidade limitada";
  return "Compatibilidade bloqueada";
}

export function StoreCompatibilityPanel({
  store,
}: StoreCompatibilityPanelProps) {
  const report = evaluateStoreCompatibility(store);

  return (
    <section className="mt-5 border-t border-zinc-800 pt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-200">
            Compatibilidade do Store Manager
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Diagnóstico local baseado no conector e nas capabilities declaradas.
          </p>
        </div>

        <span
          className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-medium ${levelClasses(report.overall)}`}
        >
          {overallLabel(report.overall)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {report.items.map((entry) => (
          <div
            key={entry.key}
            className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {entry.label}
              </p>

              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${levelClasses(entry.level)}`}
              >
                {levelLabel(entry.level)}
              </span>
            </div>

            <p className="mt-2 text-sm font-medium text-zinc-200">
              {entry.summary}
            </p>

            <p className="mt-1 break-words text-xs leading-relaxed text-zinc-500">
              {entry.detail}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Contrato de publicação
            </p>

            <p className="mt-1 text-sm text-zinc-300">
              {report.publicationTarget.valid
                ? `${report.publicationTarget.kind} · ${report.publicationTarget.adapter}`
                : report.publicationTarget.present
                  ? "Contrato declarado, mas inválido"
                  : "Contrato não declarado"}
            </p>
          </div>

          <span
            className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-medium ${levelClasses(report.publishable ? "AVAILABLE" : "BLOCKED")}`}
          >
            {report.publishable ? "Publicação compatível" : "Publicação bloqueada"}
          </span>
        </div>

        {!report.publicationTarget.valid && report.publicationTarget.issues.length > 0 && (
          <div className="mt-3 space-y-1">
            {report.publicationTarget.issues.map((issue) => (
              <p key={issue} className="text-xs text-zinc-500">
                • {issue}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
