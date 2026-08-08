"use client";

import {
  useEffect,
  useState,
} from "react";

type Store = {
  id: string;
  name: string;
  baseUrl: string;
};

type Category = {
  id: string;
  name: string;
  slug: string;
};

type Brand = {
  primaryColor?:
    string | null;

  secondaryColor?:
    string | null;

  accentColor?:
    string | null;

  backgroundColor?:
    string | null;

  surfaceColor?:
    string | null;

  textColor?:
    string | null;

  palette?: string[];
};

type Preview = {
  publication: {
    id: string;
    status: string;
    targetUrl: string;
  };

  payload: {
    product: {
      title: string;
      price: number;
      gallery: string[];
      stock: number;

      variants: Array<{
        sourceSkuId: string;
        name: string;
        price: number;
        stock: number;
      }>;

      shipping: {
        weightGrams: number;
        lengthCm: number;
        widthCm: number;
        heightCm: number;
      };
    };
  };
};

function brlCents(
  value: number
) {
  return new Intl.NumberFormat(
    "pt-BR",
    {
      style:
        "currency",

      currency:
        "BRL",
    }
  ).format(
    value / 100
  );
}

function validColor(
  value:
    | string
    | null
    | undefined
) {
  return Boolean(
    value &&
    /^#[0-9a-f]{6}$/i.test(
      value
    )
  );
}

