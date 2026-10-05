import type { Product } from "./data";
import { workProducts } from "./work-products";

const BAG_CARE = "Wipe clean with a soft damp cloth. Avoid prolonged moisture, direct heat and abrasive surfaces. Store filled to preserve shape.";
const BAG_MATERIALS = "Soft synthetic leather or textile upper with synthetic lining and polished metal hardware. Exact composition follows the product label.";

const BAG_COPY: Record<string, string> = {
  carryall: "A sculptural everyday tote with a softly structured silhouette, generous capacity and an easy shoulder drop for polished days on the move.",
  crossbody: "A compact hands-free bag with considered compartments, refined proportions and an interior designed to keep daily essentials in order.",
  backpack: "A compact backpack with elegant curves, versatile straps and an organised interior for effortless day-to-evening wear.",
  satchel: "A polished top-handle satchel with a composed silhouette, optional shoulder strap and divided interior for work-to-weekend styling.",
  chain: "A refined quilted crossbody with a polished chain strap, sculptural turn-lock and organised interior for evening-ready ease.",
  tote: "A clean structured tote with an easy shoulder drop and practical divided interior for work, travel and everyday essentials.",
};

type BagKind = keyof typeof BAG_COPY;

function localGallery(slug: string): string[] {
  return ["01", "02", "03", "04"].map((view) => `/editorial/bags/products/${slug}/${view}.webp?v=20260811-complete-gallery`);
}

function bag(
  slug: string,
  name: string,
  price: number,
  color: string,
  colorName: string,
  stock: number,
  weightOz: number,
  unitCostUsd: number,
  kind: BagKind,
): Product {
  return {
    slug,
    name,
    vendor: "AMB BOUTIQUE",
    category: "Bags",
    price,
    badge: "New",
    sheet: "one",
    quadrant: 1,
    colors: [color],
    colorNames: [colorName],
    sizes: ["One Size"],
    description: BAG_COPY[kind],
    materials: BAG_MATERIALS,
    care: BAG_CARE,
    images: localGallery(slug),
    stock,
    weightOz,
    unitCostUsd,
    minimumMarginPercent: 40,
    styleEligible: true,
  };
}

// Every customer-facing bag below has four independent AMB-hosted images:
// front, back, side and open interior. No remote marketplace media is used.
const bagProducts: Product[] = [
  bag("portofino-carryall-black", "Portofino Carryall — Black", 79, "#171717", "Black", 2, 25.29, 25.67, "carryall"),
  bag("noir-lace-crossbody-black", "Noir Lace Crossbody — Black", 49, "#171717", "Black", 28, 6.31, 6.81, "crossbody"),
  bag("camille-multi-pocket-crossbody-green", "Camille Crossbody — Forest", 59, "#234c3c", "Forest Green", 1, 9.88, 9.86, "crossbody"),
  bag("florence-mini-backpack-apricot", "Florence Mini — Apricot", 59, "#d7b58d", "Apricot", 123, 3.49, 10.78, "backpack"),
  bag("avery-bow-satchel-pink", "Avery Bow Satchel — Rose", 69, "#a9576f", "Dusty Rose", 16, 13.62, 11.98, "satchel"),
  bag("siena-signature-satchel-kangaroo-brown", "Siena Signature — Espresso", 98, "#5b4034", "Espresso", 1, 26.49, 34.12, "satchel"),
  bag("celeste-chain-crossbody-black", "Celeste Chain — Black", 98, "#171717", "Black", 2, 16.4, 29.94, "chain"),
  bag("marina-structured-tote-brown", "Marina Tote — Cognac", 108, "#b86126", "Cognac", 4, 17.88, 32.64, "tote"),
  bag("portofino-carryall-burgundy", "Portofino Carryall — Burgundy", 79, "#742c3d", "Burgundy", 3, 25.29, 24.07, "carryall"),
  bag("florence-mini-backpack-pink", "Florence Mini — Pink", 59, "#d9a0ab", "Pink", 145, 3.49, 10.78, "backpack"),
  bag("portofino-carryall-army-green", "Portofino Carryall — Olive", 79, "#59624a", "Olive", 990, 25.29, 25.68, "carryall"),
  bag("florence-mini-backpack-dark-brown", "Florence Mini — Dark Brown", 59, "#4b3328", "Dark Brown", 242, 3.49, 9.11, "backpack"),
  bag("portofino-carryall-light-brown", "Portofino Carryall — Cognac", 79, "#b86d3f", "Cognac", 994, 25.29, 24.77, "carryall"),
  bag("florence-mini-backpack-black", "Florence Mini — Black", 59, "#171717", "Black", 113, 3.49, 10.84, "backpack"),
  bag("portofino-carryall-brown", "Portofino Carryall — Espresso", 79, "#4b3028", "Espresso", 4, 25.29, 25.74, "carryall"),
];

export const supplementalProducts: Product[] = [...bagProducts, ...workProducts];
