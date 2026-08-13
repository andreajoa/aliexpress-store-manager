import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
  ],
  outputFileTracingIncludes: {
    "/api/import/aliexpress": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/health/aliexpress-provider": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/products/**": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/cron/maintenance": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
