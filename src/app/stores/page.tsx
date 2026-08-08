import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { StoreForm } from "./store-form";
import { VerifyStoreButton } from "./verify-store-button";
import { StoreCompatibilityPanel } from "./store-compatibility-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function statusLabel(status: string) {
  if (status === "ACTIVE") return "Conectada";
  if (status === "ERROR") return "Erro";
  return "Aguardando conector";
}

function statusClasses(status: string) {
  if (status === "ACTIVE") {
    return "border-emerald-800 bg-emerald-950/40 text-emerald-300";
  }

  if (status === "ERROR") {
    return "border-red-900 bg-red-950/40 text-red-300";
  }

  return "border-amber-900 bg-amber-950/30 text-amber-300";
}

export default async function StoresPage() {
  const stores = await prisma.store.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8">
          <Link
            href="/"
            className="text-sm text-zinc-400 transition hover:text-white"
          >
            ← Voltar ao dashboard
          </Link>

          <div className="mt-6">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
              AliExpress Store Manager
            </p>

            <h1 className="mt-2 text-4xl font-semibold tracking-tight">
              Lojas
            </h1>

            <p className="mt-2 max-w-2xl text-zinc-400">
              Cadastre e gerencie as lojas que receberão os produtos
              importados pelo sistema.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <StoreForm />

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500">
                  Lojas cadastradas
                </p>

                <p className="mt-1 text-3xl font-semibold">
                  {stores.length}
                </p>
              </div>
            </div>

            {stores.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-700 p-8 text-center">
                <p className="font-medium">
                  Nenhuma loja cadastrada
                </p>

                <p className="mt-2 text-sm text-zinc-500">
                  Cadastre sua primeira loja no formulário ao lado.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {stores.map((store) => (
                  <article
                    key={store.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5"
                  >
                    <div className="flex flex-col justify-between gap-4 sm:flex-row">
                      <div>
                        <h2 className="text-lg font-semibold">
                          {store.name}
                        </h2>

                        <a
                          href={store.baseUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block break-all text-sm text-zinc-400 transition hover:text-emerald-400"
                        >
                          {store.baseUrl}
                        </a>
                      </div>

                      <div>
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusClasses(
                            store.status
                          )}`}
                        >
                          {statusLabel(store.status)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 border-t border-zinc-800 pt-4 text-sm sm:grid-cols-2">
                      <div>
                        <p className="text-zinc-500">
                          Tipo
                        </p>

                        <p className="mt-1 text-zinc-300">
                          {store.connectionType === "GITHUB_VERCEL"
                            ? "GitHub + Vercel"
                            : "API genérica"}
                        </p>
                      </div>

                      <div>
                        <p className="text-zinc-500">
                          Endpoint esperado
                        </p>

                        <p className="mt-1 break-all text-zinc-300">
                          {store.apiEndpoint}
                        </p>
                      </div>
                    </div>

                    {store.githubRepo && (
                      <div className="mt-3 text-sm">
                        <span className="text-zinc-500">
                          GitHub:
                        </span>{" "}
                        <span className="text-zinc-300">
                          {store.githubOwner}/{store.githubRepo}
                          {" · "}
                          {store.githubBranch}
                        </span>
                      </div>
                    )}

                    <StoreCompatibilityPanel store={store} />

                    <VerifyStoreButton
                      storeId={store.id}
                      status={store.status}
                    />
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
