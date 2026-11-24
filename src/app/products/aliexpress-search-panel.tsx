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

type ImportState = 'importing' | 'imported' | 'duplicate' | 'no-us' | 'error';
type ImportStatus = { state: ImportState; message: string };

const IMPORT_STATUS_STYLE: Record<ImportState, string> = {
  importing: 'border-sky-800 bg-sky-950/50 text-sky-200',
  imported: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
  duplicate: 'border-zinc-700 bg-zinc-950 text-zinc-300',
  'no-us': 'border-amber-800 bg-amber-950/40 text-amber-200',
  error: 'border-red-900 bg-red-950/40 text-red-300',
};

function isUsReady(item: OmkarSearchResult) {
  return Boolean(item.shippingCheck?.checked && item.shippingCheck.hasUsInStock);
}

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [importStatus, setImportStatus] = useState<Record<string, ImportStatus>>({});
  const [bulk, setBulk] = useState<{ running: boolean; done: number; total: number }>({
    running: false,
    done: 0,
    total: 0,
  });
  const bulkStopRef = useRef(false);

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
        const newUsIds = newApproved.filter(isUsReady).map((item) => item.id);
        if (newUsIds.length > 0) {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const id of newUsIds) next.add(id);
            return next;
          });
        }
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
    setSelectedIds(new Set());
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

  async function requestImport(item: OmkarSearchResult): Promise<ImportStatus> {
    const usWarehouseOnly = isUsReady(item);
    const send = async () => {
      const response = await fetch('/api/import/aliexpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `https://www.aliexpress.us/item/${item.id}.html`,
          usWarehouseOnly,
        }),
      });
      const text = await response.text();
      return {
        response,
        data: parseJsonSafe<{ error?: string; duplicate?: boolean; noUsWarehouse?: boolean }>(text),
      };
    };

    try {
      let { response, data } = await send();
      // Proxy timeouts answer without JSON even when the server finished saving.
      // A second call then reports "already imported" instead of creating a copy.
      if (!data && response.status >= 500) {
        await new Promise((r) => setTimeout(r, 3000));
        ({ response, data } = await send());
      }
      if (response.ok) {
        return {
          state: 'imported',
          message: usWarehouseOnly ? 'Importado (só variantes do armazém EUA)' : 'Importado',
        };
      }
      if (data?.duplicate) return { state: 'duplicate', message: 'Já estava importado' };
      if (data?.noUsWarehouse) {
        return { state: 'no-us', message: data.error || 'Sem estoque no armazém dos EUA' };
      }
      return {
        state: 'error',
        message: data?.error || `Falha na importação (HTTP ${response.status}).`,
      };
    } catch (error) {
      return {
        state: 'error',
        message: error instanceof Error ? error.message : 'Erro inesperado ao importar.',
      };
    }
  }

  async function importProduct(item: OmkarSearchResult) {
    setImportingId(item.id);
    setImportMessage(null);
    setImportStatus((prev) => ({ ...prev, [item.id]: { state: 'importing', message: 'Importando...' } }));
    try {
      const status = await requestImport(item);
      setImportStatus((prev) => ({ ...prev, [item.id]: status }));
      setImportMessage(
        status.state === 'imported'
          ? `Produto importado com sucesso: ${item.title}`
          : status.message,
      );
    } finally {
      setImportingId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function importSelected() {
    const queue = results.filter(
      (item) =>
        selectedIds.has(item.id) &&
        isUsReady(item) &&
        importStatus[item.id]?.state !== 'imported' &&
        importStatus[item.id]?.state !== 'duplicate',
    );
    if (queue.length === 0 || bulk.running) return;

    bulkStopRef.current = false;
    setImportMessage(null);
    setBulk({ running: true, done: 0, total: queue.length });
    const tally: Record<ImportState, number> = {
      importing: 0,
      imported: 0,
      duplicate: 0,
      'no-us': 0,
      error: 0,
    };

    for (let index = 0; index < queue.length; index++) {
      if (bulkStopRef.current) break;
      const item = queue[index];
      setImportStatus((prev) => ({ ...prev, [item.id]: { state: 'importing', message: 'Importando...' } }));
      const status = await requestImport(item);
      tally[status.state] += 1;
      setImportStatus((prev) => ({ ...prev, [item.id]: status }));
      if (status.state === 'imported' || status.state === 'duplicate') {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
      setBulk({ running: true, done: index + 1, total: queue.length });
    }

    const processed = tally.imported + tally.duplicate + tally['no-us'] + tally.error;
    setBulk((prev) => ({ ...prev, running: false }));
    setImportMessage(
      `${bulkStopRef.current ? 'Lote interrompido' : 'Lote concluído'}: ${tally.imported} importado(s)` +
        (tally.duplicate ? `, ${tally.duplicate} já existiam` : '') +
        (tally['no-us'] ? `, ${tally['no-us']} sem estoque EUA` : '') +
        (tally.error ? `, ${tally.error} com erro` : '') +
        ` (${processed} de ${queue.length}).`,
    );
  }

  const usReadyResults = results.filter(isUsReady);
  const importableUs = usReadyResults.filter(
    (item) =>
      importStatus[item.id]?.state !== 'imported' &&
      importStatus[item.id]?.state !== 'duplicate',
  );
  const selectedCount = importableUs.filter((item) => selectedIds.has(item.id)).length;
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

          {usReadyResults.length > 0 && (
            <div className="rounded-2xl border border-emerald-900/70 bg-emerald-950/20 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-emerald-300">
                    Importação em lote · somente armazém EUA
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {selectedCount} de {importableUs.length} selecionados. Cada produto entra só com as variantes enviadas dos EUA com estoque; as da China ficam de fora.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={bulk.running || importableUs.length === 0}
                    onClick={() => setSelectedIds(new Set(importableUs.map((item) => item.id)))}
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                  >
                    Selecionar todos EUA
                  </button>
                  <button
                    type="button"
                    disabled={bulk.running || selectedCount === 0}
                    onClick={() => setSelectedIds(new Set())}
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                  >
                    Limpar
                  </button>
                  {bulk.running ? (
                    <button
                      type="button"
                      onClick={() => {
                        bulkStopRef.current = true;
                      }}
                      className="rounded-xl border border-amber-500/60 bg-amber-950/40 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-900/50"
                    >
                      Parar após o atual
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={selectedCount === 0 || importingId !== null}
                      onClick={() => void importSelected()}
                      className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                    >
                      Importar {selectedCount} selecionado{selectedCount === 1 ? '' : 's'}
                    </button>
                  )}
                </div>
              </div>
              {bulk.total > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-zinc-300">
                    {bulk.running ? 'Importando' : 'Último lote'}: {bulk.done} de {bulk.total}
                  </p>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${Math.round((bulk.done / bulk.total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {results.map((item) => {
              const check = item.shippingCheck;
              const status = importStatus[item.id];
              const usReady = isUsReady(item);
              const alreadyIn = status?.state === 'imported' || status?.state === 'duplicate';
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
                    {usReady && !alreadyIn && (
                      <label className="absolute right-3 top-3 flex cursor-pointer items-center gap-1.5 rounded-full bg-zinc-950/85 px-2.5 py-1 text-[11px] font-semibold text-white">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          disabled={bulk.running}
                          onChange={() => toggleSelected(item.id)}
                        />
                        Lote
                      </label>
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

                    {status && (
                      <p className={`rounded-lg border px-2.5 py-1.5 text-xs ${IMPORT_STATUS_STYLE[status.state]}`}>
                        {status.message}
                      </p>
                    )}

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
                        disabled={importingId !== null || bulk.running || alreadyIn || status?.state === 'importing'}
                        onClick={() => importProduct(item)}
                        className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
                      >
                        {status?.state === 'importing' ? 'Importando...' : alreadyIn ? 'Importado' : 'Importar'}
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
