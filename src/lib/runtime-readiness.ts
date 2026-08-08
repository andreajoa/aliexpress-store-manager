export type RuntimeCapability = {
  ready: boolean;
  missing: string[];
};

function capability(env: Record<string, string | undefined>, keys: string[]): RuntimeCapability {
  const missing = keys.filter((key) => !env[key]?.trim());
  return {
    ready: missing.length === 0,
    missing,
  };
}

export function runtimeReadiness(env: Record<string, string | undefined>) {
  const database = capability(env, ["DATABASE_URL"]);
  const adminAuth = capability(env, ["MANAGER_ADMIN_USER", "MANAGER_ADMIN_PASSWORD"]);
  const aliexpressImport = capability(env, ["OMKAR_API_KEY"]);
  const copyOptimization = capability(env, ["GEMINI_API_KEY"]);
  const editorialStudio = capability(env, [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_IMAGE_MODEL",
    "CLOUDFLARE_AUDIT_MODEL",
  ]);
  const githubPublication = capability(env, ["GITHUB_PUBLISH_TOKEN"]);
  const vercelVerification = capability(env, ["VERCEL_TOKEN"]);
  const aliexpressOpenPlatform = capability(env, [
    "ALIEXPRESS_APP_KEY",
    "ALIEXPRESS_APP_SECRET",
    "ALIEXPRESS_OAUTH_REDIRECT_URI",
    "ALIEXPRESS_TOKEN_ENCRYPTION_KEY",
  ]);

  const capabilities = {
    database,
    adminAuth,
    aliexpressImport,
    copyOptimization,
    editorialStudio,
    githubPublication,
    vercelVerification,
    aliexpressOpenPlatform,
  };

  return {
    productionCoreReady: database.ready && adminAuth.ready && aliexpressImport.ready,
    fullFeatureReady: Object.values(capabilities).every((entry) => entry.ready),
    capabilities,
    optional: {
      scrapingBee: Boolean(env.SCRAPINGBEE_API_KEY?.trim()),
      localExports: env.LOCAL_EXPORTS_ENABLED === "true",
    },
  };
}
