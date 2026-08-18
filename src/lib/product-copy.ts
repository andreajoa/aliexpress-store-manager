import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import {
  DEFAULT_COPY_LANGUAGE,
  type CopyLanguage,
} from "./copy-language.ts";

export const productCopySchema = z.object({
  optimizedTitle: z.string().min(8).max(100),
  headline: z.string().min(8).max(140),
  shortDescription: z.string().min(30).max(500),

  benefits: z
    .array(z.string().min(5).max(140))
    .min(3)
    .max(5),

  cta: z.string().min(5).max(90),
  seoTitle: z.string().min(8).max(70),
  seoDescription: z.string().min(30).max(170),
});

export type ProductCopy =
  z.infer<typeof productCopySchema>;

const auditSchema = z.object({
  approved: z.boolean(),
  unsupportedClaims: z.array(z.string()),
  reason: z.string(),
});

export type OptimizeInput = {
  language?: CopyLanguage;
  sourceTitle: string;
  sourceDescription: string | null;
  sourceCurrency: string | null;
  costMin: string | null;
  costMax: string | null;
  specifications: unknown;

  variants: Array<{
    sourceSkuId: string;
    attributes: unknown;
    costPrice: string | null;
    stock: number | null;
  }>;
};

const copyResponseSchema = {
  type: "object",
  properties: {
    optimizedTitle: { type: "string" },
    headline: { type: "string" },
    shortDescription: { type: "string" },
    benefits: {
      type: "array",
      items: { type: "string" },
    },
    cta: { type: "string" },
    seoTitle: { type: "string" },
    seoDescription: { type: "string" },
  },
  required: [
    "optimizedTitle",
    "headline",
    "shortDescription",
    "benefits",
    "cta",
    "seoTitle",
    "seoDescription",
  ],
  additionalProperties: false,
};

const auditResponseSchema = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    unsupportedClaims: {
      type: "array",
      items: { type: "string" },
    },
    reason: { type: "string" },
  },
  required: [
    "approved",
    "unsupportedClaims",
    "reason",
  ],
  additionalProperties: false,
};

type LanguageProfile = {
  name: string;
  instruction: string;
  fallbackTitle: string;
  variantSingle: string;
  variantPlural: string;
  listingSuffix: string;
  optionFact: string;
  chooseVariant: string;
  checkSpecs: string;
  descriptionPrefix: string;
  descriptionSuffix: string;
  headlinePrefix: string;
  cta: string;
};

const LANGUAGE_PROFILES: Record<
  CopyLanguage,
  LanguageProfile
