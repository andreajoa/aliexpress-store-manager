export type OmkarSearchResult = {
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
  tags: string[];
  store_name: string | null;
  category_ids: (string | number)[];
  listed_date: string;
};

export type OmkarSearchResponse = {
  count: number;
  per_page: number;
  current_page: number;
  total_pages: number;
  next: string | null;
  previous: string | null;
  currency: string;
  results: OmkarSearchResult[];
};

type OmkarRawItemV1 = {
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
  tags: string[];
  store_name: string | null;
  category_ids: (string | number)[];
  listed_date: string;
};

type OmkarRawItemV2 = {
  id: string;
  title: string;
  image_url: string;
  price: string | number | null;
  original_price: string | number | null;
  discount: string | number | null;
  currency?: string | null;
  rating: string | number | null;
  positive_feedback_rate?: string | number | null;
  orders_count: string | number | null;
  category_ids?: string | (string | number)[];
};

type OmkarRawResponseV2 = {
  count: number;
  per_page: number;
  current_page: number;
  total_pages: number;
  next: string | null;
  previous: string | null;
  currency?: string;
  results: OmkarRawItemV2[];
};

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeCategoryIds(value: unknown): (string | number)[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'number' ? item : String(item)));
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const numeric = Number(part);
        return Number.isFinite(numeric) ? numeric : part;
      });
  }
  return [];
}

function parseV2Item(item: OmkarRawItemV2): OmkarSearchResult {
  const salePrice = toNumber(item.price);
  const originalPrice = toNumber(item.original_price);
  const discount = toNumber(item.discount);
  const rating = toNumber(item.rating);
  const positiveFeedback = toNumber(item.positive_feedback_rate);

  return {
    id: String(item.id),
    title: item.title,
    link: `https://www.aliexpress.us/item/${item.id}.html`,
    image: item.image_url || '',
    images: item.image_url ? [item.image_url] : [],
    rating: rating ?? (positiveFeedback != null ? positiveFeedback / 100 : null),
    orders_count: toNumber(item.orders_count),
    is_hot_sale: null,
    is_choice: null,
    pricing: {
      sale_price: salePrice,
      original_price: originalPrice ?? salePrice,
      discount_percent: discount,
      currency: (item.currency || 'USD').toUpperCase(),
      tax_rate: null,
      sku_id: null,
    },
    tags: [],
    store_name: null,
    category_ids: normalizeCategoryIds(item.category_ids),
    listed_date: '',
  };
}

function normalizeSearchResponse(
  data: unknown,
): OmkarSearchResponse | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidate = data as Record<string, unknown>;

  if (Array.isArray(candidate.results)) {
    const v2 = candidate as OmkarRawResponseV2;
    if (
      typeof v2.count === 'number' &&
      typeof v2.per_page === 'number' &&
      typeof v2.current_page === 'number' &&
      typeof v2.total_pages === 'number'
    ) {
      return {
        count: v2.count,
        per_page: v2.per_page,
        current_page: v2.current_page,
        total_pages: v2.total_pages,
        next: typeof v2.next === 'string' ? v2.next : null,
        previous: typeof v2.previous === 'string' ? v2.previous : null,
        currency: typeof v2.currency === 'string' && v2.currency.trim() ? v2.currency.trim() : 'USD',
        results: v2.results.map(parseV2Item),
      };
    }
  }

  return null;
}

const OMKAR_SEARCH_BASE = 'https://aliexpress-scraper-api.omkar.cloud/aliexpress/scraper/v2/search';

export async function searchOmkarProducts(query: string, page = 1): Promise<OmkarSearchResponse> {
  const apiKey = process.env.OMKAR_API_KEY;
  if (!apiKey) {
    throw new Error('OMKAR_API_KEY não configurada.');
  }

  const endpoint = new URL(OMKAR_SEARCH_BASE);
  endpoint.searchParams.set('query', query);
  endpoint.searchParams.set('page', String(page));
  endpoint.searchParams.set('per_page', '60');

  const response = await fetch(endpoint, {
    headers: {
      'API-Key': apiKey,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Omkar search falhou: HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as unknown;
  const normalized = normalizeSearchResponse(data);

  if (!normalized) {
    throw new Error('A resposta de busca do Omkar não está no formato esperado.');
  }

  return normalized;
}
