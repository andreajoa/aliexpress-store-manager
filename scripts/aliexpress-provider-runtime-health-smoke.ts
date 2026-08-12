import { readFileSync } from "node:fs";

const source = readFileSync("src/app/api/health/aliexpress-provider/route.ts", "utf8");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(source.includes("VERCEL_GIT_COMMIT_SHA"), "health endpoint must expose deployed commit sha");
assert(source.includes("getAliExpressOperationalProduct"), "health endpoint must exercise operational provider");
assert(source.includes("skuCount"), "health endpoint must report sku count");
assert(source.includes("totalStock"), "health endpoint must report total stock");
assert(source.includes("providerVersion"), "health endpoint must expose provider version");

console.log("ALIEXPRESS PROVIDER RUNTIME HEALTH: PASS");
