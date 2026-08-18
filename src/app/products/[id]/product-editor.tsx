"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import {
  calculateSaleSuggestion,
  convertSupplierCost,
  type PriceEnding,
} from "@/lib/product-pricing";

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

type PricingRate = {
  rate: number;
  date: string | null;
};

function currencyLocale(currency: string) {
  if (currency === "BRL") return "pt-BR";
  if (currency === "EUR") return "de-DE";
  return "en-US";
}

function formatCurrency(
  value: number,
  currency: string
) {
  return new Intl.NumberFormat(
    currencyLocale(currency),
    {
      style: "currency",
      currency,
    }
  ).format(value);
}

function inputMoney(
  value: number,
  currency: string
) {
  const fixed = value.toFixed(2);
  return currency === "USD"
    ? fixed
    : fixed.replace(".", ",");
}

function parseInputMoney(value: string) {
  let text = value
    .trim()
    .replace(/[^0-9,.-]/g, "");

  if (!text) return null;

  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");

  if (comma >= 0 && dot >= 0) {
    if (comma > dot) {
      text = text
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (comma >= 0) {
    text = text.replace(",", ".");
  }

  const number = Number(text);
  return Number.isFinite(number)
    ? number
    : null;
}

function initialPrices(variants: ProductVariant[]) {
  return Object.fromEntries(
    variants.map((variant) => [
      variant.id,
      variant.salePrice || "",
    ])
  );
}

export function ProductEditor(props: Props) {
  const router = useRouter();
  const [optimizedTitle, setOptimizedTitle] =
    useState(props.optimizedTitle);
  const [headline, setHeadline] =
    useState(props.headline);
  const [shortDescription, setShortDescription] =
    useState(props.shortDescription);
  const [benefits, setBenefits] =
    useState(props.benefits.join("\n"));
  const [cta, setCta] = useState(props.cta);
  const [seoTitle, setSeoTitle] =
    useState(props.seoTitle);
  const [seoDescription, setSeoDescription] =
    useState(props.seoDescription);
  const [compareAtPrice, setCompareAtPrice] =
    useState(props.compareAtPrice || "");
  const [selectedImages, setSelectedImages] =
    useState(
      new Set(
        props.images
          .filter((image) => image.selected)
          .map((image) => image.id)
      )
    );
  const [prices, setPrices] =
    useState<Record<string, string>>(
      initialPrices(props.variants)
    );
  const [storeCurrency, setStoreCurrency] =
    useState("BRL");
  const [currencyLoading, setCurrencyLoading] =
    useState(true);
  const [pricingRates, setPricingRates] =
    useState<Record<string, PricingRate>>({});
  const [multiplier, setMultiplier] =
    useState("2,5");
  const [reserve, setReserve] =
    useState("0");
  const [ending, setEnding] =
    useState<PriceEnding>("90");
  const [loading, setLoading] =
    useState(false);
  const [approving, setApproving] =
    useState(false);
  const [message, setMessage] =
    useState("");
  const [error, setError] =
    useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOptimizedTitle(props.optimizedTitle);
      setHeadline(props.headline);
      setShortDescription(props.shortDescription);
      setBenefits(props.benefits.join("\n"));
      setCta(props.cta);
      setSeoTitle(props.seoTitle);
      setSeoDescription(props.seoDescription);
      setCompareAtPrice(props.compareAtPrice || "");
      setPrices(initialPrices(props.variants));
      setSelectedImages(
        new Set(
          props.images
            .filter((image) => image.selected)
            .map((image) => image.id)
        )
      );
    }, 0);

    return () => window.clearTimeout(timer);
  }, [
    props.optimizedTitle,
    props.headline,
    props.shortDescription,
    props.benefits,
    props.cta,
    props.seoTitle,
    props.seoDescription,
    props.compareAtPrice,
    props.variants,
    props.images,
  ]);

  useEffect(() => {
    let active = true;
    setCurrencyLoading(true);

    fetch(
      `/api/products/${props.productId}/pricing-context`,
      {
        cache: "no-store",
      }
    )
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "Não foi possível carregar as cotações de precificação."
          );
        }

        if (!active) return;

        if (typeof data.storeCurrency === "string") {
          setStoreCurrency(
            data.storeCurrency.toUpperCase()
          );
        }

        const rates: Record<string, PricingRate> = {};
        if (
          data.rates &&
          typeof data.rates === "object" &&
          !Array.isArray(data.rates)
        ) {
          for (
            const [currency, raw]
            of Object.entries(
              data.rates as Record<string, unknown>
            )
          ) {
            if (
              raw &&
              typeof raw === "object" &&
              !Array.isArray(raw)
            ) {
              const record = raw as Record<string, unknown>;
              const rate = Number(record.rate);
              if (Number.isFinite(rate) && rate > 0) {
                rates[currency.toUpperCase()] = {
                  rate,
                  date:
                    typeof record.date === "string"
                      ? record.date
                      : null,
                };
              }
            }
          }
        }
        setPricingRates(rates);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar as cotações de precificação."
        );
      })
      .finally(() => {
        if (active) setCurrencyLoading(false);
      });

    return () => {
      active = false;
    };
  }, [props.productId, props.optimizedTitle, props.variants]);

  const selectedCount = selectedImages.size;
  const minimumSale = useMemo(() => {
    const values = Object.values(prices)
      .map(parseInputMoney)
      .filter(
        (value): value is number =>
          value !== null &&
          value > 0
      );

    return values.length
      ? Math.min(...values)
      : null;
  }, [prices]);

  const externalRates = useMemo(
    () =>
      Object.entries(pricingRates)
        .filter(
          ([currency]) =>
            currency !== storeCurrency
        )
        .sort(([left], [right]) =>
          left.localeCompare(right)
        ),
    [pricingRates, storeCurrency]
  );

  function toggleImage(imageId: string) {
    setSelectedImages((current) => {
      const next = new Set(current);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  }

  function costInSellingCurrency(
    variant: ProductVariant
  ) {
    if (!variant.costPrice) return null;
    if (!variant.sourceCurrency) return null;

    const cost = Number(variant.costPrice);
    if (!Number.isFinite(cost) || cost <= 0) {
      return null;
    }

    const sourceCurrency =
      variant.sourceCurrency.toUpperCase();
    const rate =
      sourceCurrency === storeCurrency
        ? 1
        : pricingRates[sourceCurrency]?.rate;

    try {
      return convertSupplierCost({
        cost,
        sourceCurrency,
        sellingCurrency: storeCurrency,
        rate,
      });
    } catch {
      return null;
    }
  }

  function calculateSuggestions() {
    setError("");
    setMessage("");

    if (currencyLoading) {
      setError(
        "As cotações ainda estão sendo carregadas."
      );
      return;
    }

    const multiplierValue = Number(
      multiplier.replace(",", ".")
    );
    const reserveValue = Number(
      reserve.replace(",", ".")
    );

    if (
      !Number.isFinite(multiplierValue) ||
      multiplierValue <= 0
    ) {
      setError("Informe um multiplicador válido.");
      return;
    }

    if (
      !Number.isFinite(reserveValue) ||
      reserveValue < 0
    ) {
      setError(
        "Informe uma reserva percentual válida."
      );
      return;
    }

    const eligibleVariants = props.variants.filter(
      (variant) =>
        variant.available &&
        (variant.stock === null || variant.stock > 0)
    );

    if (eligibleVariants.length === 0) {
      setError(
        "Não há variantes disponíveis para precificar."
      );
      return;
    }

    const next = { ...prices };

    try {
      for (const variant of eligibleVariants) {
        if (!variant.costPrice) {
          throw new Error(
            `A variante ${variant.sourceSkuId} está sem custo do fornecedor.`
          );
        }
        if (!variant.sourceCurrency) {
          throw new Error(
            `A variante ${variant.sourceSkuId} está sem moeda do fornecedor.`
          );
        }

        const sourceCurrency =
          variant.sourceCurrency.toUpperCase();
        const rate =
          sourceCurrency === storeCurrency
            ? 1
            : pricingRates[sourceCurrency]?.rate;

        const result = calculateSaleSuggestion({
          cost: Number(variant.costPrice),
          sourceCurrency,
          sellingCurrency: storeCurrency,
          rate,
          multiplier: multiplierValue,
          reservePercent: reserveValue,
          ending,
        });

        next[variant.id] = inputMoney(
          result.suggestedPrice,
          storeCurrency
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível calcular os preços de venda."
      );
      return;
    }

    setPrices(next);
    setMessage(
      `${eligibleVariants.length} preço(s) final(is) calculado(s) em ${storeCurrency}. Salve a revisão ou aprove o produto para gravar os valores.`
    );
  }

  async function saveDraft() {
    const response = await fetch(
      `/api/products/${props.productId}/edit`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          optimizedTitle,
          headline,
          shortDescription,
          benefits: benefits
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          cta,
          seoTitle,
          seoDescription,
          compareAtPrice,
          selectedImageIds:
            Array.from(selectedImages),
          variantPrices: props.variants.map(
            (variant) => ({
              id: variant.id,
              salePrice:
                prices[variant.id] || "",
            })
          ),
        }),
      }
    );
    const data = await response.json();

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
        `Revisão salva como rascunho em ${storeCurrency}.`
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
      const response = await fetch(
        `/api/products/${props.productId}/approve`,
        {
          method: "POST",
        }
      );
      const data = await response.json();

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

  const busy = loading || approving;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-emerald-900 bg-emerald-950/20 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
              Editor comercial
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              Edite livremente antes de enviar para qualquer loja.
            </p>
          </div>
          <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs font-semibold text-zinc-300">
            {props.status}
          </span>
        </div>

        <div className="mt-6 space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">
              Título comercial
            </span>
            <input
              value={optimizedTitle}
              onChange={(event) =>
                setOptimizedTitle(event.target.value)
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">
              Headline
            </span>
            <input
              value={headline}
              onChange={(event) =>
                setHeadline(event.target.value)
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
              value={shortDescription}
              onChange={(event) =>
                setShortDescription(event.target.value)
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
              value={benefits}
              onChange={(event) =>
                setBenefits(event.target.value)
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">
              CTA
            </span>
            <input
              value={cta}
              onChange={(event) =>
                setCta(event.target.value)
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-emerald-500"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="font-medium">SEO</p>
        <div className="mt-4 space-y-4">
          <input
            value={seoTitle}
            onChange={(event) =>
              setSeoTitle(event.target.value)
            }
            placeholder="Título SEO"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-emerald-500"
          />
          <textarea
            rows={3}
            value={seoDescription}
            onChange={(event) =>
              setSeoDescription(event.target.value)
            }
            placeholder="Meta description"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-emerald-500"
          />
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="font-medium">Imagens da página</p>
        <p className="mt-1 text-sm text-zinc-500">
          {selectedCount} de {props.images.length} selecionadas.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
          {props.images.map((image) => {
            const selected =
              selectedImages.has(image.id);

            return (
              <button
                key={image.id}
                type="button"
                onClick={() =>
                  toggleImage(image.id)
                }
                className={`relative overflow-hidden rounded-xl border bg-white ${
                  selected
                    ? "border-emerald-500 ring-2 ring-emerald-500/30"
                    : "border-zinc-700 opacity-60"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.sourceUrl}
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
                  {selected ? "✓ Usar" : "Ignorar"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">Precificação</p>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              O custo do fornecedor é convertido para a moeda de venda antes do cálculo do preço final.
            </p>
          </div>
          <span className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-zinc-950">
            {currencyLoading
              ? "Carregando cotações..."
              : `Venda em ${storeCurrency}`}
          </span>
        </div>

        {externalRates.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {externalRates.map(
              ([sourceCurrency, quote]) => (
                <div
                  key={sourceCurrency}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                >
                  <p className="text-xs text-zinc-500">
                    Referência {sourceCurrency} → {storeCurrency}
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    1 {sourceCurrency} = {formatCurrency(
                      quote.rate,
                      storeCurrency
                    )}
                  </p>
                  {quote.date && (
                    <p className="mt-1 text-xs text-zinc-600">
                      Data da cotação: {quote.date}
                    </p>
                  )}
                </div>
              )
            )}
          </div>
        )}

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <label>
            <span className="mb-2 block text-xs text-zinc-500">
              Multiplicador
            </span>
            <input
              value={multiplier}
              onChange={(event) =>
                setMultiplier(event.target.value)
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
            />
          </label>

          <label>
            <span className="mb-2 block text-xs text-zinc-500">
              Reserva adicional %
            </span>
            <input
              value={reserve}
              onChange={(event) =>
                setReserve(event.target.value)
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
            />
          </label>

          <label>
            <span className="mb-2 block text-xs text-zinc-500">
              Final
            </span>
            <select
              value={ending}
              onChange={(event) =>
                setEnding(
                  event.target.value as PriceEnding
                )
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
            >
              <option value="90">
                {storeCurrency === "USD" ? ".90" : ",90"}
              </option>
              <option value="99">
                {storeCurrency === "USD" ? ".99" : ",99"}
              </option>
              <option value="none">
                sem ajuste
              </option>
            </select>
          </label>

          <button
            type="button"
            onClick={calculateSuggestions}
            disabled={currencyLoading}
            className="self-end rounded-xl border border-emerald-800 bg-emerald-950/40 px-4 py-2 font-semibold text-emerald-300 disabled:opacity-50"
          >
            Calcular sugestões
          </button>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-950 text-zinc-500">
              <tr>
                <th className="px-4 py-3">Variante</th>
                <th className="px-4 py-3">Custo</th>
                <th className="px-4 py-3">
                  Custo {storeCurrency}
                </th>
                <th className="px-4 py-3">Estoque</th>
                <th className="px-4 py-3">
                  Venda {storeCurrency}
                </th>
              </tr>
            </thead>
            <tbody>
              {props.variants.map((variant) => {
                const convertedCost =
                  costInSellingCurrency(variant);

                return (
                  <tr
                    key={variant.id}
                    className="border-t border-zinc-800"
                  >
                    <td className="px-4 py-3">
                      {Object.entries(
                        variant.attributes
                      )
                        .map(
                          ([key, value]) =>
                            `${key}: ${value}`
                        )
                        .join(" · ") || "Padrão"}
                    </td>
                    <td className="px-4 py-3">
                      {variant.costPrice || "—"}{" "}
                      {variant.sourceCurrency}
                    </td>
                    <td className="px-4 py-3">
                      {convertedCost !== null
                        ? formatCurrency(
                            convertedCost,
                            storeCurrency
                          )
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {variant.stock ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={prices[variant.id] || ""}
                        onChange={(event) =>
                          setPrices((current) => ({
                            ...current,
                            [variant.id]:
                              event.target.value,
                          }))
                        }
                        placeholder={
                          storeCurrency === "USD"
                            ? "0.00"
                            : "0,00"
                        }
                        className="w-28 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-emerald-500"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <label className="mt-5 block max-w-sm">
          <span className="mb-2 block text-sm text-zinc-500">
            Preço comparativo “de” ({storeCurrency})
          </span>
          <input
            value={compareAtPrice}
            onChange={(event) =>
              setCompareAtPrice(event.target.value)
            }
            placeholder="Opcional"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3"
          />
        </label>

        {minimumSale !== null && (
          <p className="mt-4 text-sm text-zinc-400">
            Menor preço configurado:{" "}
            <strong className="text-white">
              {formatCurrency(
                minimumSale,
                storeCurrency
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
          disabled={busy}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-3 font-semibold hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading
            ? "Salvando..."
            : "Salvar revisão"}
        </button>
        <button
          type="button"
          onClick={approve}
          disabled={busy}
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