> = {
  "pt-BR": {
    name: "Português do Brasil",
    instruction:
      "Escreva todos os campos da copy em português natural do Brasil.",
    fallbackTitle:
      "Produto do catálogo AliExpress",
    variantSingle:
      "variação cadastrada",
    variantPlural:
      "variações cadastradas",
    listingSuffix:
      "no anúncio.",
    optionFact:
      "Opções apresentadas conforme os dados do anúncio original.",
    chooseVariant:
      "Escolha a variante desejada antes de finalizar o pedido.",
    checkSpecs:
      "Confira as especificações cadastradas na página do produto.",
    descriptionPrefix:
      "Informações organizadas a partir dos dados do anúncio original.",
    descriptionSuffix:
      "Confira as opções e especificações disponíveis antes de escolher a variante.",
    headlinePrefix:
      "Confira",
    cta:
      "Confira as opções e escolha a variante desejada.",
  },
  en: {
    name: "English",
    instruction:
      "Write every copy field in natural, commercial English.",
    fallbackTitle:
      "AliExpress catalog product",
    variantSingle:
      "variant listed",
    variantPlural:
      "variants listed",
    listingSuffix:
      "in the original listing.",
    optionFact:
      "Options are presented according to the original listing data.",
    chooseVariant:
      "Choose the desired variant before completing your order.",
    checkSpecs:
      "Check the specifications shown on the product page.",
    descriptionPrefix:
      "Information organized from the original listing data.",
    descriptionSuffix:
      "Check the available options and specifications before choosing a variant.",
    headlinePrefix:
      "Discover",
    cta:
      "Check the options and choose the variant you want.",
  },
  fr: {
    name: "Français",
    instruction:
      "Rédige tous les champs de la copy dans un français naturel et commercial.",
    fallbackTitle:
      "Produit du catalogue AliExpress",
    variantSingle:
      "variante répertoriée",
    variantPlural:
      "variantes répertoriées",
    listingSuffix:
      "dans l’annonce d’origine.",
    optionFact:
      "Les options sont présentées selon les données de l’annonce d’origine.",
    chooseVariant:
      "Choisissez la variante souhaitée avant de finaliser votre commande.",
    checkSpecs:
      "Consultez les caractéristiques indiquées sur la page du produit.",
    descriptionPrefix:
      "Informations organisées à partir des données de l’annonce d’origine.",
    descriptionSuffix:
      "Consultez les options et caractéristiques disponibles avant de choisir une variante.",
    headlinePrefix:
      "Découvrez",
    cta:
      "Consultez les options et choisissez la variante souhaitée.",
  },
  de: {
    name: "Deutsch",
    instruction:
      "Schreibe alle Copy-Felder in natürlichem, verkaufsorientiertem Deutsch.",
    fallbackTitle:
      "Produkt aus dem AliExpress-Katalog",
    variantSingle:
      "Variante aufgeführt",
    variantPlural:
      "Varianten aufgeführt",
    listingSuffix:
      "im ursprünglichen Angebot.",
    optionFact:
      "Die Optionen entsprechen den Daten des ursprünglichen Angebots.",
    chooseVariant:
      "Wähle die gewünschte Variante vor Abschluss der Bestellung.",
    checkSpecs:
      "Prüfe die auf der Produktseite angegebenen Spezifikationen.",
    descriptionPrefix:
      "Informationen auf Grundlage der Daten des ursprünglichen Angebots.",
    descriptionSuffix:
      "Prüfe die verfügbaren Optionen und Spezifikationen, bevor du eine Variante auswählst.",
    headlinePrefix:
      "Entdecke",
    cta:
      "Prüfe die Optionen und wähle die gewünschte Variante.",
  },
};

function languageOf(input: OptimizeInput) {
  return input.language || DEFAULT_COPY_LANGUAGE;
}

function profileOf(input: OptimizeInput) {
  return LANGUAGE_PROFILES[languageOf(input)];
}

const SYSTEM = `
Você escreve páginas comerciais de produtos para uma loja online.

REGRA PRINCIPAL:
Você só pode afirmar aquilo que esteja comprovado pelos dados fornecidos.

PROIBIDO:
- inventar benefícios;
- inventar finalidade;
- inventar material;
- inventar tamanho do produto;
- inventar idade;
- inventar certificação;
- inventar conforto;
- inventar facilidade de transporte;
- inventar uso silencioso;
- inventar durabilidade;
- inventar contexto de uso;
- inventar efeitos sobre atenção, foco, ansiedade, estresse, autismo ou TDAH;
- fazer qualquer alegação médica ou terapêutica.

Se o fornecedor usar palavras como:
autism, ADHD, anxiety, anti-stress, sensory, therapy
trate isso apenas como linguagem do anúncio original.
NÃO transforme em benefício clínico.

Você pode afirmar fatos comprovados, por exemplo:
- quantidade de peças disponível;
- cores existentes;
- existência de variantes;
- produto magnético, se isso estiver explicitamente no título;
- características explicitamente presentes nos dados.

A copy deve ser:
- curta;
- natural;
- clara;
- comercial;
- sem tradução robótica;
- sem urgência falsa;
- sem exageros.

O idioma solicitado é obrigatório para todos os campos da resposta.
Use princípios de clareza de oferta e resposta direta,
sem imitar a voz ou frases de nenhum autor específico.
`;

function facts(input: OptimizeInput) {
  return {
    outputLanguage:
      profileOf(input).name,
    title: input.sourceTitle,
    description: input.sourceDescription,
    currency: input.sourceCurrency,
    priceRange: {
      min: input.costMin,
      max: input.costMax,
    },
    specifications:
      input.specifications,
    variants:
      input.variants.map(
        (variant) => ({
          sku: variant.sourceSkuId,
          attributes: variant.attributes,
          cost: variant.costPrice,
          stock: variant.stock,
        })
      ),
  };
}

