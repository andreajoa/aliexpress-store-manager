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

const care =
  "Follow the care label attached to the garment. To preserve embellishment, color, shape and drape, use professional cleaning or a cold gentle cycle when permitted and air dry.";

const dressFamilies: DressFamily[] = [
  {
    sourceId: "3256812293644387",
    price: 455.76,
    sizes: ["2", "4", "6", "8", "10", "12", "14", "16", "18W", "20W", "22W"],
    weightKg: 1,
    silhouette:
      "a strapless floor-length crystal mermaid gown with sculpted pointed cups, a dramatic illusion plunge and a fitted silhouette that opens into a sweeping train",
    materials:
      "Fully embellished sequin and crystal mesh over a structured formal lining with concealed support.",
    variants: [
      {
        slug: "opaline-ice-blue-crystal-mermaid-gown",
        name: "Opaline Ice Blue Crystal Mermaid Gown",
        colorName: "Ice Blue",
        colorHex: "#9fc9e4",
        stock: 1196,
        assetColor: "as-picture-color",
      },
      {
        slug: "aurelia-yellow-crystal-mermaid-gown",
        name: "Aurelia Yellow Crystal Mermaid Gown",
        colorName: "Yellow",
        colorHex: "#e3c84f",
        stock: 1200,
      },
      {
        slug: "bianca-white-crystal-mermaid-gown",
        name: "Bianca White Crystal Mermaid Gown",
        colorName: "White",
        colorHex: "#f3efe7",
        stock: 1200,
      },
      {
        slug: "celeste-silver-crystal-mermaid-gown",
        name: "Celeste Silver Crystal Mermaid Gown",
        colorName: "Silver",
        colorHex: "#a8abb2",
        stock: 1200,
      },
      {
        slug: "delphine-red-crystal-mermaid-gown",
        name: "Delphine Red Crystal Mermaid Gown",
        colorName: "Red",
        colorHex: "#a61f2e",
        stock: 1200,
      },
      {
        slug: "estelle-purple-crystal-mermaid-gown",
        name: "Estelle Purple Crystal Mermaid Gown",
        colorName: "Purple",
        colorHex: "#70458a",
        stock: 1200,
      },
      {
        slug: "fiora-pink-crystal-mermaid-gown",
        name: "Fiora Pink Crystal Mermaid Gown",
        colorName: "Pink",
        colorHex: "#e25c91",
        stock: 1200,
      },
      {
        slug: "giselle-orange-crystal-mermaid-gown",
        name: "Giselle Orange Crystal Mermaid Gown",
        colorName: "Orange",
        colorHex: "#e46f19",
        stock: 1200,
      },
      {
        slug: "helena-khaki-crystal-mermaid-gown",
        name: "Helena Khaki Crystal Mermaid Gown",
        colorName: "Khaki",
        colorHex: "#b8a484",
        stock: 1200,
      },
      {
        slug: "isadora-ivory-crystal-mermaid-gown",
        name: "Isadora Ivory Crystal Mermaid Gown",
        colorName: "Ivory",
        colorHex: "#eee4d3",
        stock: 1200,
      },
      {
        slug: "juliana-green-crystal-mermaid-gown",
        name: "Juliana Green Crystal Mermaid Gown",
        colorName: "Green",
        colorHex: "#087754",
        stock: 1200,
      },
      {
        slug: "katarina-gray-crystal-mermaid-gown",
        name: "Katarina Gray Crystal Mermaid Gown",
        colorName: "Gray",
        colorHex: "#66686c",
        stock: 1200,
      },
      {
        slug: "lucienne-brown-crystal-mermaid-gown",
        name: "Lucienne Brown Crystal Mermaid Gown",
        colorName: "Brown",
        colorHex: "#5a3525",
        stock: 1200,
      },
      {
        slug: "marielle-blue-crystal-mermaid-gown",
        name: "Marielle Blue Crystal Mermaid Gown",
        colorName: "Blue",
        colorHex: "#174ccf",
        stock: 1200,
      },
      {
        slug: "noelle-black-crystal-mermaid-gown",
        name: "Noelle Black Crystal Mermaid Gown",
        colorName: "Black",
        colorHex: "#141414",
        stock: 1200,
      },
    ],
  },
  {
    sourceId: "3256812468373035",
    price: 263.9,
    sizes: ["2", "4", "6", "8", "10", "12", "14", "14W", "16", "16W", "18W"],
    weightKg: 1.5,
    silhouette:
      "a glittering floor-length mermaid gown with a sweetheart corset, visible boning and tonal floral lace applique",
    materials:
      "Glitter tulle and floral lace applique over a structured corset lining with a softly flared hem.",
    variants: [
      {
        slug: "elowen-champagne-corset-mermaid-gown",
        name: "Elowen Champagne Corset Mermaid Gown",
        colorName: "Champagne",
        colorHex: "#d7c0a4",
        stock: 1198,
        assetColor: "same-as-image",
      },
    ],
  },
  {
    sourceId: "3256812245890987",
    price: 361.9,
    sizes: ["2", "4", "6", "8", "10", "12", "14", "16", "16W", "18W", "20W", "22W"],
    weightKg: 1,
    silhouette:
      "a strapless sweetheart mini dress with a beaded lace corset and long statement tassel fringe",
    materials:
      "Beaded lace over a structured mini lining with crystal embellishment and free-moving fringe.",
    variants: [
      {
        slug: "fabienne-red-tassel-mini-dress",
        name: "Fabienne Red Tassel Mini Dress",
        colorName: "Red",
        colorHex: "#b51f2d",
        stock: 115,
        assetColor: "model-color",
      },
    ],
  },
  {
    sourceId: "3256812744901666",
    price: 254.9,
    sizes: ["2", "4", "6", "8", "10", "12", "14", "16", "16W", "18W", "20W", "22W", "24W", "26W"],
    weightKg: 1.5,
    silhouette:
      "a floor-length formal mermaid gown with a plunging V neckline, long sheer sleeves, a fitted belt, statement appliques and three sculptural ruffle tiers",
    materials:
      "Textured formal fabric with transparent mesh sleeves, tonal applique and structured cascading ruffles.",
    variants: [
      {
        slug: "ravenna-black-tiered-mermaid-gown",
        name: "Ravenna Black Tiered Mermaid Gown",
        colorName: "Black",
        colorHex: "#171717",
        stock: 1399,
        assetColor: "as-pic",
      },
      {
        slug: "sabine-gray-tiered-mermaid-gown",
        name: "Sabine Gray Tiered Mermaid Gown",
        colorName: "Gray",
        colorHex: "#68686b",
        stock: 1400,
      },
      {
        slug: "tallulah-purple-tiered-mermaid-gown",
        name: "Tallulah Purple Tiered Mermaid Gown",
        colorName: "Purple",
        colorHex: "#63308d",
        stock: 1400,
      },
      {
        slug: "umbria-sky-blue-tiered-mermaid-gown",
        name: "Umbria Sky Blue Tiered Mermaid Gown",
        colorName: "Sky Blue",
        colorHex: "#9fc9e6",
        stock: 1400,
      },
      {
        slug: "valeria-pink-tiered-mermaid-gown",
        name: "Valeria Pink Tiered Mermaid Gown",
        colorName: "Pink",
        colorHex: "#e95c9b",
        stock: 1400,
      },
      {
        slug: "wisteria-blue-tiered-mermaid-gown",
        name: "Wisteria Blue Tiered Mermaid Gown",
        colorName: "Blue",
        colorHex: "#1452c6",
        stock: 1400,
      },
      {
        slug: "xenia-navy-tiered-mermaid-gown",
        name: "Xenia Navy Tiered Mermaid Gown",
        colorName: "Navy Blue",
        colorHex: "#172a53",
        stock: 1400,
      },
      {
        slug: "yvette-yellow-tiered-mermaid-gown",
        name: "Yvette Yellow Tiered Mermaid Gown",
        colorName: "Yellow",
        colorHex: "#e9ca45",
        stock: 1400,
      },
      {
        slug: "zahara-champagne-tiered-mermaid-gown",
        name: "Zahara Champagne Tiered Mermaid Gown",
        colorName: "Champagne",
        colorHex: "#d7bea0",
        stock: 1400,
      },
      {
        slug: "alessandra-red-tiered-mermaid-gown",
        name: "Alessandra Red Tiered Mermaid Gown",
        colorName: "Red",
        colorHex: "#a91e2b",
        stock: 1400,
      },
      {
        slug: "briseis-green-tiered-mermaid-gown",
        name: "Briseis Green Tiered Mermaid Gown",
        colorName: "Green",
        colorHex: "#176847",
        stock: 1400,
      },
      {
        slug: "cordelia-burgundy-tiered-mermaid-gown",
        name: "Cordelia Burgundy Tiered Mermaid Gown",
        colorName: "Burgundy",
        colorHex: "#651c2b",
        stock: 1400,
      },
      {
        slug: "dominique-ivory-tiered-mermaid-gown",
        name: "Dominique Ivory Tiered Mermaid Gown",
        colorName: "Ivory",
        colorHex: "#eee5d6",
        stock: 1400,
      },
    ],
  },
  {
    sourceId: "3256811940052222",
    price: 325.9,
    sizes: ["2", "4", "6", "8", "10", "12", "14", "14W", "16", "16W", "18W", "20W", "22W", "24W", "26W"],
    weightKg: 1.2,
    silhouette:
      "a sleeveless floor-length evening gown with a high wrapped neckline, a micro-pleated crossover bodice and dense metallic fringe falling from the waist",
    materials:
      "Fine pleated woven fabric with a smooth lining and long tonal metallic fringe.",
    variants: [
      {
        slug: "galina-sage-fringe-evening-gown",
        name: "Galina Sage Fringe Evening Gown",
        colorName: "Sage Green",
        colorHex: "#8ea17d",
        stock: 788,
        assetColor: "picture-color",
      },
    ],
  },
  {
    sourceId: "3256810249343548",
    price: 332.9,
    sizes: ["2", "4", "6", "8", "10", "12", "14", "14W", "16", "16W", "18", "18W"],
    weightKg: 1.5,
    silhouette:
      "a strapless glittering mermaid gown with a sweetheart neckline, a small illusion plunge, radiating beadwork and a floor-sweeping train",
    materials:
      "Glitter mesh with crystals and sequins over a structured formal lining.",
    variants: [
      {
        slug: "honora-red-glitter-mermaid-gown",
        name: "Honora Red Glitter Mermaid Gown",
        colorName: "Red",
        colorHex: "#ad1f2b",
        stock: 451,
        assetColor: "as-picture",
      },
    ],
  },
  {
    sourceId: "3256809424749127",
    price: 383.9,
    sizes: ["2", "4", "6", "8", "10", "12", "14", "14W", "16", "16W", "18W", "20W", "22W"],
    weightKg: 2,
    silhouette:
      "a sequined floor-length gown with a plunging halter V neckline, an open back, draped off-shoulder bands and a fitted trumpet finish",
    materials:
      "All-over sequin mesh over a smooth shaped lining with a soft floor-length train.",
    variants: [
      {
        slug: "ilaria-pink-sequin-halter-gown",
        name: "Ilaria Pink Sequin Halter Gown",
        colorName: "Pink",
        colorHex: "#e15c92",
        stock: 1399,
        assetColor: "as-picture",
      },
      {
        slug: "jacinta-navy-sequin-halter-gown",
        name: "Jacinta Navy Sequin Halter Gown",
        colorName: "Navy Blue",
        colorHex: "#18284b",
        stock: 1400,
      },
    ],
  },
  {
    sourceId: "3256809681210865",
    price: 98,
    sizes: ["S", "M", "L"],
    weightKg: 0.258,
    silhouette:
      "a fitted turtleneck midi dress with long sleeves, structured shoulders, symmetrical waist cutouts and a ruched wrap skirt with an irregular slit hem",
    materials:
      "Stretch knit jersey with a smooth hand, shaped ruching and soft comfortable structure.",
    variants: [
      {
        slug: "kallista-black-cutout-midi-dress",
        name: "Kallista Black Cutout Midi Dress",
        colorName: "Black",
        colorHex: "#171717",
        stock: 235,
      },
    ],
  },
];

export const september2026Products: Product[] = dressFamilies.flatMap((family, familyIndex) =>
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

export const september2026ProductSlugs = september2026Products.map((product) => product.slug);

const assetSlug = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const september2026ProductAssets = dressFamilies.flatMap((family) =>
  family.variants.map((variant) => ({
    sourceId: family.sourceId,
    color: variant.assetColor || assetSlug(variant.colorName),
    slug: variant.slug,
  })),
);
