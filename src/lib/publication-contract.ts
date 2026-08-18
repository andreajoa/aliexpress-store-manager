export type StoreProductVariantPayload = {
  sourceSkuId: string;
  name: string;
  price: number;
  stock: number;
  attributes: Record<string, string>;
  imageUrl: string | null;
};

export type StoreProductCurrency =
  | "BRL"
  | "USD"
  | "EUR";

export type StoreProductPayload = {
  protocolVersion: "2026-08-01";

  product: {
    id: string;
    sourceProductId: string;

    title: string;
    slug: string;

    headline: string;
    description: string;
    benefits: string[];
    cta: string;

    price: number;
    compareAtPrice: number | null;
    currency: StoreProductCurrency;

    image: string;
    gallery: string[];

    editorialAssets?: Array<{
      id: string;
      type: string;
    }>;

    category: string;
    ageRange: string;

    stock: number;

    variants: StoreProductVariantPayload[];

    shipping: {
      weightGrams: number;
      lengthCm: number;
      widthCm: number;
      heightCm: number;
    };

    seo: {
      title: string;
      description: string;
    };

    source: {
      provider: "ALIEXPRESS";
      productId: string;
      url: string;
    };
  };
};

export function slugifyProduct(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}
