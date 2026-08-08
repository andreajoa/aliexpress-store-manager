import sharp from "sharp";
import { z } from "zod";

const auditSchema = z.object({
  fidelityScore:
    z.number()
      .min(0)
      .max(100),

  commercialScore:
    z.number()
      .min(0)
      .max(100),

  sameProduct:
    z.boolean(),

  newProductColors:
    z.boolean(),

  extraProductParts:
    z.boolean(),

  missingProductParts:
    z.boolean(),

  shapeChanged:
    z.boolean(),

  caseChanged:
    z.boolean(),

  textOrGraphics:
    z.boolean(),

  scenePlausible:
    z.boolean(),

  productClearlyVisible:
    z.boolean(),

  physicalOrAnatomicalError:
    z.boolean(),

  fidelityIssues:
    z.array(
      z.string()
    ),

  commercialIssues:
    z.array(
      z.string()
    ),

  regenerationHint:
    z.string(),
});

type StructuredAudit =
  z.infer<typeof auditSchema>;

export type FidelityAudit = {
  score: number;

  productIdentityPreserved:
    boolean;

  unsupportedColors:
    string[];

  extraParts:
    boolean;

  missingParts:
    boolean;

  shapeChanged:
    boolean;

  caseChanged:
    boolean;

  textOrGraphics:
    boolean;

  commercialScore:
    number;

  scenePlausible:
    boolean;

  productClearlyVisible:
    boolean;

  physicalOrAnatomicalError:
    boolean;

  issues:
    string[];

  commercialIssues:
    string[];

  regenerationHint:
    string;

  pass:
    boolean;
};

const jsonSchema = {
  type:
    "object",

  properties: {
    fidelityScore: {
      type:
        "number",

      minimum:
        0,

      maximum:
        100,
    },

    commercialScore: {
      type:
        "number",

      minimum:
        0,

      maximum:
        100,
    },

    sameProduct: {
      type:
        "boolean",
    },

    newProductColors: {
      type:
        "boolean",
    },

    extraProductParts: {
      type:
        "boolean",
    },

    missingProductParts: {
      type:
        "boolean",
    },

    shapeChanged: {
      type:
        "boolean",
    },

    caseChanged: {
      type:
        "boolean",
    },

    textOrGraphics: {
      type:
        "boolean",
    },

    scenePlausible: {
      type:
        "boolean",
    },

    productClearlyVisible: {
      type:
        "boolean",
    },

    physicalOrAnatomicalError: {
      type:
        "boolean",
    },

    fidelityIssues: {
      type:
        "array",

      items: {
        type:
          "string",
      },
    },

    commercialIssues: {
      type:
        "array",

      items: {
        type:
          "string",
      },
    },

    regenerationHint: {
      type:
        "string",
    },
  },

  required: [
    "fidelityScore",
    "commercialScore",
    "sameProduct",
    "newProductColors",
    "extraProductParts",
    "missingProductParts",
    "shapeChanged",
    "caseChanged",
    "textOrGraphics",
    "scenePlausible",
    "productClearlyVisible",
    "physicalOrAnatomicalError",
    "fidelityIssues",
    "commercialIssues",
    "regenerationHint",
  ],

  additionalProperties:
    false,
};


