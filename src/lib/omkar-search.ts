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

const OMKAR_SEARCH_BASE = 'https://aliexpress-scraper-api.omkar.cloud/aliexpress-scraper/v2/search';

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

  return response.json() as Promise<OmkarSearchResponse>;
}
