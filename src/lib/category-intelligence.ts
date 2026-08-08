import {
  z,
} from "zod";

import type {
  StoreCategory,
} from "@/lib/store-intelligence";

const resultSchema =
  z.object({
    categoryId:
      z.string(),

    categoryName:
      z.string(),

    confidence:
      z.number()
        .min(0)
        .max(1),

    reason:
      z.string()
        .min(3)
        .max(300),
  });

export type CategorySuggestion =
  z.infer<
    typeof resultSchema
  >;

const jsonSchema = {
  type:
    "object",

  properties: {
    categoryId: {
      type:
        "string",
    },

    categoryName: {
      type:
        "string",
    },

    confidence: {
      type:
        "number",
    },

    reason: {
      type:
        "string",
    },
  },

  required: [
    "categoryId",
    "categoryName",
    "confidence",
    "reason",
  ],

  additionalProperties:
    false,
};

type ProductFacts = {
  sourceTitle:
    string;

  optimizedTitle:
    string | null;

  headline:
    string | null;

  description:
    string | null;

  benefits:
    unknown;

  specifications:
    unknown;

  variants:
    Array<{
      attributes:
        unknown;
    }>;
};

function parseResponse(
  payload: unknown
) {
  if (
    !payload ||
    typeof payload !==
      "object"
  ) {
    throw new Error(
      "Resposta inválida."
    );
  }

  const result =
    (
      payload as Record<
        string,
        unknown
      >
    ).result;

  if (
    !result ||
    typeof result !==
      "object"
  ) {
    throw new Error(
      "Cloudflare não retornou result."
    );
  }

  const response =
    (
      result as Record<
        string,
        unknown
      >
    ).response;

  if (
    typeof response ===
      "string"
  ) {
    return JSON.parse(
      response
        .replace(
          /^```json\s*/i,
          ""
        )
        .replace(
          /```$/i,
          ""
        )
        .trim()
    );
  }

  return response;
}

export async function suggestCategory({
  categories,
  product,
  niche,
}: {
  categories:
    StoreCategory[];

  product:
    ProductFacts;

  niche:
    string | null;
}): Promise<CategorySuggestion> {
  if (
    categories.length ===
    0
  ) {
    throw new Error(
      "A loja não possui categorias."
    );
  }

  if (
    categories.length ===
    1
  ) {
    return {
      categoryId:
        categories[0].id,

      categoryName:
        categories[0].name,

      confidence:
        1,

      reason:
        "Única categoria disponível na loja.",
    };
  }

  const accountId =
    process.env
      .CLOUDFLARE_ACCOUNT_ID;

  const token =
    process.env
      .CLOUDFLARE_API_TOKEN;

  const model =
    process.env
      .CLOUDFLARE_TEXT_MODEL ||
    "@cf/meta/llama-3.1-8b-instruct-fast";

  if (
    !accountId ||
    !token
  ) {
    throw new Error(
      "Cloudflare AI não configurada."
    );
  }

  const prompt = `
Choose the ONE most appropriate existing store category for this ecommerce product.

STORE NICHE:
${niche || "not provided"}

ALLOWED CATEGORIES:
${JSON.stringify(
  categories,
  null,
  2
)}

PRODUCT:
${JSON.stringify(
  product,
  null,
  2
)}

STRICT RULES:
- Select exactly one category from ALLOWED CATEGORIES.
- Never invent a category.
- categoryId and categoryName must match the same provided category.
- Base the decision on observable product type, function and attributes.
- Do not use medical, therapeutic, autism, ADHD, anxiety or stress claims as classification evidence.
- confidence must be between 0 and 1.
- reason must be short and factual.
- Return structured JSON only.
`;

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const response =
    await fetch(
      endpoint,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Bearer ${token}`,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            messages: [
              {
                role:
                  "system",

                content:
                  "You are an ecommerce taxonomy classifier.",
              },

              {
                role:
                  "user",

                content:
                  prompt,
              },
            ],

            temperature:
              0.1,

            max_tokens:
              300,

            response_format: {
              type:
                "json_schema",

              json_schema:
                jsonSchema,
            },
          }),

        signal:
          AbortSignal.timeout(
            60000
          ),
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      `Cloudflare Category AI: ${JSON.stringify(
        data
      ).slice(
        0,
        1000
      )}`
    );
  }

  const parsed =
    resultSchema.parse(
      parseResponse(
        data
      )
    );

  const match =
    categories.find(
      category =>
        category.id ===
          parsed.categoryId ||
        category.name
          .toLowerCase() ===
          parsed.categoryName
            .toLowerCase()
    );

  if (!match) {
    throw new Error(
      "A IA escolheu uma categoria inexistente."
    );
  }

  return {
    categoryId:
      match.id,

    categoryName:
      match.name,

    confidence:
      Math.max(
        0,
        Math.min(
          1,
          parsed.confidence
        )
      ),

    reason:
      parsed.reason,
  };
}
