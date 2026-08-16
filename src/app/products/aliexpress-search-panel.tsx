'use client';

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';

type OmkarSearchResult = {
  id: string;
  title: string;
  link: string;
  image: string;
  images: string[];
  rating: number | null;
  orders_count: number | null;
  is_hot_sale: boolean | null;
  is_choice: boolean | null;
  pricing: {
    sale_price: number | null;
    original_price: number | null;
    discount_percent: number | null;
    currency: string;
    tax_rate: number | null;
    sku_id: string | null;
  };
  store_name: string | null;
  category_ids: (string | number)[];
  listed_date: string;
};

type SearchResponse = {
  ok: boolean;
  count?: number;
  per_page?: number;
  current_page?: number;
  total_pages?: number;
  next?: string | null;
  previous?: string | null;
  currency?: string;
  results?: OmkarSearchResult[];
  error?: string;
};

export function AliExpressSearchPanel() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse['results']>([]);
  const [meta, setMeta] = useState<Pick<SearchResponse, 'count' | 'current_page' | 'total_pages' | 'next' | 'previous' | 'error'>>({});
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const currency = useMemo(() => results?.[0]?.pricing?.currency ?? 'USD', [results]);

  async function search(targetPage = 1) {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setImportMessage(null);

    try {
      const endpoint = `/api/aliexpress/search?query=${encodeURIComponent(trimmed)}&page=${targetPage}`;
      const response = await fetch(endpoint, { cache: 'no-store' });
      const data = (await response.json()) as SearchResponse;

      if (!response.ok || !data.ok) {
        setMeta({ error: data.error || 'Falha na busca.' });
        setResults([]);
      } else {
        setMeta({
          count: data.count ?? 0,
          current_page: data.current_page ?? targetPage,
          total_pages: data.total_pages ?? 1,
          next: data.next ?? null,
          previous: data.previous ?? null,
          error: undefined,
        });
        setResults(data.results ?? []);
      }
    } catch (error) {
      setMeta({ error: error instanceof Error ? error.message : 'Erro inesperado na busca.' });
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    search(1);
  }

  async function importProduct(item: OmkarSearchResult) {
    setImportingId(item.id);
    setImportMessage(null);

    try {
      const response = await fetch('/api/import/aliexpress/omkar-search-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: item.id }),
      });

      const text = await response.text();
      let data: { error?: string; product?: unknown } = {};

      if (text) {
        try {
          data = JSON.parse(text) as typeof data;
        } catch {
          data = { error: `Resposta inválida do servidor (HTTP ${response.status}).` };
        }
      }

      if (!response.ok) {
        setImportMessage(data.error || 'Não foi possível importar este produto.');
        return;
      }

      setImportMessage(`Produto importado com sucesso: ${item.title}`);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'Erro inesperado ao importar.');
    } finally {
      setImportingId(null);
    }
  }

  useEffect(() => {
    if (page <= 1) return;
    search(page);
  }, [page]);

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
      >
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-400">
          Buscar no AliExpress
        </p>

        <h2 className="mt-2 text-2xl font-semibold">
          Encontre produtos por texto
        </h2>

        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Usa o catálogo do Omkar para buscar produtos. Depois você pode importar
          diretamente para o banco.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            required
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ex: rubber duck"
            className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
          />

          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
        </div>

        {meta.error && (
          <div className="mt-4 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            {meta.error}
          </div>
        )}
      </form>

      {results.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-400">
              {meta.count ?? 0} resultados · página {meta.current_page ?? page} de {meta.total_pages ?? 1}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm disabled:opacity-50"
              >
                Anterior
              </button>

              <button
                type="button"
                disabled={!meta.next || loading}
                onClick={() => setPage((current) => current + 1)}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {results.map((item) => (
              <article
                key={item.id}
                className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900"
              >
                <div className="aspect-square overflow-hidden rounded-t-2xl bg-zinc-950">
                  <img
                    src={item.image}
                    alt={item.title}
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <p className="line-clamp-2 text-sm font-medium leading-5">
                    {item.title}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span>{item.orders_count != null ? `${item.orders_count} vendas` : 'Vendas não informadas'}</span>
                    {item.rating != null && <span>· ⭐ {item.rating}</span>}
                    {item.is_choice && <span>· Choice</span>}
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
                    {item.store_name && <span>{item.store_name}</span>}
                    <span>· {item.listed_date}</span>
                  </div>

                  <div className="mt-auto flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xl font-semibold">
                        {item.pricing.sale_price != null ? `${item.pricing.sale_price.toFixed(2)}` : '—'}
                        <span className="ml-1 text-sm text-zinc-400">{currency}</span>
                      </p>

                      {item.pricing.original_price != null && item.pricing.original_price !== item.pricing.sale_price && (
                        <p className="text-xs text-zinc-500 line-through">
                          {item.pricing.original_price.toFixed(2)} {currency}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={importingId === item.id}
                      onClick={() => importProduct(item)}
                      className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
                    >
                      {importingId === item.id ? 'Importando...' : 'Importar'}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {!loading && results.length === 0 && !meta.error && (
        <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
          Busque por um termo para ver produtos do AliExpress.
        </div>
      )}

      {importMessage && (
        <div className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-300">
          {importMessage}
        </div>
      )}
    </div>
  );
}
