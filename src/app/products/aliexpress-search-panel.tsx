'use client';

import {
  FormEvent,
  useMemo,
  useState,
} from 'react';

type VerifiedShippingCheck = {
  checked: boolean;
  hasUsWarehouse: boolean;
  hasUsInStock: boolean;
  usTotalStock: number;
  dispatchCountry: string;
  countries: string[];
  deliveryMinDays: number | null;
  deliveryMaxDays: number | null;
  ambDisplayMinDays: number | null;
  ambDisplayMaxDays: number | null;
  freightCostUsd: number | null;
  serviceName: string | null;
  error: string | null;
};

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
  shippingCheck?: VerifiedShippingCheck;
};

type SearchResponse = {
  ok: boolean;
  count?: number;
  inspectedCount?: number;
  usWarehouseCount?: number;
  partial?: boolean;
  verified?: boolean;
  per_page?: number;
  current_page?: number;
  total_pages?: number;
  next?: string | null;
  previous?: string | null;
  currency?: string;
  results?: OmkarSearchResult[];
  error?: string;
};

const QUICK_SEARCH_PRESETS = [
  'women velvet midi dress',
  'women winter sweater dress',
  'women wool trench coat',
  'women satin cocktail dress',
  'women knit cardigan set',
  'women linen midi dress',
];

