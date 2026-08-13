import {
  buildGroundedFallback,
  generateProductCopy,
  type OptimizeInput,
  type ProductCopy,
} from "./product-copy.ts";

const QUOTA_COOLDOWN_MS = 60_000;

let quotaBlockedUntil = 0;

export function isGeminiQuotaError(
  error: unknown
) {
  if (!error) {
    return false;
  }

  const record =
    typeof error === "object"
      ? (error as Record<string, unknown>)
      : null;

  const code = record?.code;
  const status = record?.status;

  let serialized = "";

  try {
    serialized = JSON.stringify(error);
  } catch {
    serialized = String(error);
  }

  const message =
    error instanceof Error
      ? `${error.message} ${serialized}`
      : `${String(error)} ${serialized}`;

  return (
    code === 429 ||
    status === "RESOURCE_EXHAUSTED" ||
    /(?:\b429\b|resource_exhausted|quota exceeded|rate limit)/i.test(
      message
    )
  );
}

export async function generateQuotaSafeProductCopy(
  input: OptimizeInput
): Promise<ProductCopy> {
  if (Date.now() < quotaBlockedUntil) {
    console.warn(
      "[Gemini quota] cooldown ativo; usando fallback factual sem nova chamada ao Gemini."
    );

    return buildGroundedFallback(input);
  }

  try {
    return await generateProductCopy(input);
  } catch (error) {
    if (!isGeminiQuotaError(error)) {
      throw error;
    }

    quotaBlockedUntil =
      Date.now() + QUOTA_COOLDOWN_MS;

    console.warn(
      "[Gemini quota] 429/RESOURCE_EXHAUSTED; usando fallback factual e pausando novas chamadas por 60 segundos."
    );

    return buildGroundedFallback(input);
  }
}