export function PublicationPanel({
  productId,
  productStatus,
  stores,
}: {
  productId:
    string;

  productStatus:
    string;

  stores:
    Store[];
}) {
  const [
    storeId,
    setStoreId,
  ] =
    useState(
      stores[0]?.id ||
        ""
    );

  const [
    categories,
    setCategories,
  ] =
    useState<
      Category[]
    >([]);

  const [
    category,
    setCategory,
  ] =
    useState("");

  const [
    brand,
    setBrand,
  ] =
    useState<
      Brand | null
    >(null);

  const [
    confidence,
    setConfidence,
  ] =
    useState<
      number | null
    >(null);

  const [
    categoryReason,
    setCategoryReason,
  ] =
    useState("");

  const [
    analyzing,
    setAnalyzing,
  ] =
    useState(false);

  const [
    ageRange,
    setAgeRange,
  ] =
    useState(
      "Consulte a indicação do fabricante"
    );

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    preview,
    setPreview,
  ] =
    useState<
      Preview | null
    >(null);

  async function analyze(
    forceRefresh =
      false
  ) {
    if (
      !storeId ||
      productStatus !==
        "READY"
    ) {
      return;
    }

    setAnalyzing(true);
    setError("");
    setPreview(null);

    try {
      const response =
        await fetch(
          `/api/products/${productId}/category-suggestion`,
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
                forceRefresh,
              }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Não foi possível analisar a loja."
        );
      }

      const nextCategories =
        Array.isArray(
          data.intelligence
            ?.categories
        )
          ? data
              .intelligence
              .categories
          : [];

      setCategories(
        nextCategories
      );

      setBrand(
        data.intelligence
          ?.brand ||
          null
      );

      setCategory(
        data.suggestion
          .categoryName
      );

      setConfidence(
        Number(
          data.suggestion
            .confidence
        )
      );

      setCategoryReason(
        data.suggestion
          .reason ||
          ""
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro inesperado."
      );

      setCategories([]);
      setCategory("");
      setBrand(null);
      setConfidence(null);
      setCategoryReason("");
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => {
    setCategories([]);
    setCategory("");
    setBrand(null);
    setConfidence(null);
    setCategoryReason("");
    setPreview(null);

    void analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    storeId,
    productId,
    productStatus,
  ]);

  async function prepare() {
    setLoading(true);
    setError("");
    setPreview(null);

    try {
      const response =
        await fetch(
          `/api/products/${productId}/publication-preview`,
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
                category,
                ageRange,
              }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Não foi possível preparar a publicação."
        );
      }

      setPreview(
        data
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

  if (
    productStatus !==
    "READY"
  ) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="font-medium">
          Publication Engine
        </p>

        <p className="mt-2 text-sm text-zinc-500">
          Aprove o produto antes de preparar a publicação.
        </p>
      </section>
    );
  }

  if (
    stores.length ===
    0
  ) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="font-medium">
          Publication Engine
        </p>

        <p className="mt-2 text-sm text-zinc-500">
          Nenhuma loja conectada.
        </p>
      </section>
    );
  }

  const palette =
    brand?.palette?.length
      ? brand.palette
      : [
          brand?.primaryColor,
          brand?.secondaryColor,
          brand?.accentColor,
          brand?.backgroundColor,
          brand?.surfaceColor,
        ].filter(
          (
            value
          ): value is string =>
            validColor(
              value
            )
        );

  return (
    <section className="rounded-2xl border border-emerald-900 bg-emerald-950/20 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
        Publication Engine
      </p>

      <h2 className="mt-2 text-2xl font-semibold">
        Loja + categoria inteligente
      </h2>

      <p className="mt-2 text-sm leading-6 text-zinc-400">
        O Manager lê a identidade e as categorias reais da loja antes de classificar o produto.
      </p>

      <div className="mt-6 space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm text-zinc-400">
            Loja
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

        {analyzing && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
            Lendo identidade visual, categorias e analisando o produto...
          </div>
        )}

        {brand && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">
              Identidade detectada
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {palette.map(
                color => (
                  <div
                    key={
                      color
                    }
                    title={
                      color
                    }
                    className="h-9 w-9 rounded-full border border-white/20"
                    style={{
                      backgroundColor:
                        color,
                    }}
                  />
                )
              )}
            </div>
          </div>
        )}

        {categories.length >
          0 && (
          <label className="block">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-zinc-400">
                Categoria sugerida
              </span>

              {confidence !==
                null && (
                <span className="rounded-full border border-emerald-800 bg-emerald-950/50 px-3 py-1 text-xs font-medium text-emerald-300">
                  Confiança{" "}
                  {Math.round(
                    confidence *
                      100
                  )}
                  %
                </span>
              )}
            </div>

            <select
              value={
                category
              }
              onChange={(
                event
              ) =>
                setCategory(
                  event.target
                    .value
                )
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3"
            >
              {categories.map(
                item => (
                  <option
                    key={
                      item.id
                    }
                    value={
                      item.name
                    }
                  >
                    {
                      item.name
                    }
                  </option>
                )
              )}
            </select>

            {categoryReason && (
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                {
                  categoryReason
                }
              </p>
            )}

            <button
              type="button"
              onClick={() =>
                void analyze(
                  true
                )
              }
              className="mt-3 text-xs font-medium text-emerald-400 hover:text-emerald-300"
            >
              Atualizar identidade e classificação
            </button>
          </label>
        )}

        <label className="block">
          <span className="mb-2 block text-sm text-zinc-400">
            Faixa etária / orientação
          </span>

          <input
            value={
              ageRange
            }
            onChange={(
              event
            ) =>
              setAgeRange(
                event.target
                  .value
              )
            }
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3"
          />
        </label>

        <button
          type="button"
          onClick={
            prepare
          }
          disabled={
            loading ||
            analyzing ||
            !storeId ||
            !category ||
            !ageRange.trim()
          }
          className="w-full rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading
            ? "Preparando..."
            : "Gerar preview da publicação"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {
            error
          }
        </div>
      )}

      {preview && (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-4">
            <p className="text-xs uppercase tracking-[0.15em] text-emerald-400">
              Preview criado
            </p>

            <p className="mt-2 font-semibold">
              {
                preview.payload
                  .product.title
              }
            </p>

            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <p className="text-xs font-medium text-zinc-500">
                URL futura — produto ainda não publicado
              </p>

              <p className="mt-1 break-all text-sm text-zinc-400">
                {
                  preview.publication
                    .targetUrl
                }
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs text-zinc-500">
                Preço inicial
              </p>

              <p className="mt-1 font-semibold">
                {brlCents(
                  preview.payload
                    .product.price
                )}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs text-zinc-500">
                Imagens
              </p>

              <p className="mt-1 font-semibold">
                {
                  preview.payload
                    .product
                    .gallery.length
                }
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs text-zinc-500">
                SKUs
              </p>

              <p className="mt-1 font-semibold">
                {
                  preview.payload
                    .product
                    .variants.length
                }
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs text-zinc-500">
                Estoque
              </p>

              <p className="mt-1 font-semibold">
                {
                  preview.payload
                    .product.stock
                }
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
            Pacote:{" "}
            {
              preview.payload
                .product
                .shipping
                .lengthCm
            }{" "}
            ×{" "}
            {
              preview.payload
                .product
                .shipping
                .widthCm
            }{" "}
            ×{" "}
            {
              preview.payload
                .product
                .shipping
                .heightCm
            }{" "}
            cm ·{" "}
            {
              preview.payload
                .product
                .shipping
                .weightGrams
            }{" "}
            g
          </div>

          <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-4 text-sm text-amber-200">
            Preview somente. Nada foi publicado na loja.
          </div>
        </div>
      )}
    </section>
  );
}
