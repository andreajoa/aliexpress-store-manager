import { runtimeReadiness } from "../src/lib/runtime-readiness.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("=== EMPTY ENV ===");
const empty = runtimeReadiness({});
assert(!empty.productionCoreReady, "Empty environment cannot be production-core ready");
assert(!empty.fullFeatureReady, "Empty environment cannot be full-feature ready");
assert(empty.capabilities.adminAuth.missing.includes("MANAGER_ADMIN_PASSWORD"), "Missing admin password not surfaced");
assert(empty.capabilities.aliexpressOpenPlatform.missing.includes("ALIEXPRESS_APP_KEY"), "Missing AliExpress app key not surfaced");
assert(empty.capabilities.maintenanceScheduler.missing.includes("CRON_SECRET"), "Missing cron secret not surfaced");
console.log("✅ missing configuration is explicit without values");

console.log("=== CORE READY ===");
const core = runtimeReadiness({
  DATABASE_URL: "configured",
  MANAGER_ADMIN_USER: "configured",
  MANAGER_ADMIN_PASSWORD: "configured",
  OMKAR_API_KEY: "configured",
});
assert(core.productionCoreReady, "Core should be ready with DB/admin/Omkar");
assert(!core.fullFeatureReady, "Full feature should remain false without publication/editorial/AliExpress/scheduler secrets");
console.log("✅ core readiness is independent from optional/full-feature integrations");

console.log("=== FULL READY ===");
const full = runtimeReadiness({
  DATABASE_URL: "configured",
  MANAGER_ADMIN_USER: "configured",
  MANAGER_ADMIN_PASSWORD: "configured",
  OMKAR_API_KEY: "configured",
  GEMINI_API_KEY: "configured",
  CLOUDFLARE_ACCOUNT_ID: "configured",
  CLOUDFLARE_API_TOKEN: "configured",
  CLOUDFLARE_IMAGE_MODEL: "configured",
  CLOUDFLARE_AUDIT_MODEL: "configured",
  GITHUB_PUBLISH_TOKEN: "configured",
  VERCEL_TOKEN: "configured",
  ALIEXPRESS_APP_KEY: "configured",
  ALIEXPRESS_APP_SECRET: "configured",
  ALIEXPRESS_OAUTH_REDIRECT_URI: "configured",
  ALIEXPRESS_TOKEN_ENCRYPTION_KEY: "configured",
  CRON_SECRET: "configured",
});
assert(full.productionCoreReady && full.fullFeatureReady, "Complete environment should be ready");
console.log("✅ full-feature readiness is deterministic");

console.log("====================================================");
console.log("RUNTIME READINESS: PASS");
console.log("====================================================");
