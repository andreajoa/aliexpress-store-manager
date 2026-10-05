import type { Product } from "./data";

const fourViewSprite = { columns: 2, rows: 2, viewWidth: 627, viewHeight: 627 } as const;
const sheet = (slug: string) => [`/products/${slug}/sheet.webp`];

export const workProductOverrideSlugs = new Set([
  "lotus-midi-skirt",
  "gianna-maxi-skirt",
  "tessa-midi-dress",
  "mabel-print-dress",
]);

export const workProducts: Product[] = [
  {
    slug: "white-crochet-fringe-dress", name: "White Crochet Fringe Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 129.78,
    badge: "New", sheet: "one", quadrant: 1, colors: ["#f5f3ee"], colorNames: ["White"], sizes: ["S","M","L","XL"],
    description: "A sleeveless open-knit dress with an asymmetric neckline, waist-defining fit and tactile fringe finish for elevated warm-weather dressing.",
    materials: "Open-knit construction with fringe detailing. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. Handle fringe and open-knit areas gently and air dry when permitted.",
    images: sheet("white-crochet-fringe-dress"), gallerySprite: fourViewSprite, stock: 1998, weightOz: 17.64, minimumMarginPercent: 40,
  },
  {
    slug: "apricot-crochet-fringe-dress", name: "Apricot Crochet Fringe Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 129.78,
    badge: "New", sheet: "two", quadrant: 2, colors: ["#e7c5a3"], colorNames: ["Apricot"], sizes: ["S","M","L","XL"],
    description: "A sleeveless open-knit dress with an asymmetric neckline, waist-defining fit and tactile fringe finish in soft apricot.",
    materials: "Open-knit construction with fringe detailing. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. Handle fringe and open-knit areas gently and air dry when permitted.",
    images: sheet("apricot-crochet-fringe-dress"), gallerySprite: fourViewSprite, stock: 2000, weightOz: 17.64, minimumMarginPercent: 40,
  },
  {
    slug: "orange-crochet-fringe-dress", name: "Orange Crochet Fringe Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 129.78,
    badge: "New", sheet: "one", quadrant: 3, colors: ["#e56f2d"], colorNames: ["Orange"], sizes: ["S","M","L","XL"],
    description: "A sleeveless open-knit dress with an asymmetric neckline, waist-defining fit and tactile fringe finish in vivid orange.",
    materials: "Open-knit construction with fringe detailing. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. Handle fringe and open-knit areas gently and air dry when permitted.",
    images: sheet("orange-crochet-fringe-dress"), gallerySprite: fourViewSprite, stock: 2000, weightOz: 17.64, minimumMarginPercent: 40,
  },
  {
    slug: "black-lace-mermaid-gown", name: "Black Lace Mermaid Gown", vendor: "AMB BOUTIQUE", category: "Dresses", price: 337.50,
    badge: "New", sheet: "two", quadrant: 4, colors: ["#171717"], colorNames: ["Black"], sizes: ["2","4","6","8","10","12","14","16","16W","18W","20W","22W","24W","26W"],
    description: "A floor-length mermaid gown with sculpted lace detailing and a dramatic fitted silhouette designed for formal evenings and special occasions.",
    materials: "Lace-appliqué formal construction with lining. Exact fibre composition follows the garment label.", care: "Professional or specialist care is recommended. Follow the garment label for cleaning and storage.",
    images: sheet("black-lace-mermaid-gown"), gallerySprite: fourViewSprite, stock: 939, weightOz: 59.97, minimumMarginPercent: 40,
  },
  {
    slug: "fuchsia-chiffon-halter-gown", name: "Fuchsia Chiffon Halter Gown", vendor: "AMB BOUTIQUE", category: "Dresses", price: 255,
    badge:"New", sheet: "one", quadrant: 1, colors: ["#d92c78"], colorNames: ["Fuchsia"], sizes: ["2","4","6","8","10","12","14","16","16W","18W","20W","22W","24W","Custom Size"],
    description: "A sweeping chiffon gown with a sleeveless halter neckline and fluid floor-length skirt for weddings, galas and evening events.",
    materials: "Lightweight chiffon-style formal fabric. Exact fibre composition follows the garment label.", care: "Professional or specialist care is recommended. Follow the garment label for cleaning and storage.",
    images: sheet("fuchsia-chiffon-halter-gown"), gallerySprite: fourViewSprite, stock: 2996, weightOz: 56.44, minimumMarginPercent: 40,
  },
  {
    slug: "navy-crinkle-halter-maxi-dress", name: "Navy Crinkle Halter Maxi Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 82.65,
    badge: "New", sheet: "two", quadrant: 2, colors: ["#1b2838"], colorNames: ["Navy"], sizes: ["S","M","L","XL"],
    description: "An off-shoulder halter maxi dress with a softly crinkled texture, fluid skirt and waist tie in deep navy.",
    materials: "Textured crinkle fabric. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. Use gentle handling to preserve the crinkle texture.",
    images: sheet("navy-crinkle-halter-maxi-dress"), gallerySprite: fourViewSprite, stock: 20, weightOz: 13.97, minimumMarginPercent: 40,
  },
  {
    slug: "champagne-pleated-halter-gown", name: "Champagne Pleated Halter Gown", vendor: "AMB BOUTIQUE", category: "Dresses", price: 242.50,
    badge: "New", sheet: "one", quadrant: 3, colors: ["#e5d1a8"], colorNames: ["Champagne"], sizes: ["2","4","6","8","10","12","14","16","16W","18W","20W","22W","24W","26W","Custom Size"],
    description: "A floor-length champagne gown with a plunging halter neckline and finely pleated movement for formal celebrations and evening occasions.",
    materials: "Pleated formal fabric with fluid drape. Exact fibre composition follows the garment label.", care: "Professional or specialist care is recommended. Follow the garment label to preserve pleating.",
    images: sheet("champagne-pleated-halter-gown"), gallerySprite: fourViewSprite, stock: 1487, weightOz: 70.55, minimumMarginPercent: 40,
  },
  {
    slug: "bronze-brown-halter-gown", name: "Bronze Brown Halter Gown", vendor: "AMB BOUTIQUE", category: "Dresses", price: 243.78,
    badge: "New", sheet: "two", quadrant: 4, colors: ["#8a5b45"], colorNames: ["Brown"], sizes: ["US 2","US 4","US 6","US 8","US 10","US 12","US 14","US 16","US 16W","US 18W","US 20W","US 22W","US 24W","US 26W","Custom Size"],
    description: "A sleeveless halter evening gown with a deep V neckline and full-length formal silhouette in bronze brown.",
    materials: "Formal occasion fabric with fluid drape. Exact fibre composition follows the garment label.", care: "Professional or specialist care is recommended. Follow the garment label for cleaning and storage.",
    images: sheet("bronze-brown-halter-gown"), gallerySprite: fourViewSprite, stock: 15982, weightOz: 42.33, minimumMarginPercent: 40,
  },
  {
    slug: "ruby-red-halter-gown", name: "Ruby Red Halter Gown", vendor: "AMB BOUTIQUE", category: "Dresses", price: 243.78,
    badge: "New", sheet: "one", quadrant: 1, colors: ["#a51d2d"], colorNames: ["Red"], sizes: ["US 2","US 4","US 6","US 8","US 10","US 12","US 14","US 16","US 16W","US 18W","US 20W","US 22W","US 24W","US 26W","Custom Size"],
    description: "A sleeveless halter evening gown with a deep V neckline and full-length formal silhouette in saturated ruby red.",
    materials: "Formal occasion fabric with fluid drape. Exact fibre composition follows the garment label.", care: "Professional or specialist care is recommended. Follow the garment label for cleaning and storage.",
    images: sheet("ruby-red-halter-gown"), gallerySprite: fourViewSprite, stock: 15984, weightOz: 42.33, minimumMarginPercent: 40,
  },
  {
    slug: "black-halter-gown", name: "Black Halter Gown", vendor: "AMB BOUTIQUE", category: "Dresses", price: 243.78,
    badge: "New", sheet: "two", quadrant: 2, colors: ["#171717"], colorNames: ["Black"], sizes: ["US 2","US 4","US 6","US 8","US 10","US 12","US 14","US 16","US 16W","US 18W","US 20W","US 22W","US 24W","US 26W","Custom Size"],
    description: "A sleeveless halter evening gown with a deep V neckline and full-length formal silhouette in classic black.",
    materials: "Formal occasion fabric with fluid drape. Exact fibre composition follows the garment label.", care: "Professional or specialist care is recommended. Follow the garment label for cleaning and storage.",
    images: sheet("black-halter-gown"), gallerySprite: fourViewSprite, stock: 15983, weightOz: 42.33, minimumMarginPercent: 40,
  },
  {
    slug: "mint-beaded-boho-set", name: "Mint Beaded Boho Two-Piece Set", vendor: "AMB BOUTIQUE", category: "Sets", price: 89,
    badge: "New", sheet: "one", quadrant: 3, colors: ["#b2d8c1"], colorNames: ["Mint Green"], sizes: ["S","M","L"],
    description: "A coordinated beaded two-piece set with decorative mesh detailing and a draped skirt, presented in the mint-green supplier visual.",
    materials: "Mesh and embellished detailing. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. Handle beaded and mesh areas gently and air dry when permitted.",
    images: sheet("mint-beaded-boho-set"), gallerySprite: fourViewSprite, stock: 2963, weightOz: 17.64, minimumMarginPercent: 40,
  },
  {
    slug: "burgundy-ruched-one-shoulder-maxi-dress", name: "Burgundy Ruched One-Shoulder Maxi Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 127.50,
    badge: "New", sheet: "two", quadrant: 4, colors: ["#722f37"], colorNames: ["Burgundy"], sizes: ["S","M","L"],
    description: "A skew-neck maxi dress with rope detailing, sculpted cutouts and ruched draping in deep burgundy for vacation and evening styling.",
    materials: "Smooth stretch fabric with rope detailing. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. Wash gently when permitted and air dry.",
    images: sheet("burgundy-ruched-one-shoulder-maxi-dress"), gallerySprite: fourViewSprite, stock: 29996, weightOz: 25.04, minimumMarginPercent: 40,
  },
  {
    slug: "olive-ruched-asymmetric-maxi-dress", name: "Olive Ruched Asymmetric Maxi Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 127.50,
    badge: "New", sheet: "one", quadrant: 1, colors: ["#687154"], colorNames: ["Green"], sizes: ["S","M","L"],
    description: "A skew-neck maxi dress with rope detailing, sculpted cutouts and ruched draping in olive green for vacation and evening styling.",
    materials: "Smooth stretch fabric with rope detailing. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. Wash gently when permitted and air dry.",
    images: sheet("olive-ruched-asymmetric-maxi-dress"), gallerySprite: fourViewSprite, stock: 29996, weightOz: 25.04, minimumMarginPercent: 40,
  },
  {
    slug: "fuchsia-backless-maxi-dress", name: "Fuchsia Backless Maxi Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 77.56,
    badge: "New", sheet: "two", quadrant: 2, colors: ["#d92c78"], colorNames: ["Rose Red"], sizes: ["XS","S","M","L"],
    description: "An oblique-shoulder backless maxi dress with slender straps and ruched party-ready draping in vivid fuchsia.",
    materials: "Smooth stretch fabric with ruched detailing. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. Wash gently when permitted and air dry.",
    images: sheet("fuchsia-backless-maxi-dress"), gallerySprite: fourViewSprite, stock: 3996, weightOz: 17.64, minimumMarginPercent: 40,
  },
  {
    slug: "white-backless-maxi-dress", name: "White Backless Maxi Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 77.56,
    badge: "New", sheet: "one", quadrant: 3, colors: ["#f5f3ee"], colorNames: ["White"], sizes: ["XS","S","M","L"],
    description: "An oblique-shoulder backless maxi dress with slender straps and ruched party-ready draping in crisp white.",
    materials: "Smooth stretch fabric with ruched detailing. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. Wash gently when permitted and air dry.",
    images: ["/products/white-backless-maxi-dress/sheet-front-face-20261003.webp"], gallerySprite: fourViewSprite, stock: 3996, weightOz: 17.64, minimumMarginPercent: 40,
  },
  {
    slug: "black-asymmetric-maxi-dress", name: "Black Asymmetric Maxi Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 77.56,
    badge:"New", sheet: "two", quadrant: 4, colors: ["#171717"], colorNames: ["Black"], sizes: ["XS","S","M","L"],
    description: "An oblique-shoulder backless maxi dress with an asymmetric neckline and ruched party-ready draping in black.",
    materials: "Smooth stretch fabric with ruched detailing. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. Wash gently when permitted and air dry.",
    images: sheet("black-asymmetric-maxi-dress"), gallerySprite: fourViewSprite, stock: 3996, weightOz: 17.64, minimumMarginPercent: 40,
  },
  {
    slug: "lotus-midi-skirt", name: "Lotus Burgundy Sheath Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 58, compareAt: 75,
    badge: "Just In", sheet: "one", quadrant: 1, colors: ["#722f37"], colorNames: ["Burgundy"], sizes: ["S","M","L","XL","XXL"],
    description: "Lotus is corrected from its previous skirt label to a fitted burgundy sheath dress with a sleek, occasion-ready silhouette.",
    materials: "Smooth woven fabric with a softly structured finish. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. To preserve color and shape, use a cold gentle cycle when permitted and air dry.",
   images: sheet("lotus-midi-skirt"), gallerySprite: fourViewSprite, stock: 9999, weightOz: 12.73, minimumMarginPercent: 40,
  },
  {
    slug: "gianna-maxi-skirt", name: "Gianna Crochet Two-Piece Set", vendor: "AMB BOUTIQUE", category: "Sets", price: 58, compareAt: 75,
    badge: "Just In", sheet: "two", quadrant: 2, colors: ["#f5f3ee"], colorNames: ["White"], sizes: ["One Size"],
    description: "Gianna is corrected from its previous skirt label to a coordinated white crochet top-and-maxi-skirt set with openwork texture and a relaxed resort finish.",
    materials: "Crochet openwork construction. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. Handle openwork areas gently and air dry when permitted.",
    images: sheet("gianna-maxi-skirt"), gallerySprite: fourViewSprite, stock: 998, weightOz: 21.16, minimumMarginPercent: 40,
  },
  {
    slug: "tessa-midi-dress", name: "Tessa Rose Midi Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 68, compareAt: 85,
    badge: "Just In", sheet: "one", quadrant: 3, colors: ["#eee2cf"], colorNames: ["Ivory Rose"], sizes: ["S","M","L","XL","XXL"],
    description: "Tessa is a polished ivory midi dress finished with oversized rose motifs and a clean sleeveless silhouette.",
    materials: "Smooth printed woven fabric. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. To preserve the print and shape, use gentle care when permitted and air dry.",
    images: sheet("tessa-midi-dress"), gallerySprite: fourViewSprite, stock: 10, weightOz: 19.4, minimumMarginPercent: 40,
  },
  {
    slug: "mabel-print-dress", name: "Mabel Tropical Wrap Dress", vendor: "AMB BOUTIQUE", category: "Dresses", price: 68, compareAt: 85,
    badge: "Just In", sheet: "two", quadrant: 4, colors: ["#d9c8a8"], colorNames: ["Cream Tropical"], sizes: ["S","M","L","XL","XXL"],
    description: "Mabel is a cream tropical-print wrap dress with an easy waist definition and fluid warm-weather silhouette.",
    materials: "Smooth printed woven fabric. Exact fibre composition follows the garment label.", care: "Follow the care label attached to the garment. To preserve the print and shape, use gentle care when permitted and air dry.",
   images: sheet("mabel-print-dress"), gallerySprite: fourViewSprite, stock: 399, weightOz: 9.42, minimumMarginPercent: 40,
  },
];
