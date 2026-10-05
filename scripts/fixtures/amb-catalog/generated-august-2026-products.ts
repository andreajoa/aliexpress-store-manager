import type { Product } from "./data";

type ColorVariant = {
  slug: string;
  name: string;
  colorName: string;
  colorHex: string;
  stock: number;
  assetColor?: string;
};

type DressFamily = {
  sourceId: string;
  price: number;
  sizes: string[];
  weightKg: number;
  silhouette: string;
  materials: string;
  variants: ColorVariant[];
};

const care = "Follow the care label attached to the garment. To preserve color, shape and drape, use professional cleaning or a cold gentle cycle when permitted and air dry.";

const dressFamilies: DressFamily[] = [
  {
    sourceId: "3256809150429466",
    price: 72,
    sizes: ["S", "M", "L", "XL"],
    weightKg: 0.35,
    silhouette: "a sleek off-shoulder midi dress with a sculpted halter neckline, a close waist and a fluid party-ready skirt",
    materials: "Smooth woven fabric with a polished finish and fluid drape.",
    variants: [
      { slug: "alessa-milky-halter-midi-dress", name: "Alessa Milky Halter Midi Dress", colorName: "Milky", colorHex: "#f2eadf", stock: 3996 },
      { slug: "briony-sage-halter-midi-dress", name: "Briony Sage Halter Midi Dress", colorName: "Light Green", colorHex: "#a8b99a", stock: 3996 },
      { slug: "coralie-rose-halter-midi-dress", name: "Coralie Rose Halter Midi Dress", colorName: "Rose Red", colorHex: "#c8445b", stock: 3995 },
      { slug: "danika-black-halter-midi-dress", name: "Danika Black Halter Midi Dress", colorName: "Black", colorHex: "#171717", stock: 3996 },
      { slug: "evora-navy-halter-midi-dress", name: "Evora Navy Halter Midi Dress", colorName: "Navy Blue", colorHex: "#1c2945", stock: 3996 },
    ],
  },
  {
    sourceId: "3256809718928902",
    price: 57,
    sizes: ["S", "M", "L", "XL", "XXL", "XXXL"],
    weightKg: 0.42,
    silhouette: "a satin midi dress with a high draped halter neckline, exposed shoulders, a softly blouson bodice, defined waist and bias-cut skirt",
    materials: "Silk-touch satin with luminous sheen and a supple, liquid drape.",
    variants: [
      { slug: "amara-apricot-satin-midi-dress", name: "Amara Apricot Satin Midi Dress", colorName: "Apricot", colorHex: "#d7ad88", stock: 53981 },
      { slug: "bellamy-black-satin-midi-dress", name: "Bellamy Black Satin Midi Dress", colorName: "Black", colorHex: "#171717", stock: 53998 },
      { slug: "carys-army-green-satin-midi-dress", name: "Carys Army Green Satin Midi Dress", colorName: "Army Green", colorHex: "#59634a", stock: 53989 },
      { slug: "davina-navy-satin-midi-dress", name: "Davina Navy Satin Midi Dress", colorName: "Navy Blue", colorHex: "#1c2945", stock: 53999 },
      { slug: "elowen-pink-satin-midi-dress", name: "Elowen Pink Satin Midi Dress", colorName: "Pink", colorHex: "#d78fa2", stock: 53989 },
      { slug: "fiora-sage-satin-midi-dress", name: "Fiora Sage Satin Midi Dress", colorName: "Light Green", colorHex: "#b7c6a4", stock: 53998 },
      { slug: "giselle-rose-satin-midi-dress", name: "Giselle Rose Satin Midi Dress", colorName: "Rose Red", colorHex: "#cf5367", stock: 53998 },
      { slug: "helena-wine-satin-midi-dress", name: "Helena Wine Satin Midi Dress", colorName: "Wine Red", colorHex: "#6f172b", stock: 53998 },
    ],
  },
  {
    sourceId: "3256811903141552",
    price: 82.23,
    sizes: ["S", "M", "L", "XL", "XXL", "XXXL"],
    weightKg: 0.4,
    silhouette: "a short-sleeve maxi dress with a softly pleated bodice, cinched waist and a sweeping A-line skirt",
    materials: "Lightweight pleated woven fabric with an airy hand and graceful movement.",
    variants: [
      { slug: "inez-blue-pleated-maxi-dress", name: "Inez Blue Pleated Maxi Dress", colorName: "Blue", colorHex: "#4b72a6", stock: 299 },
      { slug: "jovina-black-pleated-maxi-dress", name: "Jovina Black Pleated Maxi Dress", colorName: "Black", colorHex: "#171717", stock: 299 },
      { slug: "kalina-white-pleated-maxi-dress", name: "Kalina White Pleated Maxi Dress", colorName: "White", colorHex: "#f4f1ea", stock: 292 },
    ],
  },
  {
    sourceId: "3256812188604862",
    price: 62,
    sizes: ["S", "M", "L", "XL"],
    weightKg: 0.308,
    silhouette: "a sleeveless V-neck floral maxi dress with a shaped waist and an easy full skirt for summer occasions",
    materials: "Lightweight floral woven fabric with a soft hand and flowing finish.",
    variants: [
      { slug: "loretta-navy-floral-maxi-dress", name: "Loretta Navy Floral Maxi Dress", colorName: "Navy Blue Floral", colorHex: "#1f3150", stock: 241, assetColor: "navy-blue" },
    ],
  },
  {
    sourceId: "3256808609985190",
    price: 55.87,
    sizes: ["XS", "S", "M", "L"],
    weightKg: 0.313,
    silhouette: "a polished satin midi dress with a V neckline, short sleeves, a fitted waist and an elegant day-to-evening line",
    materials: "Soft satin with subtle sheen and a smooth, fluid finish.",
    variants: [
      { slug: "maelle-champagne-satin-midi-dress", name: "Maelle Champagne Satin Midi Dress", colorName: "Champagne", colorHex: "#d8c3a4", stock: 16 },
      { slug: "nerina-blue-satin-midi-dress", name: "Nerina Blue Satin Midi Dress", colorName: "Blue", colorHex: "#47709a", stock: 12 },
      { slug: "oriana-green-satin-midi-dress", name: "Oriana Green Satin Midi Dress", colorName: "Green", colorHex: "#496d58", stock: 6 },
      { slug: "pascale-black-satin-midi-dress", name: "Pascale Black Satin Midi Dress", colorName: "Black", colorHex: "#171717", stock: 11 },
    ],
  },
  {
    sourceId: "3256807411255906",
    price: 146.79,
    sizes: ["One Size"],
    weightKg: 0.5,
    silhouette: "a French-inspired micro-pleated midi dress with a V neckline, short sleeves and softly shaped waist",
    materials: "Fine permanent pleats with lightweight structure, stretch and fluid movement.",
    variants: [
      { slug: "romilly-beige-pleated-midi-dress", name: "Romilly Beige Pleated Midi Dress", colorName: "Beige", colorHex: "#c8b69f", stock: 18 },
      { slug: "selene-pink-pleated-midi-dress", name: "Selene Pink Pleated Midi Dress", colorName: "Pink", colorHex: "#d39aaa", stock: 47 },
      { slug: "thalia-blue-pleated-midi-dress", name: "Thalia Blue Pleated Midi Dress", colorName: "Blue", colorHex: "#5b779c", stock: 38 },
      { slug: "vienna-gray-pleated-midi-dress", name: "Vienna Gray Pleated Midi Dress", colorName: "Gray", colorHex: "#858585", stock: 41 },
      { slug: "winslet-black-pleated-midi-dress", name: "Winslet Black Pleated Midi Dress", colorName: "Black", colorHex: "#171717", stock: 35 },
      { slug: "yara-mint-pleated-midi-dress", name: "Yara Mint Pleated Midi Dress", colorName: "Mint", colorHex: "#a7cabb", stock: 45 },
    ],
  },
  {
    sourceId: "3256811609011827",
    price: 388.87,
    sizes: ["2", "4", "6", "8", "10", "12", "14", "16", "16W", "18W", "20W", "22W", "24W", "26W"],
    weightKg: 0.8,
    silhouette: "a floor-length sheath gown with an elegant round neckline, short sleeves and intricate lace for weddings and formal occasions",
    materials: "Layered lace over a smooth formal lining with delicate texture and refined structure.",
    variants: [
      { slug: "adelia-light-blue-lace-gown", name: "Adelia Light Blue Lace Gown", colorName: "Light Blue", colorHex: "#acc8d9", stock: 2995 },
      { slug: "beatrice-black-lace-gown", name: "Beatrice Black Lace Gown", colorName: "Black", colorHex: "#171717", stock: 2999 },
      { slug: "celestine-navy-lace-gown", name: "Celestine Navy Lace Gown", colorName: "Navy", colorHex: "#1b2d4d", stock: 2999 },
      { slug: "dorothea-sage-lace-gown", name: "Dorothea Sage Lace Gown", colorName: "Sage Green", colorHex: "#829a78", stock: 2995 },
      { slug: "eleanora-blush-lace-gown", name: "Eleanora Blush Lace Gown", colorName: "Blush Pink", colorHex: "#d8a4ad", stock: 2997 },
      { slug: "francesca-champagne-lace-gown", name: "Francesca Champagne Lace Gown", colorName: "Champagne", colorHex: "#d6be9a", stock: 2999 },
      { slug: "georgina-purple-lace-gown", name: "Georgina Purple Lace Gown", colorName: "Purple", colorHex: "#735080", stock: 3000 },
      { slug: "henrietta-pink-lace-gown", name: "Henrietta Pink Lace Gown", colorName: "Pink", colorHex: "#d98ba4", stock: 2997 },
      { slug: "juliette-red-lace-gown", name: "Juliette Red Lace Gown", colorName: "Red", colorHex: "#9f2333", stock: 3000 },
      { slug: "katarina-silver-lace-gown", name: "Katarina Silver Lace Gown", colorName: "Silver", colorHex: "#aaaeb5", stock: 3000 },
      { slug: "leonora-white-lace-gown", name: "Leonora White Lace Gown", colorName: "White", colorHex: "#f2eee7", stock: 2999 },
      { slug: "magnolia-yellow-lace-gown", name: "Magnolia Yellow Lace Gown", colorName: "Yellow", colorHex: "#d5bd57", stock: 3000 },
    ],
  },
  {
    sourceId: "3256811840642569",
    price: 95.67,
    sizes: ["S", "M", "L", "XL"],
    weightKg: 0.5,
    silhouette: "a sleeveless V-neck midi dress with soft pleating, a relaxed bodice, shaped waist and concealed back zip",
    materials: "Fluid pleated woven fabric with light structure and comfortable movement.",
    variants: [
      { slug: "mirella-pink-pleated-midi-dress", name: "Mirella Pink Pleated Midi Dress", colorName: "Pink", colorHex: "#d592a8", stock: 3996 },
      { slug: "novalie-purple-pleated-midi-dress", name: "Novalie Purple Pleated Midi Dress", colorName: "Purple", colorHex: "#724b82", stock: 3995 },
      { slug: "ottilie-rose-pleated-midi-dress", name: "Ottilie Rose Pleated Midi Dress", colorName: "Rose Red", colorHex: "#b9345b", stock: 3996 },
      { slug: "primrose-champagne-pleated-midi-dress", name: "Primrose Champagne Pleated Midi Dress", colorName: "Champagne", colorHex: "#d8c5a4", stock: 3996 },
      { slug: "renata-black-pleated-midi-dress", name: "Renata Black Pleated Midi Dress", colorName: "Black", colorHex: "#171717", stock: 3996 },
      { slug: "saskia-blue-pleated-midi-dress", name: "Saskia Blue Pleated Midi Dress", colorName: "Blue", colorHex: "#4a719c", stock: 3996 },
      { slug: "tatiana-brick-red-pleated-midi-dress", name: "Tatiana Brick Red Pleated Midi Dress", colorName: "Brick Red", colorHex: "#9a493c", stock: 3996 },
      { slug: "valencia-brown-pleated-midi-dress", name: "Valencia Brown Pleated Midi Dress", colorName: "Brown", colorHex: "#725448", stock: 3996 },
      { slug: "winona-gray-pleated-midi-dress", name: "Winona Gray Pleated Midi Dress", colorName: "Gray", colorHex: "#8a8b8d", stock: 3996 },
      { slug: "zosia-green-pleated-midi-dress", name: "Zosia Green Pleated Midi Dress", colorName: "Green", colorHex: "#52715c", stock: 3996 },
    ],
  },
  {
    sourceId: "3256807022033611",
    price: 62,
    sizes: ["S", "M", "L", "XL"],
    weightKg: 0.311,
    silhouette: "a V-neck maxi dress with pleated ruffle sleeves, a tie waist and a flowing cocktail-ready skirt",
    materials: "Lightweight woven fabric with soft pleats and graceful swing.",
    variants: [
      { slug: "amoret-green-ruffle-maxi-dress", name: "Amoret Green Ruffle Maxi Dress", colorName: "Green", colorHex: "#4f725a", stock: 393 },
      { slug: "blythe-black-ruffle-maxi-dress", name: "Blythe Black Ruffle Maxi Dress", colorName: "Black", colorHex: "#171717", stock: 400 },
      { slug: "cosette-red-ruffle-maxi-dress", name: "Cosette Red Ruffle Maxi Dress", colorName: "Red", colorHex: "#a62b39", stock: 394 },
    ],
  },
  {
    sourceId: "3256811355796552",
    price: 191.48,
    sizes: ["S", "M", "L"],
    weightKg: 0.649,
    silhouette: "a sleeveless black midi dress with an open back, sculptural draping and polished gold-tone accents for dinner and cocktail occasions",
    materials: "Smooth structured knit with fluid draped panels and gold-tone hardware.",
    variants: [
      { slug: "desirae-black-draped-midi-dress", name: "Desirae Black Draped Midi Dress", colorName: "Black", colorHex: "#171717", stock: 599 },
    ],
  },
  {
    sourceId: "3256808016808441",
    price: 111,
    sizes: ["XS", "S", "M", "L", "XL"],
    weightKg: 0.5,
    silhouette: "a sleeveless printed V-neck maxi dress with a fitted waist and a full skirt designed for statement summer dressing",
    materials: "Smooth printed woven fabric with light structure and flowing movement.",
    variants: [
      { slug: "elara-claret-print-maxi-dress", name: "Elara Claret Print Maxi Dress", colorName: "Claret", colorHex: "#74243f", stock: 2494 },
      { slug: "freya-deep-blue-print-maxi-dress", name: "Freya Deep Blue Print Maxi Dress", colorName: "Deep Blue", colorHex: "#24365f", stock: 2499 },
    ],
  },
  {
    sourceId: "3256812366794477",
    price: 213.98,
    sizes: ["2", "4", "6", "8", "10", "12", "14", "16", "16W", "18W", "20W", "22W", "24W", "26W"],
    weightKg: 0.75,
    silhouette: "a floor-length evening gown with slim straps, a V neckline, ruched front and flowing pleated skirt for formal celebrations",
    materials: "Formal chiffon with soft pleating over a smooth full-length lining.",
    variants: [
      { slug: "galatea-black-pleated-evening-gown", name: "Galatea Black Pleated Evening Gown", colorName: "Black", colorHex: "#171717", stock: 1400 },
      { slug: "heloise-burgundy-pleated-evening-gown", name: "Heloise Burgundy Pleated Evening Gown", colorName: "Burgundy", colorHex: "#701c32", stock: 1400 },
      { slug: "isabeau-gray-pleated-evening-gown", name: "Isabeau Gray Pleated Evening Gown", colorName: "Gray", colorHex: "#86898d", stock: 1400, assetColor: "grey" },
      { slug: "jessamine-olive-pleated-evening-gown", name: "Jessamine Olive Pleated Evening Gown", colorName: "Olive Green", colorHex: "#5e6543", stock: 1400 },
      { slug: "kerensa-pink-pleated-evening-gown", name: "Kerensa Pink Pleated Evening Gown", colorName: "Pink", colorHex: "#cf91a6", stock: 1400 },
      { slug: "lysandra-purple-pleated-evening-gown", name: "Lysandra Purple Pleated Evening Gown", colorName: "Purple", colorHex: "#714a80", stock: 1400 },
      { slug: "marceline-royal-blue-pleated-evening-gown", name: "Marceline Royal Blue Pleated Evening Gown", colorName: "Royal Blue", colorHex: "#3157a4", stock: 1400 },
      { slug: "nerissa-white-pleated-evening-gown", name: "Nerissa White Pleated Evening Gown", colorName: "White", colorHex: "#f2eee7", stock: 1400 },
      { slug: "ophelia-yellow-pleated-evening-gown", name: "Ophelia Yellow Pleated Evening Gown", colorName: "Yellow", colorHex: "#d2b64a", stock: 1400 },
    ],
  },
];

