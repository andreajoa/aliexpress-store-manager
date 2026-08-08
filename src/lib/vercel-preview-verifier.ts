import type { VercelPreviewTarget } from "./publication-target-contract.ts";
import type { StoreProductPayload } from "./publication-contract.ts";

export type VercelDeployment = {
  id: string;
  url: string;
  state: string;
  target: string | null;
  createdAt: number;
};

export type PreviewVerificationCheck = {
  code: string;
  pass: boolean;
  detail: string;
};

export type ProductPageVerification = {
  ok: boolean;
  pageUrl: string;
  expectedProductionUrl: string;
  checks: PreviewVerificationCheck[];
};

export type PreviewVerificationResult = ProductPageVerification & {
  deployment: VercelDeployment;
  previewBaseUrl: string;
  previewProductUrl: string;
};

function deploymentId(value: Record<string, unknown>) {
  const candidate = value.id ?? value.uid;
  return typeof candidate === "string" ? candidate : "";
}

function deploymentState(value: Record<string, unknown>) {
  const candidate = value.state ?? value.readyState;
  return typeof candidate === "string" ? candidate : "";
}

export async function discoverReadyVercelPreview(input: {
  token: string;
  target: VercelPreviewTarget;
  commitSha: string;
  fetcher?: typeof fetch;
}): Promise<VercelDeployment | null> {
  const fetcher = input.fetcher || fetch;
  const url = new URL("https://api.vercel.com/v7/deployments");
  url.searchParams.set("projectId", input.target.projectId);
  url.searchParams.set("teamId", input.target.teamId);
  url.searchParams.set("sha", input.commitSha);
  url.searchParams.set("state", "READY");
  url.searchParams.set("limit", "10");

  const response = await fetcher(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/json",
      "User-Agent": "aliexpress-store-manager",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Vercel ${response.status} ao buscar Preview: ${body.slice(0, 500)}`);
  }

  const data = await response.json() as { deployments?: unknown[] };
  const deployments = Array.isArray(data.deployments) ? data.deployments : [];

  const normalized = deployments
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item) => ({
      id: deploymentId(item),
      url: typeof item.url === "string" ? item.url : "",
      state: deploymentState(item),
      target: typeof item.target === "string" ? item.target : null,
      createdAt: typeof item.createdAt === "number"
        ? item.createdAt
        : typeof item.created === "number"
          ? item.created
          : 0,
    }))
    .filter((item) => item.id && item.url && item.state === "READY" && item.target !== "production")
    .sort((a, b) => b.createdAt - a.createdAt);

  return normalized[0] || null;
}

function decodeEntity(entity: string) {
  if (entity === "amp") return "&";
  if (entity === "quot") return '"';
  if (entity === "apos" || entity === "#39" || entity === "#x27") return "'";
  if (entity === "lt") return "<";
  if (entity === "gt") return ">";
  if (entity === "nbsp") return " ";
  if (entity.startsWith("#x")) {
    const code = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`;
  }
  if (entity.startsWith("#")) {
    const code = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`;
  }
  return `&${entity};`;
}

function decodeEntities(value: string) {
  return value.replace(/&([A-Za-z0-9#]+);/g, (_match, entity: string) => decodeEntity(entity));
}

function htmlText(html: string) {
  return html
    .replace(/<!--.*?-->/gs, " ")
    .replace(/<script\b[^>]*>.*?<\/script>/gis, " ")
    .replace(/<style\b[^>]*>.*?<\/style>/gis, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([A-Za-z0-9#]+);/g, (_match, entity: string) => decodeEntity(entity))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function priceToken(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function exactMetaContent(html: string, attribute: string, key: string, expected: string) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta[^>]+${attribute}=["']${escapedKey}["'][^>]+content=["']([^"']*)["']`, "i");
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attribute}=["']${escapedKey}["']`, "i");
  const match = html.match(pattern) || html.match(reverse);
  return match ? decodeEntities(match[1]) === expected : false;
}

function canonicalMatches(html: string, expectedUrl: string) {
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  return canonical ? decodeEntities(canonical[1]) === expectedUrl : false;
}