async function downloadImage(
  url: string
) {
  const response =
    await fetch(
      url,
      {
        cache:
          "no-store",

        headers: {
          Accept:
            "image/*",

          "User-Agent":
            "Store-Manager-Gemma-Audit/6.0",
        },

        signal:
          AbortSignal.timeout(
            25000
          ),
      }
    );

  if (!response.ok) {
    throw new Error(
      `Imagem de referência HTTP ${response.status}`
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}


async function normalizeImage(
  image: Buffer
) {
  return sharp(
    image
  )
    .resize({
      width:
        640,

      height:
        640,

      fit:
        "contain",

      background: {
        r:
          255,

        g:
          255,

        b:
          255,

        alpha:
          1,
      },
    })
    .jpeg({
      quality:
        92,
    })
    .toBuffer();
}


async function buildComparison({
  referenceUrl,
  generatedImage,
}: {
  referenceUrl:
    string;

  generatedImage:
    Buffer;
}) {
  const originalRaw =
    await downloadImage(
      referenceUrl
    );

  const [
    original,
    generated,
  ] =
    await Promise.all([
      normalizeImage(
        originalRaw
      ),

      normalizeImage(
        generatedImage
      ),
    ]);

  /*
   * Evitamos texto desenhado
   * dentro da imagem.
   *
   * O prompt sabe:
   * esquerda = original
   * direita = gerada.
   */
  return sharp({
    create: {
      width:
        1300,

      height:
        640,

      channels:
        3,

      background: {
        r:
          255,

        g:
          255,

        b:
          255,
      },
    },
  })
    .composite([
      {
        input:
          original,

        left:
          0,

        top:
          0,
      },

      {
        input:
          generated,

        left:
          660,

        top:
          0,
      },
    ])
    .jpeg({
      quality:
        92,
    })
    .toBuffer();
}


// AUDITOR V6.1 — NORMALIZADOR ROBUSTO

function canonicalKey(
  key: string
) {
  return key
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}

const aliases:
  Record<string, string[]> = {
    fidelityScore: [
      "fidelityscore",
      "fidelity",
      "score",
    ],

    commercialScore: [
      "commercialscore",
      "commercial",
    ],

    sameProduct: [
      "sameproduct",
      "samephysicalproduct",
      "productidentitypreserved",
    ],

    newProductColors: [
      "newproductcolors",
      "newcolors",
      "inventedcolors",
    ],

    extraProductParts: [
      "extraproductparts",
      "extraparts",
      "inventedparts",
    ],

    missingProductParts: [
      "missingproductparts",
      "missingparts",
    ],

    shapeChanged: [
      "shapechanged",
    ],

    caseChanged: [
      "casechanged",
      "containerchanged",
    ],

    textOrGraphics: [
      "textorgraphics",
      "textgraphics",
    ],

    scenePlausible: [
      "sceneplausible",
      "plausiblescene",
    ],

    productClearlyVisible: [
      "productclearlyvisible",
      "clearlyvisible",
      "productvisible",
    ],

    physicalOrAnatomicalError: [
      "physicaloranatomicalerror",
      "physicalerror",
      "anatomicalerror",
    ],

    fidelityIssues: [
      "fidelityissues",
      "productissues",
      "issues",
    ],

    commercialIssues: [
      "commercialissues",
      "sceneissues",
    ],

    regenerationHint: [
      "regenerationhint",
      "fix",
      "correction",
    ],
  };


function findAliasedValue(
  object: Record<string, unknown>,
  field: string
) {
  const accepted =
    aliases[field] || [
      canonicalKey(field),
    ];

  for (
    const [key, value] of
      Object.entries(object)
  ) {
    if (
      accepted.includes(
        canonicalKey(key)
      )
    ) {
      return value;
    }
  }

  return undefined;
}


function normalizeNumber(
  value: unknown
): number | undefined {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    if (
      value >= 0 &&
      value <= 1
    ) {
      return Math.round(
        value * 100
      );
    }

    return Math.max(
      0,
      Math.min(
        100,
        value
      )
    );
  }

  if (
    typeof value === "string"
  ) {
    const match =
      value.match(
        /-?\d+(?:\.\d+)?/
      );

    if (match) {
      const number =
        Number(match[0]);

      if (
        Number.isFinite(number)
      ) {
        if (
          number >= 0 &&
          number <= 1
        ) {
          return Math.round(
            number * 100
          );
        }

        return Math.max(
          0,
          Math.min(
            100,
            number
          )
        );
      }
    }
  }

  return undefined;
}


function normalizeBoolean(
  value: unknown
): boolean | undefined {
  if (
    typeof value === "boolean"
  ) {
    return value;
  }

  if (
    typeof value === "number"
  ) {
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }
  }

  if (
    typeof value === "string"
  ) {
    const normalized =
      value
        .trim()
        .toLowerCase();

    if (
      [
        "yes",
        "true",
        "sim",
        "1",
      ].includes(normalized)
    ) {
      return true;
    }

    if (
      [
        "no",
        "false",
        "não",
        "nao",
        "0",
      ].includes(normalized)
    ) {
      return false;
    }
  }

  return undefined;
}


