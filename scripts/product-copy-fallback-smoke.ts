import {
  buildGroundedFallback,
  productCopySchema,
  type OptimizeInput,
} from "../src/lib/product-copy.ts";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const input: OptimizeInput = {
  sourceTitle:
    "Magnetic Autism ADHD Anti-Stress Sensory Toy Purple 6 Pieces",
  sourceDescription: null,
  sourceCurrency: "USD",
  costMin: "3.20",
  costMax: "4.10",
  specifications: {
    Material: "ABS",
    Pieces: 6,
  },
  variants: [
    {
      sourceSkuId: "sku-purple",
      attributes: {
        Color: "Purple",
        Pieces: "6 pcs",
      },
      costPrice: "3.20",
      stock: 12,
    },
    {
      sourceSkuId: "sku-blue",
      attributes: {
        Color: "Blue",
        Pieces: "6 pcs",
      },
      costPrice: "4.10",
      stock: 8,
    },
  ],
};

const copy =
  buildGroundedFallback(input);

productCopySchema.parse(copy);

const serialized =
  JSON.stringify(copy).toLowerCase();

for (const forbidden of [
  "autism",
  "adhd",
  "anti-stress",
  "ansiedade",
  "terapêutico",
]) {
  assert(
    !serialized.includes(forbidden),
    `fallback manteve termo de risco: ${forbidden}`
  );
}

assert(
  serialized.includes("purple") &&
    serialized.includes("blue"),
  "fallback deveria preservar atributos factuais de cor"
);

assert(
  serialized.includes("6"),
  "fallback deveria preservar quantidade factual"
);

assert(
  copy.benefits.length >= 3,
  "fallback precisa satisfazer o contrato mínimo de benefits"
);

const second =
  buildGroundedFallback(input);

assert(
  JSON.stringify(copy) ===
    JSON.stringify(second),
  "fallback precisa ser determinístico"
);

console.log(
  "PRODUCT COPY GROUNDED FALLBACK: PASS"
);
