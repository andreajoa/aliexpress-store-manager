import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

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

  unsupportedClaims: z.array(
    z.string()
  ),

  reason: z.string(),
});

type OptimizeInput = {
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
    optimizedTitle: {
      type: "string",
    },

    headline: {
      type: "string",
    },

    shortDescription: {
      type: "string",
    },

    benefits: {
      type: "array",
      items: {
        type: "string",
      },
    },

    cta: {
      type: "string",
    },

    seoTitle: {
      type: "string",
    },

    seoDescription: {
      type: "string",
    },
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
    approved: {
      type: "boolean",
    },

    unsupportedClaims: {
      type: "array",
      items: {
        type: "string",
      },
    },

    reason: {
      type: "string",
    },
  },

  required: [
    "approved",
    "unsupportedClaims",
    "reason",
  ],

  additionalProperties: false,
};

const SYSTEM = `
Você escreve páginas comerciais de produtos para uma loja brasileira.

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
- em português do Brasil;
- sem tradução robótica;
- sem urgência falsa;
- sem exageros.

Use princípios de clareza de oferta e resposta direta,
sem imitar a voz ou frases de nenhum autor específico.
`;

function facts(input: OptimizeInput) {
  return {
    title: input.sourceTitle,
    description: input.sourceDescription,

    currency:
      input.sourceCurrency,

    priceRange: {
      min: input.costMin,
      max: input.costMax,
    },

    specifications:
      input.specifications,

    variants:
      input.variants.map(
        (variant) => ({
          sku:
            variant.sourceSkuId,

          attributes:
            variant.attributes,

          cost:
            variant.costPrice,

          stock:
            variant.stock,
        })
      ),
  };
}

async function generate(
  ai: GoogleGenAI,
  model: string,
  input: OptimizeInput,
  correction?: string[]
) {
  const response =
    await ai.models.generateContent({
      model,

      contents: `
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
`
    : ""
}

Crie a apresentação comercial.
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

  return productCopySchema.parse(
    JSON.parse(response.text)
  );
}

async function audit(
  ai: GoogleGenAI,
  model: string,
  input: OptimizeInput,
  copy: ProductCopy
) {
  const response =
    await ai.models.generateContent({
      model,

      contents: `
Atue como auditor factual extremamente rigoroso.

Compare a COPY com os DADOS ORIGINAIS.

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

  const ai =
    new GoogleGenAI({
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
    const copy =
      await generate(
        ai,
        model,
        input,
        forbidden
      );

    const review =
      await audit(
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

  throw new Error(
    "A IA não conseguiu produzir uma copy totalmente sustentada pelos dados após 3 tentativas."
  );
}
