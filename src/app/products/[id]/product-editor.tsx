"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useRouter } from "next/navigation";

type ProductImage = {
  id: string;
  sourceUrl: string;
  selected: boolean;
};

type ProductVariant = {
  id: string;
  sourceSkuId: string;
  attributes: Record<string, string>;
  costPrice: string | null;
  salePrice: string | null;
  sourceCurrency: string | null;
  stock: number | null;
  available: boolean;
};

type Props = {
  productId: string;
  status: string;

  optimizedTitle: string;
  headline: string;
  shortDescription: string;
  benefits: string[];
  cta: string;

  seoTitle: string;
  seoDescription: string;

  compareAtPrice: string | null;

  images: ProductImage[];
  variants: ProductVariant[];
};

function formatBRL(value: number) {
  return new Intl.NumberFormat(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
    }
  ).format(value);
}

function inputMoney(value: number) {
  return value
    .toFixed(2)
    .replace(".", ",");
}

function endingPrice(
  value: number,
  ending: "90" | "99" | "none"
) {
  if (ending === "none") {
    return Math.round(value * 100) / 100;
  }

  const cents =
    ending === "90"
      ? 0.9
      : 0.99;

  const integer =
    Math.floor(value);

  let candidate =
    integer + cents;

  if (candidate < value) {
    candidate =
      integer + 1 + cents;
  }

  return Math.round(
    candidate * 100
  ) / 100;
}

