'use client';

import {
  FormEvent,
  useMemo,
  useRef,
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
  tags?: string[];
  store_name: string | null;
  category_ids: (string | number)[];
  listed_date: string;
  shippingCheck?: VerifiedShippingCheck;
};

type SearchResponse = {
  ok: boolean;
  mode?: 'progressive' | 'direct';
  count?: number;
  candidateCount?: number;
  per_page?: number;
  current_page?: number;
  total_pages?: number;
  next?: string | null;
  previous?: string | null;
  currency?: string;
  candidates?: OmkarSearchResult[];
  results?: OmkarSearchResult[];
  error?: string;
};

type VerifyBatchResponse = {
  ok: boolean;
  inspectedCount?: number;
  usWarehouseCount?: number;
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

const VERIFY_BATCH_SIZE = 4;

function sortVerifiedResults(list: OmkarSearchResult[]): OmkarSearchResult[] {
  return [...list].sort((a, b) => {
    const aUs = a.shippingCheck?.hasUsInStock ? 0 : 1;
    const bUs = b.shippingCheck?.hasUsInStock ? 0 : 1;
    if (aUs !== bUs) return aUs - bUs;
    const aDays = a.shippingCheck?.deliveryMaxDays ?? 999;
    const bDays = b.shippingCheck?.deliveryMaxDays ?? 999;
    if (aDays !== bDays) return aDays - bDays;
    return (b.orders_count ?? 0) - (a.orders_count ?? 0);
  });
}

function parseJsonSafe<T>(rawText: string): T | null {
  if (!rawText) return null;
  try {
    return JSON.parse(rawText) as T;
  } catch {
    return null;
  }
}

export function AliExpressSearchPanel() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [verifyUs, setVerifyUs] = useState(true);
  const [usOnly, setUsOnly] = useState(true);
  const [maxDays, setMaxDays] = useState<string>('10');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [results, setResults] = useState<OmkarSearchResult[]>([]);
  const [pendingCandidates, setPendingCandidates] = useState<OmkarSearchResult[]>([]);
  const [meta, setMeta] = useState<{
    totalCandidates?: number;
    inspectedCount?: number;
    usWarehouseCount?: number;
    verified?: boolean;
    current_page?: number;
    total_pages?: number;
    next?: string | null;
    previous?: string | null;
    error?: string;
  }>({});
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const runTokenRef = useRef(0);
  const stopRef = useRef(false);

  const currency = useMemo(() => results?.[0]?.pricing?.currency ?? 'USD', [results]);

  async function verifyCandidatesLoop(
    queue: OmkarSearchResult[],
    token: number,
    filterUsOnly: boolean,
    filterMaxDays: number | null,
  ) {
    setVerifying(true);
    stopRef.current = false;
    let cursor = 0;

    try {
      while (cursor < queue.length && !stopRef.current && runTokenRef.current === token) {
        const batch = queue.slice(cursor, cursor + VERIFY_BATCH_SIZE);
        let batchData: VerifyBatchResponse | null = null;
        let lastErr = '';

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetch('/api/aliexpress/search/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                items: batch,
                usOnly: filterUsOnly,
                maxDays: filterMaxDays,
              }),
            });
            const text = await res.text();
            const parsed = parseJsonSafe<VerifyBatchResponse>(text);
            if (res.ok && parsed?.ok) {
              batchData = parsed;
              break;
            }
            lastErr = parsed?.error || `HTTP ${res.status}`;
          } catch (err) {
            lastErr = err instanceof Error ? err.message : 'Oscilação de rede';
          }
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
          }
        }

        if (runTokenRef.current !== token) return;

        cursor += batch.length;
        setPendingCandidates(queue.slice(cursor));

        if (!batchData) {
          setMeta((prev) => ({
            ...prev,
            inspectedCount: (prev.inspectedCount ?? 0) + batch.length,
            error: `Um lote falhou (${lastErr}), mas os itens anteriores foram mantidos.`,
          }));
          continue;
        }

        const newApproved = batchData.results ?? [];
        if (newApproved.length > 0) {
          setResults((prev) => {
            const seenIds = new Set(prev.map((r) => r.id));
            const merged = [...prev];
            for (const item of newApproved) {
              if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                merged.push(item);
              }
            }
            return sortVerifiedResults(merged);
          });
        }

        setMeta((prev) => ({
          ...prev,
          inspectedCount: (prev.inspectedCount ?? 0) + (batchData?.inspectedCount ?? batch.length),
          usWarehouseCount: (prev.usWarehouseCount ?? 0) + (batchData?.usWarehouseCount ?? 0),
          verified: true,
        }));
      }
    } finally {
      if (runTokenRef.current === token) {
        setVerifying(false);
      }
    }
  }

  async function runSearch(searchTerm: string, targetPage = 1) {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;

    const token = ++runTokenRef.current;
    stopRef.current = false;
    setLoading(true);
    setVerifying(false);
    setImportMessage(null);
    setPage(targetPage);
    setResults([]);
    setPendingCandidates([]);
    setMeta({});

    try {
      const shouldVerify = verifyUs || usOnly || Number(maxDays) > 0;
      const params = new URLSearchParams({
        query: trimmed,
        page: String(targetPage),
      });
      if (verifyUs || usOnly) params.set('verifyUs', '1');
      if (usOnly) params.set('usOnly', '1');
      if (maxDays && Number(maxDays) > 0) params.set('maxDays', maxDays);

      const response = await fetch(`/api/aliexpress/search?${params.toString()}`, { cache: 'no-store' });
      const rawText = await response.text();
      const data = parseJsonSafe<SearchResponse>(rawText);

      if (runTokenRef.current !== token) return;

      if (!data) {
        setMeta({
          error: `O servidor retornou uma resposta inesperada (HTTP ${response.status}). Atualize a página e tente novamente.`,
        });
        return;
      }

      if (!response.ok || !data.ok) {
        setMeta({ error: data.error || `Falha na busca (HTTP ${response.status}).` });
        return;
      }

      const candidates = data.candidates ?? [];
      setMeta({
        totalCandidates: shouldVerify ? candidates.length : (data.count ?? 0),
        inspectedCount: 0,
        usWarehouseCount: 0,
        verified: shouldVerify,
        current_page: data.current_page ?? targetPage,
        total_pages: data.total_pages ?? 1,
        next: data.next ?? null,
        previous: data.previous ?? null,
        error: undefined,
      });

      setLoading(false);

      if (shouldVerify && data.mode === 'progressive') {
        setPendingCandidates(candidates);
        if (candidates.length > 0) {
          const maxDaysNum = Number(maxDays) > 0 ? Number(maxDays) : null;
          await verifyCandidatesLoop(candidates, token, usOnly, maxDaysNum);
        }
      } else {
        setResults(data.results ?? []);
      }
    } catch (error) {
      if (runTokenRef.current !== token) return;
      setMeta({ error: error instanceof Error ? error.message : 'Erro inesperado na busca.' });
    } finally {
      if (runTokenRef.current === token) {
        setLoading(false);
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query, 1);
  }

  function handlePauseVerification() {
    stopRef.current = true;
    setVerifying(false);
  }

  function handleResumeVerification() {
    if (pendingCandidates.length === 0 || verifying) return;
    const token = ++runTokenRef.current;
    const maxDaysNum = Number(maxDays) > 0 ? Number(maxDays) : null;
    void verifyCandidatesLoop(pendingCandidates, token, usOnly, maxDaysNum);
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
      const data = parseJsonSafe<{ error?: string; product?: unknown }>(text) ?? {
        error: `Resposta inválida do servidor (HTTP ${response.status}).`,
      };

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

  const totalCandidates = meta.totalCandidates ?? 0;
  const inspectedCount = meta.inspectedCount ?? 0;
  const progressPct = totalCandidates > 0
    ? Math.min(100, Math.round((inspectedCount / totalCandidates) * 100))
    : 0;

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
          Consulta o catálogo oficial do AliExpress e verifica em lotes rápidos de 4 anúncios se há estoque real em armazém dos EUA
          (<code>Ships From: United States</code>) e o prazo real de entrega antes de importar.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_SEARCH_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={loading}
              onClick={() => {
                setQuery(preset);
                void runSearch(preset, 1);
              }}
              className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-300 transition hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-50"
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
            placeholder="Ex: women velvet midi dress — ou cole links/IDs do AliExpress"
            className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
          />

          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? 'Buscando catálogo...' : 'Buscar'}
          </button>

          {verifying && (
            <button
              type="button"
              onClick={handlePauseVerification}
              className="rounded-xl border border-amber-500/60 bg-amber-950/40 px-4 py-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-900/50"
            >
              Pausar
            </button>
          )}

          {!verifying && !loading && pendingCandidates.length > 0 && (
            <button
              type="button"
              onClick={handleResumeVerification}
              className="rounded-xl border border-emerald-500/60 bg-emerald-950/40 px-4 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-900/50"
            >
              Continuar ({pendingCandidates.length})
            </button>
          )}
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

        {meta.verified && totalCandidates > 0 && (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 text-xs text-zinc-300">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {verifying ? 'Verificando anúncios na API oficial...' : 'Verificação da página concluída'}
                {' '}· <strong>{inspectedCount}</strong> de <strong>{totalCandidates}</strong> checados ({progressPct}%)
              </span>
              <span>
                Armazém EUA: <strong className="text-emerald-400">{meta.usWarehouseCount ?? 0}</strong>
                {' '}· Aprovados nos filtros: <strong className="text-white">{results.length}</strong>
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {meta.error && (
          <div className="mt-4 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            {meta.error}
          </div>
        )}
      </form>

      {meta.verified && results.length === 0 && !loading && !verifying && !meta.error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-900/60 bg-amber-950/20 p-5 text-sm text-amber-200">
          <span>
            Verificamos {inspectedCount} anúncios da página {meta.current_page ?? page} na API oficial ({meta.usWarehouseCount ?? 0} com armazém nos EUA), mas nenhum atendeu a todos os filtros juntos.
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
              {results.length} aprovados
              {meta.verified ? ` (de ${inspectedCount}/${totalCandidates} verificados · ${meta.usWarehouseCount ?? 0} em armazém EUA)` : ''}
              {' '}· página {meta.current_page ?? page} de {meta.total_pages ?? 1}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading || verifying}
                onClick={() => void runSearch(query, Math.max(1, page - 1))}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm disabled:opacity-50"
              >
                Anterior
              </button>

              <button
                type="button"
                disabled={!meta.next || loading || verifying}
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

      {!loading && !verifying && results.length === 0 && !meta.error && !meta.verified && (
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