export const august2026Products: Product[] = dressFamilies.flatMap((family, familyIndex) =>
  family.variants.map((variant, variantIndex) => ({
    slug: variant.slug,
    name: variant.name,
    vendor: "AMB BOUTIQUE",
    category: "Dresses",
    price: family.price,
    badge: "Just In",
    sheet: (familyIndex + variantIndex) % 2 === 0 ? "one" : "two",
    quadrant: (((familyIndex + variantIndex) % 4) + 1) as Product["quadrant"],
    colors: [variant.colorHex],
    colorNames: [variant.colorName],
    sizes: family.sizes,
    description: `${variant.name} is ${family.silhouette}. The ${variant.colorName.toLowerCase()} colorway is curated in San Diego for a polished, feminine wardrobe.`,
    materials: family.materials,
    care,
    images: ["01", "02", "03", "04"].map((view) => `/products/${variant.slug}/${view}.webp`),
    stock: variant.stock,
    weightOz: Number((family.weightKg * 35.274).toFixed(2)),
    minimumMarginPercent: 40,
  })),
);

export const august2026ProductSlugs = august2026Products.map((product) => product.slug);

const assetSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const august2026ProductAssets = dressFamilies.flatMap((family) =>
  family.variants.map((variant) => ({
    sourceId: family.sourceId,
    color: variant.assetColor || assetSlug(variant.colorName),
    slug: variant.slug,
  })),
);
