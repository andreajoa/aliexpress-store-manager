import { generatedProducts } from "./generated-products";
import { shoeProducts } from "./shoe-products";
import { supplementalProducts } from "./generated-supplemental-products";
import { octoberColorProducts } from "./october-color-products";
import { octoberSourceLineage } from "./october-source-lineage";

export type ShoeVariant = {
  heelHeightCm: number;
  sizes: string[];
  stock: number;
};

export type Product = {
  slug: string;
  name: string;
  vendor?: string;
  category: "Dresses" | "Tops" | "Sets" | "Playsuits" | "Skirts" | "Pants" | "Shorts" | "Knitwear" | "Bags" | "Shoes" | "Accessories";
  subcategory?: string;
  price: number;
  sizePrices?: Record<string, number>;
  compareAt?: number;
  badge?: string;
  sheet: "one" | "two";
  quadrant: 1 | 2 | 3 | 4;
  colors: string[];
  rating?: number;
  description?: string;
  materials?: string;
  care?: string;
  sizes?: string[];
  colorNames?: string[];
  images?: string[];
  stock?: number;
  weightOz?: number;
  unitCostUsd?: number;
  inboundFreightUsd?: number;
  dutyUsd?: number;
  packagingUsd?: number;
  minimumMarginPercent?: number;
  sourceProductId?: string;
  sourceColor?: string;
  complementarySlugs?: string[];
  garmentMeasurements?: Record<string, { bust?: number; waist?: number; hip?: number }>;
  stripePriceId?: string;
  styleEligible?: boolean;
  heelHeightCm?: number;
  shoeVariants?: ShoeVariant[];
  heelAtlasIndex?: number;
  gallerySprite?: { columns: number; rows: number; viewWidth: number; viewHeight: number };
  galleryAtlasIndex?: number;
  galleryAtlasCount?: number;
};

const placeholderProducts: Product[] = [
  { slug: "sienna-linen-midi-dress", name: "Sienna Linen Midi Dress", category: "Dresses", price: 89, compareAt: 118, badge: "Save 25%", sheet: "one", quadrant: 1, colors: ["#eee6d8", "#1b1b1b"], rating: 5 },
  { slug: "isla-pleated-mini-dress", name: "Isla Pleated Mini Dress", category: "Dresses", price: 98, sheet: "one", quadrant: 2, colors: ["#e8c7c0", "#f4eee2"] },
  { slug: "margot-knit-midi-dress", name: "Margot Knit Midi Dress", category: "Dresses", price: 112, badge: "New", sheet: "one", quadrant: 3, colors: ["#191919", "#b58d78"], rating: 5 },
  { slug: "del-mar-draped-dress", name: "Del Mar Draped Dress", category: "Dresses", price: 94, sheet: "one", quadrant: 4, colors: ["#d2b6a9", "#f6f0e7"] },
  { slug: "la-jolla-linen-blouse", name: "La Jolla Linen Blouse", category: "Tops", price: 68, compareAt: 86, badge: "Save 20%", sheet: "one", quadrant: 2, colors: ["#eec3bd", "#efe7d9"] },
  { slug: "sunset-ribbed-tank", name: "Sunset Ribbed Tank", category: "Tops", price: 54, sheet: "one", quadrant: 4, colors: ["#bf8e78", "#eee4d7"] },
  { slug: "cabrillo-tailored-playsuit", name: "Cabrillo Tailored Playsuit", category: "Playsuits", price: 104, sheet: "two", quadrant: 2, colors: ["#aa8c76", "#f1ebe2"], rating: 5 },
  { slug: "solana-wrap-playsuit", name: "Solana Wrap Playsuit", category: "Playsuits", price: 96, badge: "Just In", sheet: "two", quadrant: 4, colors: ["#d5aaa4", "#f5efe6"] },
  { slug: "catalina-shoulder-bag", name: "Catalina Shoulder Bag", category: "Bags", price: 128, sheet: "two", quadrant: 1, colors: ["#9d6541", "#151515"], styleEligible: false },
  { slug: "pacific-structured-tote", name: "Pacific Structured Tote", category: "Bags", price: 146, badge: "Best Seller", sheet: "two", quadrant: 1, colors: ["#8c5b3d", "#e7d9c5"], rating: 5, styleEligible: false },
  { slug: "paloma-slingback-heel", name: "Paloma Slingback Heel", category: "Shoes", subcategory: "Heels", price: 118, sheet: "two", quadrant: 3, colors: ["#d5b39d", "#171717"], styleEligible: false },
  { slug: "maren-strappy-sandal", name: "Maren Strappy Sandal", category: "Shoes", subcategory: "Heels", price: 92, compareAt: 115, badge: "Save 20%", sheet: "two", quadrant: 3, colors: ["#b99070", "#e9ddce"], styleEligible: false },
  { slug: "carmel-knit-midi-skirt", name: "Carmel Knit Midi Skirt", category: "Skirts", price: 84, badge: "New", sheet: "two", quadrant: 3, colors: ["#d8c8b7", "#1b1b1b"] },
  { slug: "coronado-wide-leg-trouser", name: "Coronado Wide-Leg Trouser", category: "Pants", price: 92, badge: "New", sheet: "two", quadrant: 4, colors: ["#eee5d8", "#9e7967"] },
  { slug: "ocean-beach-tailored-short", name: "Ocean Beach Tailored Short", category: "Shorts", price: 72, sheet: "two", quadrant: 4, colors: ["#e9dfd1", "#b78970"] },
  { slug: "torrey-soft-knit", name: "Torrey Soft Knit", category: "Knitwear", price: 88, sheet: "one", quadrant: 3, colors: ["#e6ded0", "#9f806b"], styleEligible: false },
  { slug: "sunset-sculpted-earrings", name: "Sunset Sculpted Earrings", category: "Accessories", price: 48, badge: "Just In", sheet: "two", quadrant: 1, colors: ["#c69b54"], styleEligible: false },
];

