import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const schema = z.object({
  lifestyle: z.string().min(80).max(2400),
  inUse: z.string().min(80).max(2400),
  premiumScene: z.string().min(80).max(2400),
  detailContext: z.string().min(80).max(2400),
});

export type EditorialPlan = z.infer<typeof schema>;

const responseSchema = {
  type: "object",
  properties: {
    lifestyle: { type: "string" },
    inUse: { type: "string" },
    premiumScene: { type: "string" },
    detailContext: { type: "string" },
  },
  required: ["lifestyle", "inUse", "premiumScene", "detailContext"],
  additionalProperties: false,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const item = error as { status?: number; message?: string };

  if ([429, 500, 502, 503, 504].includes(item.status || 0)) {
    return true;
  }

  const message = String(item.message || "").toLowerCase();

  return (
    message.includes("high demand") ||
    message.includes("unavailable") ||
    message.includes("resource exhausted") ||
    message.includes("temporarily")
  );
}

function strictRules() {
  return `
Use input_image_0 as the PRIMARY AND AUTHORITATIVE product reference.

If additional reference images exist, they are SUPPORT ONLY.
Never merge different variants from different reference images.
Never mix colors from different variants.
Never mix quantities from different variants.

CRITICAL FIDELITY RULES:
- Preserve the exact real product shown in input_image_0.
- Preserve the exact case, exact shape, exact proportions, exact textures and exact visible construction.
- Preserve only the colors that are visibly present in input_image_0.
- Do not introduce any extra color not present in input_image_0.
- Do not invent green, blue, pink or any other variation unless it is clearly present in input_image_0.
- Do not add extra balls, extra accessories or extra pieces.
- Do not change the quantity of visible pieces.
- Do not redesign the product.
- Do not create a new version of the product.
- Do not turn the product into a 3D render or stylized fake object.
- The result must look like a real commercial photograph.

STRICTLY FORBIDDEN:
- text
- words
- letters
- numbers
- typography
- labels
- prices
- banners
- cards
- posters
- borders
- marketing graphics
- infographics
- watermarks
- logos invented by the model

STYLE:
- Realistic premium ecommerce photography
- Realistic lighting
- Realistic shadows
- Realistic materials
- Product clearly visible
- Emotion and commercial appeal
- No medical or therapeutic claims
`;
}

function inferContext(title: string, category: string | null) {
  const value = `${title} ${category || ""}`.toLowerCase();

  if (/(brinquedo|toy|fidget|sensorial|magnetic|magnético|magnetico|jogo|game)/i.test(value)) {
    return {
      lifestyle:
        "a tasteful modern home environment, warm daylight, premium decor, emotionally inviting and realistic",
      inUse:
        "adult hands naturally handling the exact product in a believable and useful way",
      premium:
        "a refined premium commercial setup in a real interior setting, with elegant composition and depth",
      detail:
        "a close commercial macro-style photograph highlighting real materials, textures and exact physical details",
    };
  }

  if (/(bolsa|bag|handbag|purse|carteira|wallet)/i.test(value)) {
    return {
      lifestyle:
        "an elegant fashion lifestyle environment with a refined premium atmosphere",
      inUse:
        "an adult fashion model naturally carrying or holding the exact product",
      premium:
        "a luxury fashion editorial setting with tasteful composition and realistic styling",
      detail:
        "a close commercial photograph emphasizing texture, stitching, hardware and exact details",
    };
  }

  if (/(sapato|shoe|sneaker|sandália|sandalia|heel|boot|bota|tênis|tenis)/i.test(value)) {
    return {
      lifestyle:
        "a premium fashion lifestyle environment with realistic lighting",
      inUse:
        "an adult naturally wearing or handling the exact product",
      premium:
        "a polished premium fashion editorial composition",
      detail:
        "a close commercial photograph emphasizing texture, structure and exact physical details",
    };
  }

  return {
    lifestyle:
      "a tasteful premium contemporary lifestyle environment with realistic daylight",
    inUse:
      "an adult naturally using or holding the exact product in a believable way",
    premium:
      "a refined premium editorial setting with elegant realistic composition",
    detail:
      "a close commercial photograph highlighting exact materials, textures and construction",
  };
}