const riskyMarketingTerms =
  /\b(?:autism|autistic|adhd|anxiety|anti[\s-]?stress|therapy|therapeutic|autismo|autista|tdah|ansiedade|terap[eê]utic[oa]|terapia|autisme|autiste|anxi[eé]t[eé]|th[eé]rapie|therapeutique|therapeutisch|therapie)\b/gi;

function compactText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(
  value: string,
  max: number
) {
  const clean = compactText(value);

  if (clean.length <= max) {
    return clean;
  }

  return clean
    .slice(0, max)
    .replace(/\s+\S*$/, "")
    .trim();
}

function neutralizeRiskyTerms(
  value: string
) {
  return compactText(
    value
      .replace(riskyMarketingTerms, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
  );
}

function scalarText(
  value: unknown
): string | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const text = neutralizeRiskyTerms(
      String(value)
    );

    return text || null;
  }

  if (Array.isArray(value)) {
    const values: string[] = value
      .map((item) => scalarText(item))
      .filter(
        (item): item is string =>
          Boolean(item)
      );

    return values.length
      ? values.join(", ")
      : null;
  }

  return null;
}

function catalogFacts(input: OptimizeInput) {
  const profile = profileOf(input);
  const collected = new Map<
    string,
    Set<string>
  >();

  const addRecord = (value: unknown) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return;
    }

    for (
      const [rawKey, rawValue]
      of Object.entries(
        value as Record<string, unknown>
      )
    ) {
      const key = neutralizeRiskyTerms(
        rawKey
      );
      const text = scalarText(rawValue);

      if (!key || !text) {
        continue;
      }

      const values =
        collected.get(key) ||
        new Set<string>();

      values.add(text);
      collected.set(key, values);
    }
  };

  addRecord(input.specifications);

  for (const variant of input.variants) {
    addRecord(variant.attributes);
  }

  const result: string[] = [];

  if (input.variants.length > 0) {
    result.push(
      `${input.variants.length} ${
        input.variants.length === 1
          ? profile.variantSingle
          : profile.variantPlural
      } ${profile.listingSuffix}`
    );
  }

  for (
    const [key, values]
    of collected
  ) {
    const visibleValues =
      [...values].slice(0, 6);

    const line = truncateText(
      `${key}: ${visibleValues.join(", ")}.`,
      140
    );

    if (line.length >= 5) {
      result.push(line);
    }
  }

  return result;
}

export function buildGroundedFallback(
  input: OptimizeInput
): ProductCopy {
  const profile = profileOf(input);
  const language = languageOf(input);
  const neutralTitle = truncateText(
    neutralizeRiskyTerms(
      input.sourceTitle
    ),
    100
  );

  const optimizedTitle =
    language === "pt-BR" &&
    neutralTitle.length >= 8
      ? neutralTitle
      : profile.fallbackTitle;

  const factualLines =
    catalogFacts(input);

  const benefits = [
    ...factualLines,
    profile.optionFact,
    profile.chooseVariant,
    profile.checkSpecs,
  ]
    .filter(
      (value, index, values) =>
        values.indexOf(value) === index
    )
    .slice(0, 5);

  const detail =
    factualLines.length
      ? ` ${factualLines
          .slice(0, 2)
          .join(" ")}`
      : "";

  const shortDescription =
    truncateText(
      `${profile.descriptionPrefix}${detail} ${profile.descriptionSuffix}`,
      500
    );

  const headline =
    truncateText(
      `${profile.headlinePrefix} ${optimizedTitle}`,
      140
    );

  const seoTitle =
    truncateText(
      optimizedTitle,
      70
    );

  const seoDescription =
    truncateText(
      shortDescription,
      170
    );

  return productCopySchema.parse({
    optimizedTitle,
    headline,
    shortDescription,
    benefits,
    cta: profile.cta,
    seoTitle,
    seoDescription,
  });
}