const catalogueProducts = (generatedProducts.length ? generatedProducts : placeholderProducts).map(
  (product) => octoberSourceLineage[product.slug]
    ? { ...product, ...octoberSourceLineage[product.slug] }
    : product,
);
// Preserve the established page when supplemental imports repeat its slug.
const establishedSlugs = new Set(catalogueProducts.map((product) => product.slug));
export const products: Product[] = [
  ...catalogueProducts,
  ...shoeProducts,
  ...supplementalProducts.filter((product) => !establishedSlugs.has(product.slug)),
  ...octoberColorProducts,
];

type CategoryPage = {
  slug: string;
  name: Product["category"];
  title: string;
  description: string;
  subcategory?: string;
};

export const categoryPages: CategoryPage[] = [
  { slug: "dresses", name: "Dresses", title: "Women’s Dresses", description: "Shop women’s mini, midi, maxi and occasion dresses selected for weddings, dinners, vacations and effortless everyday dressing." },
  { slug: "tops-blouses", name: "Tops", title: "Women’s Tops & Blouses", description: "Shop women’s tops and blouses, from polished shirts and refined tanks to easy layers designed for workdays, weekends and evenings out." },
  { slug: "sets", name: "Sets", title: "Women’s Matching Sets", description: "Shop coordinated women’s two-piece sets designed for effortless styling, versatile separates and polished warm-weather dressing." },
  { slug: "rompers-playsuits", name: "Playsuits", title: "Women’s Rompers & Playsuits", description: "Shop women’s rompers and playsuits with one-and-done silhouettes for warm days, vacations, weekends and polished casual plans." },
  { slug: "skirts", name: "Skirts", title: "Women’s Skirts", description: "Shop women’s mini and midi skirts with flattering proportions, movement and modern styling for casual days, work and evening plans." },
  { slug: "pants", name: "Pants", title: "Women’s Pants & Trousers", description: "Shop women’s tailored trousers and relaxed wide-leg pants for polished workwear, travel outfits and elevated everyday style." },
  { slug: "shorts", name: "Shorts", title: "Women’s Shorts", description: "Shop women’s tailored and relaxed shorts for warm-weather outfits, vacations and elevated everyday dressing." },
  { slug: "knitwear", name: "Knitwear", title: "Women’s Knitwear", description: "Shop women’s knitwear and light layers selected for softness, texture, comfort and repeat wear across seasons." },
  { slug: "bags", name: "Bags", title: "Women’s Bags", description: "Shop women’s shoulder bags, totes and polished everyday bags selected to finish work, weekend and evening outfits." },
  { slug: "shoes", name: "Shoes", title: "Women’s Shoes", description: "Shop women’s shoes including elegant heels, slingbacks and occasion styles selected to complete polished day-to-evening looks." },
  { slug: "heels", name: "Shoes", subcategory: "Heels", title: "Women’s Heels", description: "Shop women’s heels including pumps, slingbacks, block heels and stilettos curated for weddings, dinners, work and evening occasions." },
  { slug: "accessories", name: "Accessories", title: "Women’s Accessories", description: "Shop women’s accessories and finishing touches curated to make everyday, occasion and travel outfits feel complete." },
];

export const formatPrice = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(value);
