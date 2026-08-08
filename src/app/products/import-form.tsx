"use client";

import {
  FormEvent,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type SkuPreview = {
  sku: string;
  attributes: unknown;
  price: string | null;
  stock: number | null;
  imageUrl: string | null;
};

type ImportedProduct = {
  id: string;
  sourceProductId: string;
  title: string;
  description: string | null;
  currency: string | null;
  costMin: string | null;
  costMax: string | null;
  images: number;
  variants: number;
  totalStock: number;
  seller: string | null;
  video: boolean;
  package: {
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
    weight_kg?: number | null;
  } | null;
  skuPreview: SkuPreview[];
};

export function ImportForm() {
  const router = useRouter();

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const [
    product,
    setProduct,
  ] =
    useState<ImportedProduct | null>(
      null
    );

  async function submit(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const formElement =
      event.currentTarget;

    const form =
      new FormData(
        formElement
      );

    setLoading(true);
    setError("");
    setProduct(null);

    try {
      const response =
        await fetch(
          "/api/import/aliexpress",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                url:
                  form.get(
                    "url"
                  ),
              }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Não foi possível importar o produto."
        );
      }

      setProduct(
        data.product
      );

      formElement.reset();

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

  return (
    <div className="space-y-6">
      <form
        onSubmit={submit}
        className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
      >
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-400">
          Importar produto
        </p>

        <h2 className="mt-2 text-2xl font-semibold">
          Cole a URL do AliExpress
        </h2>

        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Dados operacionais são
          extraídos antes de qualquer
          produto poder chegar às suas
          lojas.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            required
            type="url"
            name="url"
            placeholder="https://www.aliexpress.com/item/100500....html"
            className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
          />

          <button
            disabled={loading}
            className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading
              ? "Importando..."
              : "Importar produto"}
          </button>
        </div>

        {loading && (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
            Consultando ID, imagens,
            SKUs, variantes, preços,
            estoque e informações do
            fornecedor...
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            {error}
          </div>
        )}
      </form>

      {product && (
        <div className="rounded-2xl border border-emerald-900 bg-emerald-950/20 p-6">
          <p className="text-sm font-medium text-emerald-400">
            PRODUTO IMPORTADO
          </p>

          <h3 className="mt-2 text-2xl font-semibold">
            {product.title}
          </h3>

          <p className="mt-2 text-sm text-zinc-500">
            AliExpress ID:{" "}
            {product.sourceProductId}
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <div>
              <p className="text-xs text-zinc-500">
                Imagens
              </p>
              <p className="mt-1 text-xl font-semibold">
                {product.images}
              </p>
            </div>

            <div>
              <p className="text-xs text-zinc-500">
                SKUs
              </p>
              <p className="mt-1 text-xl font-semibold">
                {product.variants}
              </p>
            </div>

            <div>
              <p className="text-xs text-zinc-500">
                Estoque
              </p>
              <p className="mt-1 text-xl font-semibold">
                {product.totalStock}
              </p>
            </div>

            <div>
              <p className="text-xs text-zinc-500">
                Mínimo
              </p>
              <p className="mt-1 text-xl font-semibold">
                {product.costMin || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs text-zinc-500">
                Máximo
              </p>
              <p className="mt-1 text-xl font-semibold">
                {product.costMax || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs text-zinc-500">
                Moeda
              </p>
              <p className="mt-1 text-xl font-semibold">
                {product.currency}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                Fornecedor
              </p>

              <p className="mt-2 font-medium">
                {product.seller ||
                  "Não informado"}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                Pacote
              </p>

              <p className="mt-2 text-sm text-zinc-300">
                {product.package
                  ? `${product.package.length_cm ?? "?"} × ${product.package.width_cm ?? "?"} × ${product.package.height_cm ?? "?"} cm · ${product.package.weight_kg ?? "?"} kg`
                  : "Não informado"}
              </p>
            </div>
          </div>

          {product.skuPreview.length >
            0 && (
            <div className="mt-6">
              <p className="mb-3 text-sm font-medium text-zinc-300">
                Variantes / SKUs
              </p>

              <div className="overflow-x-auto rounded-xl border border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-950 text-zinc-500">
                    <tr>
                      <th className="px-4 py-3">
                        Variante
                      </th>

                      <th className="px-4 py-3">
                        SKU AliExpress
                      </th>

                      <th className="px-4 py-3">
                        Custo
                      </th>

                      <th className="px-4 py-3">
                        Estoque
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {product.skuPreview.map(
                      (
                        sku
                      ) => (
                        <tr
                          key={
                            sku.sku
                          }
                          className="border-t border-zinc-800"
                        >
                          <td className="px-4 py-3">
                            {Object.entries(
                              (sku.attributes ||
                                {}) as Record<
                                string,
                                string
                              >
                            )
                              .map(
                                ([
                                  key,
                                  value,
                                ]) =>
                                  `${key}: ${value}`
                              )
                              .join(
                                " · "
                              ) ||
                              "Padrão"}
                          </td>

                          <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                            {
                              sku.sku
                            }
                          </td>

                          <td className="px-4 py-3">
                            {sku.price ||
                              "—"}{" "}
                            {
                              product.currency
                            }
                          </td>

                          <td className="px-4 py-3">
                            {sku.stock ??
                              "—"}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