function normalizeArray(
  value: unknown
): string[] | undefined {
  if (
    Array.isArray(value)
  ) {
    return value
      .map(
        item =>
          String(item).trim()
      )
      .filter(Boolean);
  }

  if (
    typeof value === "string"
  ) {
    const trimmed =
      value.trim();

    if (
      !trimmed ||
      /^(none|no issues|nenhum|n\/a)$/i.test(
        trimmed
      )
    ) {
      return [];
    }

    return trimmed
      .split(/[;|]/)
      .map(
        item =>
          item.trim()
      )
      .filter(Boolean);
  }

  return undefined;
}


function normalizeString(
  value: unknown
): string | undefined {
  if (
    typeof value === "string"
  ) {
    return value.trim();
  }

  return undefined;
}


function normalizeAuditCandidate(
  object: Record<string, unknown>
):
  | Record<string, unknown>
  | null {
  const fidelityScore =
    normalizeNumber(
      findAliasedValue(
        object,
        "fidelityScore"
      )
    );

  const commercialScore =
    normalizeNumber(
      findAliasedValue(
        object,
        "commercialScore"
      )
    );

  const sameProduct =
    normalizeBoolean(
      findAliasedValue(
        object,
        "sameProduct"
      )
    );

  const newProductColors =
    normalizeBoolean(
      findAliasedValue(
        object,
        "newProductColors"
      )
    );

  const extraProductParts =
    normalizeBoolean(
      findAliasedValue(
        object,
        "extraProductParts"
      )
    );

  const missingProductParts =
    normalizeBoolean(
      findAliasedValue(
        object,
        "missingProductParts"
      )
    );

  const shapeChanged =
    normalizeBoolean(
      findAliasedValue(
        object,
        "shapeChanged"
      )
    );

  const caseChanged =
    normalizeBoolean(
      findAliasedValue(
        object,
        "caseChanged"
      )
    );

  const textOrGraphics =
    normalizeBoolean(
      findAliasedValue(
        object,
        "textOrGraphics"
      )
    );

  const scenePlausible =
    normalizeBoolean(
      findAliasedValue(
        object,
        "scenePlausible"
      )
    );

  const productClearlyVisible =
    normalizeBoolean(
      findAliasedValue(
        object,
        "productClearlyVisible"
      )
    );

  const physicalOrAnatomicalError =
    normalizeBoolean(
      findAliasedValue(
        object,
        "physicalOrAnatomicalError"
      )
    );

  const critical = [
    fidelityScore,
    commercialScore,
    sameProduct,
    newProductColors,
    extraProductParts,
    missingProductParts,
    shapeChanged,
    caseChanged,
    textOrGraphics,
    scenePlausible,
    productClearlyVisible,
    physicalOrAnatomicalError,
  ];

  if (
    critical.some(
      item =>
        item === undefined
    )
  ) {
    return null;
  }

  const fidelityIssues =
    normalizeArray(
      findAliasedValue(
        object,
        "fidelityIssues"
      )
    ) || [];

  const commercialIssues =
    normalizeArray(
      findAliasedValue(
        object,
        "commercialIssues"
      )
    ) || [];

  const regenerationHint =
    normalizeString(
      findAliasedValue(
        object,
        "regenerationHint"
      )
    ) ||
    "Preserve the exact physical product and correct the detected visual issues.";

  return {
    fidelityScore,
    commercialScore,
    sameProduct,
    newProductColors,
    extraProductParts,
    missingProductParts,
    shapeChanged,
    caseChanged,
    textOrGraphics,
    scenePlausible,
    productClearlyVisible,
    physicalOrAnatomicalError,
    fidelityIssues,
    commercialIssues,
    regenerationHint,
  };
}


