import {
  buildGroundedFallback,
  productCopySchema,
  type OptimizeInput,
} from "../src/lib/product-copy.ts";
import type { CopyLanguage } from "../src/lib/copy-language.ts";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const baseInput: Omit<
  OptimizeInput,
  "language"
> = {
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

const expectedLanguageMarkers: Record<
  CopyLanguage,
  string[]
> = {
  "pt-BR": [
    "opções",
    "variante",
  ],
  en: [
    "options",
    "variant",
  ],
  fr: [
    "options",
    "variante",
  ],
  de: [
    "optionen",
    "variante",
  ],
};

for (
  const language of [
    "pt-BR",
    "en",
    "fr",
    "de",
  ] as const
) {
  const input: OptimizeInput = {
    ...baseInput,
    language,
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
    "autisme",
    "therapie",
  ]) {
    assert(
      !serialized.includes(forbidden),
      `fallback ${language} manteve termo de risco: ${forbidden}`
    );
  }

  assert(
    serialized.includes("purple") &&
      serialized.includes("blue"),
    `fallback ${language} deveria preservar atributos factuais de cor`
  );

  assert(
    serialized.includes("6"),
    `fallback ${language} deveria preservar quantidade factual`
  );

  assert(
    copy.benefits.length >= 3,
    `fallback ${language} precisa satisfazer o contrato mínimo de benefits`
  );

  for (
    const marker of
    expectedLanguageMarkers[language]
  ) {
    assert(
      serialized.includes(marker),
      `fallback ${language} não contém marcador esperado: ${marker}`
    );
  }

  const second =
    buildGroundedFallback(input);

  assert(
    JSON.stringify(copy) ===
      JSON.stringify(second),
    `fallback ${language} precisa ser determinístico`
  );
}

console.log(
  "PRODUCT COPY MULTILINGUAL GROUNDED FALLBACK: PASS"
);