function buildFallback({
  title,
  category,
  brand,
  batch,
}: {
  title: string;
  category: string | null;
  brand: unknown;
  batch: number;
}): EditorialPlan {
  const context = inferContext(title, category);
  const brandText = JSON.stringify(brand || {}, null, 2);
  const rules = strictRules();

  return {
    lifestyle: `
Create a realistic premium ecommerce lifestyle photograph.

Product: ${title}

Environment:
${context.lifestyle}

Use input_image_0 as the exact product source of truth.
If input_image_1 or input_image_2 exist, use them only as support references for material realism and perspective, never to change the variant.

The product must remain exactly the same as in input_image_0.
Keep the product as the hero of the scene.
Subtly respect this store visual identity when helpful, without turning the image into a graphic card:
${brandText}

Create a new and distinct composition for generation batch ${batch}.

${rules}
`,

    inUse: `
Create a realistic premium commercial photograph showing:
${context.inUse}

Use the exact product from input_image_0.
Show believable real-world handling.
Keep the product clearly visible and recognizable.

Do not add or replace pieces.
Do not change colors.
Do not mix variants.

Create a distinct composition for generation batch ${batch}.

${rules}
`,

    premiumScene: `
Create a refined premium editorial ecommerce photograph.

Product: ${title}

Environment:
${context.premium}

Use the exact product from input_image_0 as the hero object.
The image must feel premium, emotional and commercially strong.
No graphic layout, no added design elements, no fake advertising treatment.

Create a composition clearly different from the lifestyle and inUse scenes for batch ${batch}.

${rules}
`,

    detailContext: `
Create a close premium commercial photograph.

Product: ${title}

Focus:
${context.detail}

Use the exact product from input_image_0.
Show a closer view while preserving the exact product identity.
If hands appear, they must help demonstrate scale or interaction naturally.

Create a distinct composition for batch ${batch}.

${rules}
`,
  };
}

export async function planEditorialScenes({
  title,
  description,
  category,
  ageRange,
  brand,
  batch,
}: {
  title: string;
  description: string | null;
  category: string | null;
  ageRange: string | null;
  variants: unknown;
  brand: unknown;
  batch: number;
}): Promise<EditorialPlan> {
  const fallback = buildFallback({
    title,
    category,
    brand,
    batch,
  });

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("[Editorial planner] Gemini ausente; usando fallback local rígido.");
    return fallback;
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const prompt = `
You are a premium ecommerce photography creative director.

You must generate FOUR image prompts in English for product photography.

IMPORTANT:
The system will pass product reference images separately.
input_image_0 is the single authoritative source of truth.

PRODUCT SUMMARY:
${JSON.stringify(
  {
    title,
    description,
    category,
    ageRange,
  },
  null,
  2
)}

STORE BRAND SUMMARY:
${JSON.stringify(brand, null, 2)}

GENERATION BATCH:
${batch}

Create exactly these 4 prompts:
1. lifestyle
2. inUse
3. premiumScene
4. detailContext

VERY IMPORTANT PRODUCT FIDELITY RULES:
- input_image_0 is the real exact product.
- If more reference images exist, they are support only.
- Never merge different variants.
- Never combine colors from different variants.
- Never invent colors not visible in input_image_0.
- Never add extra pieces.
- Never change the quantity of visible pieces.
- Preserve the exact case, product shape, textures, proportions and real construction.
- Realistic photography only.
- No text.
- No words.
- No numbers.
- No labels.
- No posters.
- No frames.
- No cards.
- No banners.
- No infographic look.
- No stylized fake render.
- Product must remain highly recognizable.

SCENE GOAL:
The images must help ecommerce conversion:
- emotional
- premium
- useful
- realistic
- commercially strong

If age suitability is not explicitly confirmed, use adult hands or adult models only.

Return JSON only.
`;

  const delays = [1200, 3000, 6500];

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: 0.45,
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      if (!response.text) {
        throw new Error("Gemini retornou vazio.");
      }

      const parsed = schema.parse(JSON.parse(response.text));

      console.log(`[Editorial planner] Gemini OK na tentativa ${attempt + 1}`);
      return parsed;
    } catch (error) {
      console.warn(
        `[Editorial planner] tentativa ${attempt + 1} falhou`,
        error instanceof Error ? error.message : error
      );

      if (!isTransientError(error)) {
        break;
      }

      if (attempt < 2) {
        await sleep(delays[attempt] + Math.floor(Math.random() * 500));
      }
    }
  }

  console.warn("[Editorial planner] usando fallback local rígido.");
  return fallback;
}