export function ProductEditor(
  props: Props
) {
  const router =
    useRouter();

  const [
    optimizedTitle,
    setOptimizedTitle,
  ] = useState(
    props.optimizedTitle
  );

  const [
    headline,
    setHeadline,
  ] = useState(
    props.headline
  );

  const [
    shortDescription,
    setShortDescription,
  ] = useState(
    props.shortDescription
  );

  const [
    benefits,
    setBenefits,
  ] = useState(
    props.benefits.join("\n")
  );

  const [
    cta,
    setCta,
  ] = useState(
    props.cta
  );

  const [
    seoTitle,
    setSeoTitle,
  ] = useState(
    props.seoTitle
  );

  const [
    seoDescription,
    setSeoDescription,
  ] = useState(
    props.seoDescription
  );

  const [
    compareAtPrice,
    setCompareAtPrice,
  ] = useState(
    props.compareAtPrice || ""
  );

  const [
    selectedImages,
    setSelectedImages,
  ] = useState(
    new Set(
      props.images
        .filter(
          (image) =>
            image.selected
        )
        .map(
          (image) =>
            image.id
        )
    )
  );

  const [
    prices,
    setPrices,
  ] = useState<
    Record<string, string>
  >(
    Object.fromEntries(
      props.variants.map(
        (variant) => [
          variant.id,
          variant.salePrice ||
            "",
        ]
      )
    )
  );

  const [
    fxRate,
    setFxRate,
  ] = useState<number | null>(
    null
  );

  const [
    fxDate,
    setFxDate,
  ] = useState<string | null>(
    null
  );

  const [
    multiplier,
    setMultiplier,
  ] = useState("2,5");

  const [
    reserve,
    setReserve,
  ] = useState("0");

  const [
    ending,
    setEnding,
  ] = useState<
    "90" | "99" | "none"
  >("90");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    approving,
    setApproving,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    error,
    setError,
  ] = useState("");

  useEffect(() => {
    fetch(
      "/api/fx/usd-brl",
      {
        cache: "no-store",
      }
    )
      .then(
        async (response) => {
          const data =
            await response.json();

          if (
            response.ok &&
            data.rate
          ) {
            setFxRate(
              Number(
                data.rate
              )
            );

            setFxDate(
              data.date ||
                null
            );
          }
        }
      )
      .catch(() => {});
  }, []);

  const selectedCount =
    selectedImages.size;

  const minimumSale =
    useMemo(() => {
      const values =
        Object.values(
          prices
        )
          .map((value) =>
            Number(
              value
                .replace(
                  /\./g,
                  ""
                )
                .replace(
                  ",",
                  "."
                )
            )
          )
          .filter(
            (value) =>
              Number.isFinite(
                value
              ) &&
              value > 0
          );

      if (
        values.length === 0
      ) {
        return null;
      }

      return Math.min(
        ...values
      );
    }, [prices]);

  function toggleImage(
    imageId: string
  ) {
    setSelectedImages(
      (current) => {
        const next =
          new Set(
            current
          );

        if (
          next.has(imageId)
        ) {
          next.delete(
            imageId
          );
        } else {
          next.add(
            imageId
          );
        }

        return next;
      }
    );
  }

  function calculateSuggestions() {
    setError("");
    setMessage("");

    if (!fxRate) {
      setError(
        "A cotação USD/BRL ainda não foi carregada."
      );

      return;
    }

    const multiplierValue =
      Number(
        multiplier.replace(
          ",",
          "."
        )
      );

    const reserveValue =
      Number(
        reserve.replace(
          ",",
          "."
        )
      );

    if (
      !Number.isFinite(
        multiplierValue
      ) ||
      multiplierValue <= 0
    ) {
      setError(
        "Informe um multiplicador válido."
      );

      return;
    }

    if (
      !Number.isFinite(
        reserveValue
      ) ||
      reserveValue < 0
    ) {
      setError(
        "Informe uma reserva percentual válida."
      );

      return;
    }

    const next = {
      ...prices,
    };

    for (
      const variant of
        props.variants
    ) {
      if (
        !variant.costPrice
      ) {
        continue;
      }

      const cost =
        Number(
          variant.costPrice
        );

      if (
        !Number.isFinite(
          cost
        )
      ) {
        continue;
      }

      let costBRL:
        | number
        | null = null;

      if (
        variant.sourceCurrency ===
        "USD"
      ) {
        costBRL =
          cost *
          fxRate;
      } else if (
        variant.sourceCurrency ===
        "BRL"
      ) {
        costBRL =
          cost;
      }

      if (
        costBRL === null
      ) {
        continue;
      }

      const raw =
        costBRL *
        multiplierValue *
        (1 +
          reserveValue /
            100);

      const suggested =
        endingPrice(
          raw,
          ending
        );

      next[
        variant.id
      ] =
        inputMoney(
          suggested
        );
    }

    setPrices(next);

    setMessage(
      "Sugestões calculadas. Você pode alterar qualquer valor manualmente."
    );
  }

  async function saveDraft() {
    const response =
      await fetch(
        `/api/products/${props.productId}/edit`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            optimizedTitle,
            headline,
            shortDescription,

            benefits:
              benefits
                .split("\n")
                .map(
                  (item) =>
                    item.trim()
                )
                .filter(Boolean),

            cta,
            seoTitle,
            seoDescription,
            compareAtPrice,

            selectedImageIds:
              Array.from(
                selectedImages
              ),

            variantPrices:
              props.variants.map(
                (variant) => ({
                  id:
                    variant.id,

                  salePrice:
                    prices[
                      variant.id
                    ] || "",
                })
              ),
          }),
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
          "Não foi possível salvar."
      );
    }

    return data;
  }

  async function save() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      await saveDraft();

      setMessage(
        "Revisão salva como rascunho."
      );

      router.refresh();
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

  async function approve() {
    setApproving(true);
    setError("");
    setMessage("");

    try {
      await saveDraft();

      const response =
        await fetch(
          `/api/products/${props.productId}/approve`,
          {
            method: "POST",
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Não foi possível aprovar."
        );
      }

      setMessage(
        "Produto aprovado e pronto para a etapa de publicação."
      );

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro inesperado."
      );
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-emerald-900 bg-emerald-950/20 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
          Editor comercial
        </p>

        <p className="mt-2 text-sm text-zinc-500">
          Edite livremente antes de enviar para qualquer loja.
        </p>

        <div className="mt-6 space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">
              Título comercial
            </span>

            <input
              value={
                optimizedTitle
              }
              onChange={(
                event
              ) =>
                setOptimizedTitle(
                  event.target
                    .value
                )
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">
              Headline
            </span>

            <input
              value={
                headline
              }
              onChange={(
                event
              ) =>
                setHeadline(
                  event.target
                    .value
                )
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">
              Descrição
            </span>

            <textarea
              rows={5}
              value={
                shortDescription
              }
              onChange={(
                event
              ) =>
                setShortDescription(
                  event.target
                    .value
                )
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">
              Benefícios
            </span>

            <span className="mb-2 block text-xs text-zinc-600">
              Um por linha.
            </span>

            <textarea
              rows={6}
              value={
                benefits
              }
              onChange={(
                event
              ) =>
                setBenefits(
                  event.target
                    .value
                )
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">
              CTA
            </span>

            <input
              value={cta}
              onChange={(
                event
              ) =>
                setCta(
                  event.target
                    .value
                )
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="font-medium">
          SEO
        </p>

        <div className="mt-4 space-y-4">
          <input
            value={
              seoTitle
            }
            onChange={(
              event
            ) =>
              setSeoTitle(
                event.target
                  .value
              )
            }
            placeholder="Título SEO"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-emerald-500"
          />

          <textarea
            rows={3}
            value={
              seoDescription
            }
            onChange={(
              event
            ) =>
              setSeoDescription(
                event.target
                  .value
              )
            }
            placeholder="Meta description"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-emerald-500"
          />
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="font-medium">
          Imagens da página
        </p>

        <p className="mt-1 text-sm text-zinc-500">
          {selectedCount} de{" "}
          {props.images.length} selecionadas.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
          {props.images.map(
            (image) => {
              const selected =
                selectedImages.has(
                  image.id
                );

              return (
                <button
                  key={image.id}
                  type="button"
                  onClick={() =>
                    toggleImage(
                      image.id
                    )
                  }
                  className={`relative overflow-hidden rounded-xl border bg-white ${
                    selected
                      ? "border-emerald-500 ring-2 ring-emerald-500/30"
                      : "border-zinc-700 opacity-60"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      image.sourceUrl
                    }
                    alt=""
                    className="aspect-square w-full object-contain"
                  />

                  <span
                    className={`absolute right-2 top-2 rounded-full px-2 py-1 text-xs font-semibold ${
                      selected
                        ? "bg-emerald-500 text-zinc-950"
                        : "bg-zinc-950 text-white"
                    }`}
                  >
                    {selected
                      ? "✓ Usar"
                      : "Ignorar"}
                  </span>
                </button>
              );
            }
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="font-medium">
          Precificação
        </p>

        <p className="mt-2 text-sm leading-6 text-zinc-500">
          A ferramenta apenas calcula sugestões.
          Você continua definindo o preço final.
        </p>

        {fxRate && (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-xs text-zinc-500">
              Referência USD → BRL
            </p>

            <p className="mt-1 text-xl font-semibold">
              US$ 1 ={" "}
              {formatBRL(
                fxRate
              )}
            </p>

            {fxDate && (
              <p className="mt-1 text-xs text-zinc-600">
                Data da cotação:{" "}
                {fxDate}
              </p>
            )}
          </div>
        )}

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <label>
            <span className="mb-2 block text-xs text-zinc-500">
              Multiplicador
            </span>

            <input
              value={
                multiplier
              }
              onChange={(
                event
              ) =>
                setMultiplier(
                  event.target
                    .value
                )
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
            />
          </label>

          <label>
            <span className="mb-2 block text-xs text-zinc-500">
              Reserva adicional %
            </span>

            <input
              value={
                reserve
              }
              onChange={(
                event
              ) =>
                setReserve(
                  event.target
                    .value
                )
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
            />
          </label>

          <label>
            <span className="mb-2 block text-xs text-zinc-500">
              Final
            </span>

            <select
              value={
                ending
              }
              onChange={(
                event
              ) =>
                setEnding(
                  event.target
                    .value as
                    | "90"
                    | "99"
                    | "none"
                )
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
            >
              <option value="90">
                ,90
              </option>

              <option value="99">
                ,99
              </option>

              <option value="none">
                sem ajuste
              </option>
            </select>
          </label>

          <button
            type="button"
            onClick={
              calculateSuggestions
            }
            className="self-end rounded-xl border border-emerald-800 bg-emerald-950/40 px-4 py-2 font-semibold text-emerald-300"
          >
            Calcular sugestões
          </button>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-950 text-zinc-500">
              <tr>
                <th className="px-4 py-3">
                  Variante
                </th>

                <th className="px-4 py-3">
                  Custo
                </th>

                <th className="px-4 py-3">
                  Custo BRL
                </th>

                <th className="px-4 py-3">
                  Estoque
                </th>

                <th className="px-4 py-3">
                  Venda BRL
                </th>
              </tr>
            </thead>

            <tbody>
              {props.variants.map(
                (variant) => {
                  const cost =
                    variant.costPrice
                      ? Number(
                          variant.costPrice
                        )
                      : null;

                  const costBRL =
                    cost !== null &&
                    fxRate &&
                    variant.sourceCurrency ===
                      "USD"
                      ? cost *
                        fxRate
                      : variant.sourceCurrency ===
                          "BRL"
                        ? cost
                        : null;

                  return (
                    <tr
                      key={
                        variant.id
                      }
                      className="border-t border-zinc-800"
                    >
                      <td className="px-4 py-3">
                        {Object.entries(
                          variant.attributes
                        )
                          .map(
                            ([
                              key,
                              value,
                            ]) =>
                              `${key}: ${value}`
                          )
                          .join(" · ") ||
                          "Padrão"}
                      </td>

                      <td className="px-4 py-3">
                        {variant.costPrice ||
                          "—"}{" "}
                        {variant.sourceCurrency}
                      </td>

                      <td className="px-4 py-3">
                        {costBRL !== null
                          ? formatBRL(
                              costBRL
                            )
                          : "—"}
                      </td>

                      <td className="px-4 py-3">
                        {variant.stock ??
                          "—"}
                      </td>

                      <td className="px-4 py-3">
                        <input
                          value={
                            prices[
                              variant.id
                            ] || ""
                          }
                          onChange={(
                            event
                          ) =>
                            setPrices(
                              (
                                current
                              ) => ({
                                ...current,

                                [variant.id]:
                                  event
                                    .target
                                    .value,
                              })
                            )
                          }
                          placeholder="0,00"
                          className="w-28 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-emerald-500"
                        />
                      </td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </div>

        <label className="mt-5 block max-w-sm">
          <span className="mb-2 block text-sm text-zinc-500">
            Preço comparativo “de”
          </span>

          <input
            value={
              compareAtPrice
            }
            onChange={(
              event
            ) =>
              setCompareAtPrice(
                event.target
                  .value
              )
            }
            placeholder="Opcional"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3"
          />
        </label>

        {minimumSale !== null && (
          <p className="mt-4 text-sm text-zinc-400">
            Menor preço configurado:{" "}
            <strong className="text-white">
              {formatBRL(
                minimumSale
              )}
            </strong>
          </p>
        )}
      </section>

      {message && (
        <div className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-300">
          {message}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={save}
          disabled={loading}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-3 font-semibold hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading
            ? "Salvando..."
            : "Salvar revisão"}
        </button>

        <button
          type="button"
          onClick={approve}
          disabled={
            approving ||
            loading
          }
          className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {approving
            ? "Aprovando..."
            : "Salvar e aprovar produto"}
        </button>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
        Aprovar ainda não publica nada em nenhuma loja.
      </div>
    </div>
  );
}