function stripCodeFence(
  value: string
) {
  return value
    .replace(
      /^```json\s*/i,
      ""
    )
    .replace(
      /^```\s*/i,
      ""
    )
    .replace(
      /```$/i,
      ""
    )
    .trim();
}


function parseLineResponse(
  text: string
):
  | Record<string, unknown>
  | null {
  const object:
    Record<string, unknown> = {};

  const cleaned =
    text
      .replace(
        /[*`#]/g,
        ""
      );

  for (
    const rawLine of
      cleaned.split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    const colon =
      line.indexOf(":");

    if (
      colon <= 0
    ) {
      continue;
    }

    const key =
      line
        .slice(
          0,
          colon
        )
        .trim();

    const value =
      line
        .slice(
          colon + 1
        )
        .trim();

    if (
      key &&
      value
    ) {
      object[key] =
        value;
    }
  }

  if (
    Object.keys(object)
      .length === 0
  ) {
    return null;
  }

  return normalizeAuditCandidate(
    object
  );
}


function parseTextCandidate(
  text: string
):
  | Record<string, unknown>
  | null {
  const cleaned =
    stripCodeFence(text);

  try {
    const parsed =
      JSON.parse(cleaned);

    const found =
      deepFindAudit(
        parsed,
        0
      );

    if (found) {
      return found;
    }
  } catch {
    //
  }

  const firstBrace =
    cleaned.indexOf("{");

  const lastBrace =
    cleaned.lastIndexOf("}");

  if (
    firstBrace >= 0 &&
    lastBrace >
      firstBrace
  ) {
    try {
      const parsed =
        JSON.parse(
          cleaned.slice(
            firstBrace,
            lastBrace + 1
          )
        );

      const found =
        deepFindAudit(
          parsed,
          0
        );

      if (found) {
        return found;
      }
    } catch {
      //
    }
  }

  return parseLineResponse(
    cleaned
  );
}