export async function verifyStoreProductPage(input: {
  pageUrl: string;
  payload: StoreProductPayload;
  productionUrl: string;
  bypassSecret?: string | null;
  fetcher?: typeof fetch;
}): Promise<ProductPageVerification> {
  const fetcher = input.fetcher || fetch;
  const headers: Record<string, string> = {
    Accept: "text/html",
    "User-Agent": "aliexpress-store-manager-page-verifier",
  };
  if (input.bypassSecret?.trim()) {
    headers["x-vercel-protection-bypass"] = input.bypassSecret.trim();
    headers["x-vercel-set-bypass-cookie"] = "true";
  }

  const response = await fetcher(input.pageUrl, {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
    headers,
  });
  const html = await response.text();
  const text = htmlText(html);
  const product = input.payload.product;
  const checks: PreviewVerificationCheck[] = [];
  const add = (code: string, pass: boolean, detail: string) => checks.push({ code, pass, detail });

  add("HTTP_200", response.status === 200, `Página respondeu HTTP ${response.status}.`);
  add("PRODUCT_TITLE", text.includes(product.title), `Título esperado: ${product.title}`);
  add("PRODUCT_DESCRIPTION", text.includes(product.description), "Descrição comercial presente no HTML renderizado.");
  add("PRODUCT_PRICE", text.includes(priceToken(product.price)), `Preço esperado contém ${priceToken(product.price)}.`);
  if (product.variants.length === 0) {
    add("PRODUCT_STOCK", text.includes(String(product.stock)), `Estoque esperado: ${product.stock}.`);
  }

  for (const variant of product.variants) {
    add(`VARIANT_${variant.sourceSkuId}_NAME`, text.includes(variant.name), `Variante ${variant.name} presente.`);
    add(`VARIANT_${variant.sourceSkuId}_PRICE`, text.includes(priceToken(variant.price)), `Preço da variante ${variant.name}: ${priceToken(variant.price)}.`);
    add(`VARIANT_${variant.sourceSkuId}_STOCK`, text.includes(`${variant.stock} em estoque`), `Estoque da variante ${variant.name}: ${variant.stock}.`);
  }

  add("SEO_TITLE", html.includes(`<title>${product.seo.title} | BrinqueTEAndo</title>`), `Title SEO esperado: ${product.seo.title}.`);
  add("SEO_DESCRIPTION", exactMetaContent(html, "name", "description", product.seo.description), "Meta description específica do produto.");
  add("SEO_CANONICAL", canonicalMatches(html, input.productionUrl), `Canonical esperado: ${input.productionUrl}`);
  add("SEO_OPEN_GRAPH_URL", exactMetaContent(html, "property", "og:url", input.productionUrl), `Open Graph URL esperado: ${input.productionUrl}`);

  for (const asset of product.editorialAssets || []) {
    const expectedAssetPath = `/products/catalog/${product.id}/${asset.id}.png`;
    add(`EDITORIAL_${asset.id}`, html.includes(expectedAssetPath), `Asset editorial esperado: ${expectedAssetPath}`);
  }

  return {
    ok: checks.every((check) => check.pass),
    pageUrl: input.pageUrl,
    expectedProductionUrl: input.productionUrl,
    checks,
  };
}

export async function verifyVercelProductPreview(input: {
  deployment: VercelDeployment;
  payload: StoreProductPayload;
  productionUrl: string;
  bypassSecret?: string | null;
  fetcher?: typeof fetch;
}): Promise<PreviewVerificationResult> {
  const productionUrl = new URL(input.productionUrl);
  const previewBaseUrl = `https://${input.deployment.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const previewProductUrl = new URL(productionUrl.pathname + productionUrl.search, `${previewBaseUrl}/`).toString();
  const verification = await verifyStoreProductPage({
    pageUrl: previewProductUrl,
    payload: input.payload,
    productionUrl: input.productionUrl,
    bypassSecret: input.bypassSecret,
    fetcher: input.fetcher,
  });

  return {
    ...verification,
    deployment: input.deployment,
    previewBaseUrl,
    previewProductUrl,
  };
}
