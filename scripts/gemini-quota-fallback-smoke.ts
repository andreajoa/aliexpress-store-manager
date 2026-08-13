import {
  isGeminiQuotaError,
} from "../src/lib/quota-safe-product-copy.ts";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const quotaError = {
  error: {
    code: 429,
    message:
      "You exceeded your current quota. Quota exceeded for metric generativelanguage.googleapis.com/generate_content_free_tier_requests.",
    status: "RESOURCE_EXHAUSTED",
  },
};

assert(
  isGeminiQuotaError(quotaError),
  "deveria reconhecer o erro de cota 429 do Gemini"
);

assert(
  isGeminiQuotaError(
    new Error(
      "429 RESOURCE_EXHAUSTED: rate limit exceeded"
    )
  ),
  "deveria reconhecer 429 serializado em Error"
);

assert(
  !isGeminiQuotaError(
    new Error(
      "403 PERMISSION_DENIED: invalid API key"
    )
  ),
  "não deve esconder erros permanentes de autenticação"
);

console.log(
  "GEMINI QUOTA FALLBACK: PASS"
);