function deepFindAudit(
  value: unknown,
  depth: number
):
  | Record<string, unknown>
  | null {
  if (
    depth > 12 ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value ===
      "string"
  ) {
    return parseTextCandidate(
      value
    );
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item of value
    ) {
      const found =
        deepFindAudit(
          item,
          depth + 1
        );

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (
    typeof value !==
      "object"
  ) {
    return null;
  }

  const object =
    value as
      Record<string, unknown>;

  /*
   * Pode ser que o próprio
   * objeto já seja o resultado.
   */
  const candidate =
    normalizeAuditCandidate(
      object
    );

  if (candidate) {
    return candidate;
  }

  /*
   * Wrappers mais comuns
   * primeiro.
   */
  const preferredKeys = [
    "result",
    "response",
    "output",
    "answer",
    "content",
    "message",
    "text",
    "data",
    "choices",
  ];

  for (
    const key of
      preferredKeys
  ) {
    if (
      object[key] !==
      undefined
    ) {
      const found =
        deepFindAudit(
          object[key],
          depth + 1
        );

      if (found) {
        return found;
      }
    }
  }

  /*
   * E finalmente qualquer
   * outro wrapper desconhecido.
   */
  for (
    const [
      key,
      nested,
    ] of Object.entries(
      object
    )
  ) {
    if (
      preferredKeys.includes(
        key
      )
    ) {
      continue;
    }

    const found =
      deepFindAudit(
        nested,
        depth + 1
      );

    if (found) {
      return found;
    }
  }

  return null;
}


function extractStructuredResult(
  payload: unknown
): unknown {
  const result =
    deepFindAudit(
      payload,
      0
    );

  if (result) {
    return result;
  }

  let preview =
    "";

  try {
    preview =
      JSON.stringify(
        payload
      ).slice(
        0,
        1800
      );
  } catch {
    preview =
      String(payload).slice(
        0,
        1800
      );
  }

  /*
   * Falha de interpretação
   * continua sendo erro técnico.
   *
   * Nunca vira 0%.
   */
  throw new Error(
    `Não encontrei uma auditoria estruturada na resposta da Cloudflare. Envelope: ${preview}`
  );
}


export async function auditEditorialFidelity({
  referenceUrl,
  generatedImage,
  sceneType,
}: {
  referenceUrl:
    string;

  generatedImage:
    Buffer;

  sceneType:
    string;
}): Promise<FidelityAudit> {
  const accountId =
    process.env
      .CLOUDFLARE_ACCOUNT_ID;

  const token =
    process.env
      .CLOUDFLARE_API_TOKEN;

  const model =
    process.env
      .CLOUDFLARE_AUDIT_MODEL ||
    "@cf/google/gemma-4-26b-a4b-it";

  if (
    !accountId ||
    !token
  ) {
    throw new Error(
      "Cloudflare Workers AI não configurada."
    );
  }

  const partialVisibilityAllowed =
    sceneType ===
      "AI_IN_USE" ||
    sceneType ===
      "AI_DETAIL_CONTEXT";

  const comparison =
    await buildComparison({
      referenceUrl,
      generatedImage,
    });

  const prompt = `
You are a senior ecommerce visual quality-control inspector.

You receive ONE comparison image.

LEFT HALF:
the authoritative original product photograph.

RIGHT HALF:
the AI-generated commercial photograph that must be audited.

The background, lighting, camera angle and composition are intentionally allowed to change.

Judge the PHYSICAL PRODUCT, not the photography style.

SCENE TYPE:
${sceneType}

PARTIAL VISIBILITY ALLOWED:
${partialVisibilityAllowed ? "YES" : "NO"}

PRODUCT FIDELITY RULES

The generated product may have:
- different lighting
- different reflections
- different shadows
- different perspective
- different background
- hands nearby or touching it
- different arrangement of the same legitimate pieces

Those are NOT automatically errors.

Look for actual physical deviations:
- another product
- different case/container
- new physical colors
- invented pieces
- duplicated pieces
- missing required pieces
- changed physical construction
- changed shape
- invented accessory
- advertising text or graphics inserted into the photograph

For partial visibility:
if PARTIAL VISIBILITY ALLOWED is YES,
pieces outside the crop must NOT be marked missing merely because they are not visible.

COMMERCIAL QUALITY RULES

Determine whether the RIGHT image is genuinely useful in a professional ecommerce gallery.

Check:
- plausible scene
- believable physical scale
- realistic interaction
- realistic anatomy
- product easy to understand
- no misleading implied use
- no impossible positioning
- no accidental duplicated objects

IMPORTANT SCORING CALIBRATION

fidelityScore 95-100:
the physical product is essentially preserved.

fidelityScore 85-94:
small visual differences exist but it is clearly the same sellable product.

fidelityScore 60-84:
meaningful product alterations.

fidelityScore below 60:
major identity failure or substantially different product.

Do NOT assign 0 merely because the scene differs from the source photograph.

commercialScore measures the usefulness of the RIGHT photograph for ecommerce, not similarity of background.

Return only the requested structured JSON.
`;

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  let lastError:
    Error | null =
    null;

  for (
    let attempt = 0;
    attempt < 2;
    attempt++
  ) {
    try {
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
                      "You are a strict ecommerce visual QA inspector. Analyze the image actually attached to the user message and return only the requested structured audit.",
                  },

                  {
                    role:
                      "user",

                    /*
                     * Cloudflare multimodal chat:
                     *
                     * TEXTO + IMAGEM precisam estar
                     * dentro do content da mesma
                     * mensagem.
                     */
                    content: [
                      {
                        type:
                          "text",

                        text:
                          prompt,
                      },

                      {
                        type:
                          "image_url",

                        image_url: {
                          url:
                            `data:image/jpeg;base64,${comparison.toString(
                              "base64"
                            )}`,
                        },
                      },
                    ],
                  },
                ],

                temperature:
                  0,

                /*
                 * O modelo estava consumindo
                 * todo o limite no reasoning
                 * antes de produzir o JSON.
                 */
                /*
                 * As três cenas normais já
                 * concluem corretamente.
                 *
                 * DETAIL_CONTEXT exige mais
                 * espaço por causa do reasoning.
                 */
                max_completion_tokens:
                  sceneType ===
                    "AI_DETAIL_CONTEXT"
                    ? attempt === 0
                      ? 3200
                      : 4800
                    : 1800,

                reasoning_effort:
                  "low",

                stream:
                  false,

                response_format: {
                  type:
                    "json_schema",

                  json_schema:
                    jsonSchema,
                },
              }),

            signal:
              AbortSignal.timeout(
                120000
              ),
          }
        );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          `Gemma HTTP ${response.status}: ${JSON.stringify(
            payload
          ).slice(
            0,
            1200
          )}`
        );
      }

      /*
       * Se o modelo gastar todo o
       * orçamento em reasoning, isso
       * é falha técnica — nunca 0%.
       */
      const finishReason =
        payload &&
        typeof payload ===
          "object" &&
        !Array.isArray(
          payload
        )
          ? (
              payload as Record<
                string,
                unknown
              >
            ).result
          : null;

      let detectedFinish:
        string | null =
        null;

      if (
        finishReason &&
        typeof finishReason ===
          "object" &&
        !Array.isArray(
          finishReason
        )
      ) {
        const resultObject =
          finishReason as Record<
            string,
            unknown
          >;

        const choices =
          resultObject.choices;

        if (
          Array.isArray(
            choices
          ) &&
          choices[0] &&
          typeof choices[0] ===
            "object"
        ) {
          const reason =
            (
              choices[0] as Record<
                string,
                unknown
              >
            ).finish_reason;

          if (
            typeof reason ===
              "string"
          ) {
            detectedFinish =
              reason;
          }
        }
      }

      if (
        detectedFinish ===
        "length"
      ) {
        throw new Error(
          "Gemma interrompeu a auditoria por limite de saída antes de concluir o JSON."
        );
      }

      const structured =
        auditSchema.parse(
          extractStructuredResult(
            payload
          )
        );

      const score =
        structured.fidelityScore /
        100;

      const commercialScore =
        structured.commercialScore /
        100;

      const criticalMissing =
        !partialVisibilityAllowed &&
        structured.missingProductParts;

      /*
       * O modelo pode reconhecer corretamente
       * a alteração física dentro de
       * fidelityIssues mesmo quando um booleano
       * específico permaneceu false.
       *
       * Em ecommerce, textura/material diferente
       * é alteração do produto e deve bloquear.
       */
      const criticalPhysicalIssue =
        structured.fidelityIssues.some(
          issue =>
            /\b(texture|textured|material|construction|shape|case|container|color|colour|duplicate|duplicated|extra|missing|accessory|accessories|facet|faceted|metallic)\b/i.test(
              issue
            )
        );

      const fidelityPass =
        score >=
          0.88 &&
        structured.sameProduct &&
        !structured.newProductColors &&
        !structured.extraProductParts &&
        !criticalMissing &&
        !structured.shapeChanged &&
        !structured.caseChanged &&
        !structured.textOrGraphics &&
        !criticalPhysicalIssue;

      const commercialPass =
        commercialScore >=
          0.78 &&
        structured.scenePlausible &&
        structured.productClearlyVisible &&
        !structured.physicalOrAnatomicalError;

      const pass =
        fidelityPass &&
        commercialPass;

      console.log(
        `[Gemma Audit] ${sceneType} | ` +
        `fidelidade=${structured.fidelityScore}% | ` +
        `comercial=${structured.commercialScore}% | ` +
        `${pass ? "PASS" : "FAIL"}`
      );

      return {
        score,

        productIdentityPreserved:
          structured.sameProduct,

        unsupportedColors:
          structured.newProductColors
            ? [
                "Cor física não presente na referência.",
              ]
            : [],

        extraParts:
          structured.extraProductParts,

        missingParts:
          structured.missingProductParts,

        shapeChanged:
          structured.shapeChanged,

        caseChanged:
          structured.caseChanged,

        textOrGraphics:
          structured.textOrGraphics,

        commercialScore,

        scenePlausible:
          structured.scenePlausible,

        productClearlyVisible:
          structured.productClearlyVisible,

        physicalOrAnatomicalError:
          structured.physicalOrAnatomicalError,

        issues:
          structured.fidelityIssues,

        commercialIssues:
          structured.commercialIssues,

        regenerationHint:
          structured.regenerationHint,

        pass,
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error(
              "Erro desconhecido na auditoria."
            );

      console.warn(
        `[Gemma Audit] tentativa ${attempt + 1}/2 falhou:`,
        lastError.message
      );

      if (
        attempt === 0
      ) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              1500
            )
        );
      }
    }
  }

  throw (
    lastError ||
    new Error(
      "Auditoria Gemma falhou."
    )
  );
}
