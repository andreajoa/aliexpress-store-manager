import { readFileSync } from "node:fs";
import { getOmkarProduct, isRetryableOmkarStatus } from "../src/lib/omkar.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(isRetryableOmkarStatus(500), "HTTP 500 precisa de retry");
assert(isRetryableOmkarStatus(502), "HTTP 502 precisa de retry");
assert(isRetryableOmkarStatus(503), "HTTP 503 precisa de retry");
assert(isRetryableOmkarStatus(504), "HTTP 504 precisa de retry");
assert(isRetryableOmkarStatus(429), "HTTP 429 precisa de retry");
assert(!isRetryableOmkarStatus(401), "HTTP 401 não deve ser repetido cegamente");
assert(!isRetryableOmkarStatus(404), "HTTP 404 não deve ser repetido cegamente");

const source = readFileSync("src/lib/omkar.ts", "utf8");
assert(source.includes("OMKAR_MAX_ATTEMPTS = 3"), "Omkar deve tentar até 3 vezes");
assert(source.includes("retryDelayMs"), "Omkar deve usar backoff");
assert(source.includes("temporariamente indisponível"), "erro 5xx deve ser amigável");
assert(source.includes("O produto não foi salvo"), "falha não pode persistir produto parcial");

let transientCalls = 0;
const recovered = await getOmkarProduct("1005007757686921", {
  apiKey: "test-key",
  maxAttempts: 3,
  timeoutMs: 1_000,
  retryDelayMs: () => 0,
  sleep: async () => undefined,
  fetchImpl: async () => {
    transientCalls += 1;
    if (transientCalls < 3) {
      return new Response(JSON.stringify({ message: "Server Error" }), { status: 500 });
    }
    return new Response(JSON.stringify({ id: "1005007757686921", title: "Recovered product" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});
assert(transientCalls === 3, "HTTP 500 deve ser repetido até o limite configurado");
assert(recovered.id === "1005007757686921", "produto deve ser retornado quando a terceira tentativa funciona");

let authCalls = 0;
let authBlocked = false;
try {
  await getOmkarProduct("1005007757686921", {
    apiKey: "test-key",
    maxAttempts: 3,
    retryDelayMs: () => 0,
    sleep: async () => undefined,
    fetchImpl: async () => {
      authCalls += 1;
      return new Response("unauthorized", { status: 401 });
    },
  });
} catch (error) {
  authBlocked = error instanceof Error && error.message.includes("credencial");
}
assert(authBlocked, "HTTP 401 deve informar credencial recusada");
assert(authCalls === 1, "HTTP 401 não pode ser repetido");

console.log("OMKAR RESILIENCE: PASS");