async function generate(
  ai: GoogleGenAI,
  model: string,
  input: OptimizeInput,
  correction?: string[]
) {
  const profile = profileOf(input);

  const response =
    await ai.models.generateContent({
      model,
      contents: `
IDIOMA OBRIGATÓRIO DA COPY:
${profile.name}
${profile.instruction}

DADOS FACTUAIS:

${JSON.stringify(
  facts(input),
  null,
  2
)}

${
  correction?.length
    ? `
UMA VERSÃO ANTERIOR FOI REJEITADA
POR CONTER ESTAS AFIRMAÇÕES NÃO COMPROVADAS:

${JSON.stringify(correction)}

Não repita essas afirmações.
Se não houver dados suficientes para uma promessa comercial,
use apenas características literais do catálogo e instruções neutras de escolha.
`
    : ""
}

Crie a apresentação comercial inteira no idioma solicitado.
`,
      config: {
        systemInstruction: SYSTEM,
        temperature: 0.25,
        responseMimeType:
          "application/json",
        responseSchema:
          copyResponseSchema,
      },
    });

  if (!response.text) {
    throw new Error(
      "Gemini não retornou uma copy."
    );
  }

  const raw = JSON.parse(response.text) as Record<string, unknown>;

  // O Gemini às vezes excede os limites de caracteres pedidos.
  // Truncar antes de validar evita rejeição desnecessária.
  if (typeof raw.optimizedTitle === "string") raw.optimizedTitle = truncateText(raw.optimizedTitle, 100);
  if (typeof raw.headline === "string") raw.headline = truncateText(raw.headline, 140);
  if (typeof raw.shortDescription === "string") raw.shortDescription = truncateText(raw.shortDescription, 500);
  if (typeof raw.seoTitle === "string") raw.seoTitle = truncateText(raw.seoTitle, 70);
  if (typeof raw.seoDescription === "string") raw.seoDescription = truncateText(raw.seoDescription, 170);
  if (typeof raw.cta === "string") raw.cta = truncateText(raw.cta, 90);

  return productCopySchema.parse(raw);
}

async function audit(
  ai: GoogleGenAI,
  model: string,
  input: OptimizeInput,
  copy: ProductCopy
) {
  const profile = profileOf(input);

  const response =
    await ai.models.generateContent({
      model,
      contents: `
Atue como auditor factual extremamente rigoroso.

Compare a COPY com os DADOS ORIGINAIS.
O idioma obrigatório da copy é: ${profile.name}.
Marque approved=false se os campos comerciais não estiverem nesse idioma.

DADOS ORIGINAIS:

${JSON.stringify(
  facts(input),
  null,
  2
)}

COPY:

${JSON.stringify(
  copy,
  null,
  2
)}

Marque approved=false se QUALQUER afirmação da copy
não puder ser sustentada diretamente pelos dados.

Exemplos que devem ser rejeitados quando não comprovados:
- melhora o foco;
- reduz ansiedade;
- alivia estresse;
- silencioso;
- portátil;
- cabe no bolso;
- ideal para reuniões;
- indicado para estudo;
- confortável;
- terapêutico;
- estimula habilidades;
- resistente;
- seguro para crianças.

Se houver dúvida, rejeite.
`,
      config: {
        temperature: 0,
        responseMimeType:
          "application/json",
        responseSchema:
          auditResponseSchema,
      },
    });

  if (!response.text) {
    throw new Error(
      "Gemini não retornou auditoria."
    );
  }

  return auditSchema.parse(
    JSON.parse(response.text)
  );
}

export async function generateProductCopy(
  input: OptimizeInput
): Promise<ProductCopy> {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY não configurada."
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
  });

  const model =
    process.env.GEMINI_MODEL ||
    "gemini-3.5-flash";

  let forbidden:
    | string[]
    | undefined;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    const copy = await generate(
      ai,
      model,
      input,
      forbidden
    );

    const review = await audit(
      ai,
      model,
      input,
      copy
    );

    if (review.approved) {
      return copy;
    }

    console.warn(
      `[Gemini audit] tentativa ${attempt} rejeitada`,
      review.unsupportedClaims
    );

    forbidden =
      review.unsupportedClaims;
  }

  console.warn(
    "[Gemini audit] 3 tentativas rejeitadas; usando fallback factual determinístico."
  );

  return buildGroundedFallback(input);
}
