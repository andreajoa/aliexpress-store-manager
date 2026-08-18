import {
  buildGroundedFallback,
  generateProductCopy,
  type OptimizeInput,
  type ProductCopy,
} from "./product-copy.ts";

const QUOTA_COOLDOWN_MS = 60_000;
const AVAILABILITY_COOLDOWN_MS = 30_000;
const AVAILABILITY_RETRY_DELAYS_MS = [1_000, 2_000];

let geminiBlockedUntil = 0;

function errorRecord(error: unknown) {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : null;
}

function nestedErrorRecord(error: unknown) {
  const record = errorRecord(error);
  const nested = record?.error;
  return nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)
    : null;
}

function errorText(error: unknown) {
  let serialized = "";

  try {
    serialized = JSON.stringify(error);
  } catch {
    serialized = String(error);
  }

  return error instanceof Error
    ? `${error.message} ${serialized}`
    : `${String(error)} ${serialized}`;
}

export function isGeminiQuotaError(
  error: unknown
) {
  if (!error) {
    return false;
  }

  const record = errorRecord(error);
  const nested = nestedErrorRecord(error);
  const code = record?.code ?? nested?.code;
  const status = record?.status ?? nested?.status;
  const message = errorText(error);

  return (
    code === 429 ||
    status === "RESOURCE_EXHAUSTED" ||
    /(?:\b429\b|resource_exhausted|quota exceeded|rate limit)/i.test(
      message
    )
  );
}

export function isGeminiUnavailableError(
  error: unknown
) {
  if (!error) {
    return false;
  }

  const record = errorRecord(error);
  const nested = nestedErrorRecord(error);
  const code = record?.code ?? nested?.code;
  const status = record?.status ?? nested?.status;
  const message = errorText(error);

  return (
    code === 503 ||
    status === "UNAVAILABLE" ||
    /(?:\b503\b|\bunavailable\b|high demand|temporarily overloaded|temporarily unavailable)/i.test(
      message
    )
  );
}

export function isGeminiOutputValidationError(
  error: unknown
) {
  if (!error) {
    return false;
  }

  const record = errorRecord(error);
  const issues = record?.issues;
  const message = errorText(error);

  return (
    record?.name === "ZodError" ||
    Array.isArray(issues) ||
    /(?:ZodError|too_big|too_small|expected string to have <=\d+ characters)/i.test(
      message
    )
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function generateQuotaSafeProductCopy(
  input: OptimizeInput
): Promise<ProductCopy> {
  if (Date.now() < geminiBlockedUntil) {
    console.warn(
      "[Gemini resilience] cooldown ativo; usando fallback factual sem nova chamada ao Gemini."
    );

    return buildGroundedFallback(input);
  }

  for (
    let attempt = 1;
    attempt <= AVAILABILITY_RETRY_DELAYS_MS.length + 1;
    attempt++
  ) {
    try {
      return await generateProductCopy(input);
    } catch (error) {
      if (isGeminiQuotaError(error)) {
        geminiBlockedUntil =
          Date.now() + QUOTA_COOLDOWN_MS;

        console.warn(
          "[Gemini resilience] 429/RESOURCE_EXHAUSTED; usando fallback factual e pausando novas chamadas por 60 segundos."
        );

        return buildGroundedFallback(input);
      }

      if (isGeminiOutputValidationError(error)) {
        console.warn(
          "[Gemini resilience] resposta fora do contrato editorial; usando fallback factual validado."
        );

        return buildGroundedFallback(input);
      }

      if (!isGeminiUnavailableError(error)) {
        throw error;
      }

      const retryDelay =
        AVAILABILITY_RETRY_DELAYS_MS[attempt - 1];

      if (retryDelay !== undefined) {
        console.warn(
          `[Gemini resilience] 503/UNAVAILABLE na tentativa ${attempt}; repetindo em ${retryDelay} ms.`
        );
        await sleep(retryDelay);
        continue;
      }

      geminiBlockedUntil =
        Date.now() + AVAILABILITY_COOLDOWN_MS;

      console.warn(
        "[Gemini resilience] 503/UNAVAILABLE persistiu após retries; usando fallback factual e pausando novas chamadas por 30 segundos."
      );

      return buildGroundedFallback(input);
    }
  }

  return buildGroundedFallback(input);
}
