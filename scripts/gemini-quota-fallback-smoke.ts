import {
  isGeminiQuotaError,
  isGeminiUnavailableError,
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

const unavailableError = {
  error: {
    code: 503,
    message:
      "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
    status: "UNAVAILABLE",
  },
};

assert(
  isGeminiUnavailableError(unavailableError),
  "deveria reconhecer exatamente o erro 503/UNAVAILABLE de alta demanda recebido em produção"
);

assert(
  isGeminiUnavailableError(
    new Error(
      "503 UNAVAILABLE: This model is currently experiencing high demand. Please try again later."
    )
  ),
  "deveria reconhecer 503/UNAVAILABLE serializado em Error"
);

const authError = new Error(
  "403 PERMISSION_DENIED: invalid API key"
);

assert(
  !isGeminiQuotaError(authError),
  "não deve classificar erro permanente de autenticação como quota"
);

assert(
  !isGeminiUnavailableError(authError),
  "não deve esconder erro permanente de autenticação como indisponibilidade transitória"
);

console.log(
  "GEMINI TRANSIENT FALLBACK: PASS"
);