export function AliExpressSearchPanel() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [verifyUs, setVerifyUs] = useState(true);
  const [usOnly, setUsOnly] = useState(true);
  const [maxDays, setMaxDays] = useState<string>('10');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<OmkarSearchResult[]>([]);
  const [meta, setMeta] = useState<Pick<SearchResponse, 'count' | 'inspectedCount' | 'usWarehouseCount' | 'partial' | 'verified' | 'current_page' | 'total_pages' | 'next' | 'previous' | 'error'>>({});
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const currency = useMemo(() => results?.[0]?.pricing?.currency ?? 'USD', [results]);

  async function runSearch(searchTerm: string, targetPage = 1) {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;

    setLoading(true);
    setImportMessage(null);
    setPage(targetPage);

    try {
      const params = new URLSearchParams({
        query: trimmed,
        page: String(targetPage),
      });
      if (verifyUs || usOnly) params.set('verifyUs', '1');
      if (usOnly) params.set('usOnly', '1');
      if (maxDays && Number(maxDays) > 0) params.set('maxDays', maxDays);

      const response = await fetch(`/api/aliexpress/search?${params.toString()}`, { cache: 'no-store' });
      const rawText = await response.text();
      let data: SearchResponse | null = null;
      if (rawText) {
        try {
          data = JSON.parse(rawText) as SearchResponse;
        } catch {
          data = null;
        }
      }

      if (!data) {
        setMeta({
          error: response.status === 502 || response.status === 504
            ? `A busca no AliExpress demorou além do limite (HTTP ${response.status}). Clique em Buscar novamente ou tente outro termo.`
            : `O servidor retornou uma resposta inesperada (HTTP ${response.status}). Atualize a página e tente novamente.`,
        });
        setResults([]);
      } else if (!response.ok || !data.ok) {
        setMeta({ error: data.error || `Falha na busca (HTTP ${response.status}).` });
        setResults([]);
      } else {
        setMeta({
          count: data.count ?? 0,
          inspectedCount: data.inspectedCount,
          usWarehouseCount: data.usWarehouseCount,
          partial: data.partial,
          verified: data.verified,
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
    void runSearch(query, 1);
  }

  async function importProduct(item: OmkarSearchResult) {
    setImportingId(item.id);
    setImportMessage(null);

    try {
      const response = await fetch('/api/import/aliexpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `https://www.aliexpress.us/item/${item.id}.html`,
        }),
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

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
      >
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-400">
          Buscador Oficial · Armazém EUA &amp; Entrega Rápida
        </p>

        <h2 className="mt-2 text-2xl font-semibold">
          Encontre fornecedores com envio dos Estados Unidos
        </h2>

        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Verifica diretamente na API oficial do AliExpress se o anúncio possui estoque real em armazém dos EUA
          (<code>Ships From: United States</code>) e o prazo real de entrega antes de importar.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_SEARCH_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setQuery(preset);
                void runSearch(preset, 1);
              }}
              className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-300 transition hover:border-emerald-500 hover:text-emerald-300"
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            required
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ex: women velvet midi dress"
            className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
          />

          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? 'Verificando EUA...' : 'Buscar'}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-zinc-300">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={usOnly}
              onChange={(event) => {
                const checked = event.target.checked;
                setUsOnly(checked);
                if (checked) setVerifyUs(true);
              }}
            />
            <span>Somente estoque verificado nos EUA</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={verifyUs}
              onChange={(event) => {
                const checked = event.target.checked;
                setVerifyUs(checked);
                if (!checked) setUsOnly(false);
              }}
            />
            <span>Testar frete real na API oficial</span>
          </label>

          <label className="flex items-center gap-2">
            <span>Prazo máx. fornecedor:</span>
            <select
              value={maxDays}
              onChange={(event) => setMaxDays(event.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-white"
            >
              <option value="7">Até 7 dias (12–14d na loja)</option>
              <option value="10">Até 10 dias (15–18d na loja)</option>
              <option value="14">Até 14 dias (19–22d na loja)</option>
              <option value="0">Qualquer prazo</option>
            </select>
          </label>
        </div>

        {meta.error && (
          <div className="mt-4 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            {meta.error}
          </div>
        )}
      </form>

      {meta.verified && results.length === 0 && !loading && !meta.error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-900/60 bg-amber-950/20 p-5 text-sm text-amber-200">
          <span>
            Verificamos {meta.inspectedCount ?? 0} anúncios da página {meta.current_page ?? page} na API oficial ({meta.usWarehouseCount ?? 0} com armazém nos EUA{meta.partial ? ' · verificação parcial rápida' : ''}), mas nenhum atendeu a todos os filtros juntos.
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <button
                type="button"
                onClick={() => void runSearch(query, Math.max(1, page - 1))}
                className="rounded-xl border border-amber-700/60 bg-zinc-950 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-zinc-900"
              >
                Página anterior
              </button>
            )}
            <button
              type="button"
              onClick={() => void runSearch(query, page + 1)}
              className="rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
            >
              Verificar página {page + 1} →
            </button>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-400">
              {meta.count ?? 0} aprovados
              {meta.verified ? ` (de ${meta.inspectedCount ?? 0} verificados · ${meta.usWarehouseCount ?? 0} em armazém EUA)` : ''}
              {' '}· página {meta.current_page ?? page} de {meta.total_pages ?? 1}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => void runSearch(query, Math.max(1, page - 1))}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm disabled:opacity-50"
              >
                Anterior
              </button>

              <button
                type="button"
                disabled={!meta.next || loading}
                onClick={() => void runSearch(query, page + 1)}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {results.map((item) => {
              const check = item.shippingCheck;
              return (
                <article
                  key={item.id}
                  className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900"
                >
                  <div className="relative aspect-square overflow-hidden rounded-t-2xl bg-zinc-950">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.image}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                    {check?.hasUsInStock && (
                      <span className="absolute left-3 top-3 rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-zinc-950">
                        US Warehouse · {check.usTotalStock} un.
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <p className="line-clamp-2 text-sm font-medium leading-5">
                      {item.title}
                    </p>

                    {check?.checked && (
                      <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-2.5 text-xs">
                        <p className={check.hasUsInStock ? 'font-semibold text-emerald-400' : 'font-semibold text-sky-300'}>
                          Origem: {check.dispatchCountry}
                          {check.deliveryMinDays != null && check.deliveryMaxDays != null
                            ? ` · Fornecedor ${check.deliveryMinDays === check.deliveryMaxDays ? `${check.deliveryMinDays}d` : `${check.deliveryMinDays}–${check.deliveryMaxDays}d`}`
                            : ' · Prazo não informado'}
                        </p>
                        {check.ambDisplayMinDays != null && check.ambDisplayMaxDays != null && (
                          <p className="mt-1 text-zinc-400">
                            Na AMB (+5d Stripe): <strong className="text-zinc-200">{check.ambDisplayMinDays}–{check.ambDisplayMaxDays} dias</strong>
                            {check.freightCostUsd != null ? ` · Frete $${check.freightCostUsd.toFixed(2)}` : ''}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      <span>{item.orders_count != null ? `${item.orders_count} vendas` : 'Vendas não informadas'}</span>
                      {item.rating != null && <span>· ⭐ {item.rating}</span>}
                      {item.is_choice && <span>· Choice</span>}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                      <span>{item.store_name || `AliExpress #${item.id}`}</span>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
                      >
                        Abrir anúncio ↗
                      </a>
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
              );
            })}
          </div>
        </section>
      )}

      {!loading && results.length === 0 && !meta.error && !meta.verified && (
        <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
          Busque por um termo acima ou clique em um atalho para encontrar fornecedores verificados dos EUA.
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
