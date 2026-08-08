"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

type Store = {
  id: string;
  name: string;
  baseUrl: string;
};

type SourceImage = {
  id: string;
  url: string;
  selected: boolean;
};

type Asset = {
  id: string;
  type: string;
  batch: number;
  selected: boolean;

  fidelityScore:
    number | null;

  auditPassed:
    boolean | null;

  auditIssues:
    string[];

  imageUrl: string;

  version?:
    number;
};

const labels:
  Record<string, string> = {
    AI_LIFESTYLE:
      "Lifestyle",

    AI_IN_USE:
      "Produto em uso",

    AI_PREMIUM_SCENE:
      "Cena premium",

    AI_DETAIL_CONTEXT:
      "Detalhe contextual",
  };

export function EditorialStudio({
  productId,
  productStatus,
  stores,
  sourceImages,
  initialReferenceImageId,
}: {
  productId: string;
  productStatus: string;
  stores: Store[];

  sourceImages:
    SourceImage[];

  initialReferenceImageId:
    string;
}) {
  const [
    storeId,
    setStoreId,
  ] =
    useState(
      stores[0]?.id ||
        ""
    );

  const availableReferences =
    useMemo(() => {
      const selected =
        sourceImages.filter(
          image =>
            image.selected
        );

      return selected.length
        ? selected
        : sourceImages;
    }, [
      sourceImages,
    ]);

  const [
    referenceImageId,
    setReferenceImageId,
  ] =
    useState(
      initialReferenceImageId ||
      availableReferences[
        0
      ]?.id ||
      ""
    );

  const [
    assets,
    setAssets,
  ] =
    useState<
      Asset[]
    >([]);

  const [
    batch,
    setBatch,
  ] =
    useState<
      number | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    selecting,
    setSelecting,
  ] =
    useState<
      string | null
    >(null);

  const [
    regenerating,
    setRegenerating,
  ] =
    useState<
      string | null
    >(null);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    warnings,
    setWarnings,
  ] =
    useState<
      string[]
    >([]);

  async function load() {
    if (!storeId) {
      return;
    }

    try {
      const response =
        await fetch(
          `/api/products/${productId}/editorial?storeId=${encodeURIComponent(
            storeId
          )}`,
          {
            cache:
              "no-store",
          }
        );

      const data =
        await response.json();

      if (
        response.ok
      ) {
        setAssets(
          data.assets ||
            []
        );

        setBatch(
          data.batch ||
            null
        );
      }
    } catch {
      //
    }
  }

  useEffect(() => {
    setAssets([]);
    setBatch(null);
    setError("");
    setWarnings([]);

    void load();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    storeId,
    productId,
  ]);

  async function generate() {
    if (
      !referenceImageId
    ) {
      setError(
        "Escolha primeiro a imagem-base do produto."
      );

      return;
    }

    setLoading(true);
    setError("");
    setWarnings([]);

    try {
      const response =
        await fetch(
          `/api/products/${productId}/editorial`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                storeId,
                referenceImageId,
              }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Falha na geração."
        );
      }

      setAssets(
        data.assets ||
          []
      );

      setBatch(
        data.batch
      );

      setWarnings(
        data.warnings ||
          []
      );
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

  async function regenerate(
    asset: Asset
  ) {
    if (
      regenerating
    ) {
      return;
    }

    setRegenerating(
      asset.id
    );

    setError("");
    setWarnings([]);

    try {
      const response =
        await fetch(
          `/api/editorial-assets/${asset.id}/regenerate`,
          {
            method:
              "POST",
          }
        );

      const data =
        await response.json();

      if (
        !response.ok
      ) {
        throw new Error(
          data.error ||
            "Falha ao regenerar esta fotografia."
        );
      }

      setAssets(
        current =>
          current.map(
            item =>
              item.id ===
                asset.id
                ? {
                    ...data.asset,

                    /*
                     * Força atualização
                     * visual da imagem
                     * mesmo usando o
                     * mesmo asset id.
                     */
                    version:
                      data.asset
                        ?.version ||
                      Date.now(),
                  }
                : item
          )
      );

      if (
        data.warning
      ) {
        setWarnings([
          data.warning,
        ]);
      }
    } catch (err) {
      setError(
        err instanceof
          Error
          ? err.message
          : "Erro inesperado ao regenerar."
      );
    } finally {
      setRegenerating(
        null
      );
    }
  }


  async function toggle(
    asset: Asset
  ) {
    if (
      asset.auditPassed ===
      false
    ) {
      return;
    }

    setSelecting(
      asset.id
    );

    setError("");

    try {
      const response =
        await fetch(
          `/api/editorial-assets/${asset.id}`,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                selected:
                  !asset.selected,
              }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Falha ao selecionar."
        );
      }

      setAssets(
        current =>
          current.map(
            item =>
              item.id ===
              asset.id
                ? {
                    ...item,
                    selected:
                      data.selected,
                  }
                : item
          )
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro inesperado."
      );
    } finally {
      setSelecting(
        null
      );
    }
  }

  if (
    productStatus !==
      "READY" ||
    stores.length ===
      0
  ) {
    return null;
  }

  const selectedCount =
    assets.filter(
      asset =>
        asset.selected
    ).length;

  return (
    <section className="rounded-2xl border border-emerald-900 bg-emerald-950/20 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
        AI Editorial Studio
      </p>

      <h2 className="mt-2 text-2xl font-semibold">
        Fotografias comerciais
      </h2>

      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Uma única fotografia real funciona como fonte absoluta da verdade. A IA pode mudar cenário, iluminação e contexto — mas não o produto.
      </p>

      <label className="mt-6 block">
        <span className="mb-2 block text-sm text-zinc-400">
          Loja de destino
        </span>

        <select
          value={
            storeId
          }
          onChange={(
            event
          ) =>
            setStoreId(
              event.target
                .value
            )
          }
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3"
        >
          {stores.map(
            store => (
              <option
                key={
                  store.id
                }
                value={
                  store.id
                }
              >
                {
                  store.name
                }
              </option>
            )
          )}
        </select>
      </label>

      <div className="mt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">
              Imagem-base
            </p>

            <p className="mt-1 text-sm text-zinc-500">
              Escolha a imagem que mostra exatamente o produto/variante que deverá aparecer nas fotografias.
            </p>
          </div>

          <span className="rounded-full border border-emerald-800 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-300">
            Reference Lock
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {availableReferences.map(
            image => {
              const active =
                image.id ===
                referenceImageId;

              return (
                <button
                  key={
                    image.id
                  }
                  type="button"
                  onClick={() =>
                    setReferenceImageId(
                      image.id
                    )
                  }
                  className={`relative overflow-hidden rounded-xl border bg-white ${
                    active
                      ? "border-emerald-500 ring-2 ring-emerald-500/30"
                      : "border-zinc-700 opacity-70 hover:opacity-100"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      image.url
                    }
                    alt=""
                    className="aspect-square w-full object-contain"
                  />

                  <span
                    className={`absolute bottom-2 left-2 rounded-full px-2 py-1 text-[10px] font-bold ${
                      active
                        ? "bg-emerald-500 text-zinc-950"
                        : "bg-zinc-950/90 text-white"
                    }`}
                  >
                    {active
                      ? "✓ BASE"
                      : "Escolher"}
                  </span>
                </button>
              );
            }
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-zinc-500">
          {batch
            ? `Lote ${batch} · ${selectedCount} selecionada(s)`
            : "Nenhum lote auditado gerado."}
        </p>

        <button
          type="button"
          onClick={
            generate
          }
          disabled={
            loading ||
            !referenceImageId
          }
          className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading
            ? "Gerando + auditando..."
            : assets.length
              ? "Gerar novas fotografias"
              : "Gerar fotografias editoriais"}
        </button>
      </div>

      {loading && (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm leading-6 text-zinc-400">
          Cada fotografia é criada pelo FLUX e depois comparada com a imagem-base. Se o produto mudar, a tentativa é reprovada.
        </div>
      )}

      {warnings.length >
        0 && (
        <div className="mt-4 rounded-xl border border-amber-900 bg-amber-950/30 p-4 text-sm leading-6 text-amber-200">
          {warnings.map(
            warning => (
              <p
                key={
                  warning
                }
              >
                {warning}
              </p>
            )
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {assets.length >
        0 && (
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {assets.map(
            asset => {
              const score =
                asset.fidelityScore !==
                null
                  ? Math.round(
                      asset.fidelityScore *
                        100
                    )
                  : null;

              return (
                <article
                  key={
                    asset.id
                  }
                  className={`overflow-hidden rounded-2xl border ${
                    asset.selected
                      ? "border-emerald-500 ring-2 ring-emerald-500/20"
                      : asset.auditPassed ===
                          false
                        ? "border-red-900"
                        : "border-zinc-800"
                  }`}
                >
                  <div className="relative bg-zinc-950">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${asset.imageUrl}?batch=${asset.batch}&v=${asset.version || 0}`}
                      alt={
                        labels[
                          asset.type
                        ] ||
                        "Fotografia editorial"
                      }
                      className="aspect-square w-full object-cover"
                    />

                    <div className="absolute left-3 top-3">
                      {asset.auditPassed ===
                      true ? (
                        <span className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-zinc-950 shadow">
                          ✓ Fidelidade{" "}
                          {score}%
                        </span>
                      ) : asset.auditPassed ===
                        false ? (
                        <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white shadow">
                          Reprovada{" "}
                          {score}%
                        </span>
                      ) : (
                        <span className="rounded-full bg-zinc-950/90 px-3 py-1 text-xs font-medium text-white">
                          Revisão manual
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="bg-zinc-950 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">
                          {labels[
                            asset.type
                          ] ||
                            asset.type}
                        </p>

                        <p className="mt-1 text-xs text-zinc-600">
                          Lote{" "}
                          {
                            asset.batch
                          }
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <button
                          type="button"
                          disabled={
                            selecting ===
                              asset.id ||
                            regenerating ===
                              asset.id ||
                            asset.auditPassed !==
                              true
                          }
                          onClick={() =>
                            void toggle(
                              asset
                            )
                          }
                          className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                            asset.selected
                              ? "bg-emerald-500 text-zinc-950"
                              : "border border-zinc-700 text-zinc-300"
                          }`}
                        >
                          {asset.auditPassed ===
                          false
                            ? "Bloqueada"
                            : asset.auditPassed !==
                                true
                              ? "Aguardando auditoria"
                              : asset.selected
                                ? "✓ Usar"
                                : "Selecionar"}
                        </button>

                        {asset.auditPassed ===
                          false && (
                          <button
                            type="button"
                            onClick={() =>
                              void regenerate(
                                asset
                              )
                            }
                            disabled={
                              regenerating !==
                                null ||
                              loading
                            }
                            className="rounded-lg border border-amber-700 bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-950/60 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {regenerating ===
                            asset.id
                              ? "Regenerando + auditando..."
                              : "Regenerar somente esta"}
                          </button>
                        )}
                      </div>
                    </div>

                    {asset.auditPassed ===
                      false &&
                      asset.auditIssues
                        .length >
                        0 && (
                        <p className="mt-3 rounded-lg border border-red-950 bg-red-950/30 p-3 text-xs leading-5 text-red-300">
                          {asset.auditIssues
                            .slice(
                              0,
                              3
                            )
                            .join(
                              " • "
                            )}
                        </p>
                      )}
                  </div>
                </article>
              );
            }
          )}
        </div>
      )}

      <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm leading-6 text-zinc-500">
        Imagens reprovadas ficam bloqueadas. Mesmo depois da auditoria automática, você continua decidindo quais fotografias aprovadas serão usadas.
      </div>
    </section>
  );
}
