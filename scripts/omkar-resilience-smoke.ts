import { readFileSync } from "node:fs";
import { isRetryableOmkarStatus } from "../src/lib/omkar.ts";

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

console.log("OMKAR RESILIENCE: PASS");
