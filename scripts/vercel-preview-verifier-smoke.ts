import {
  discoverReadyVercelPreview,
  verifyVercelProductPreview,
} from "../src/lib/vercel-preview-verifier.ts";
import type { StoreProductPayload } from "../src/lib/publication-contract.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const payload: StoreProductPayload = {
  protocolVersion: "2026-08-01",
  product: {
    id: "ae-fixture-001",
    sourceProductId: "fixture-001",
    title: "Produto Fixture",
    slug: "produto-fixture",
    headline: "Fixture",
    description: "Descrição comercial fixture.",
    benefits: ["Teste"],
    cta: "Comprar",
    price: 4990,
    compareAtPrice: 6990,
    currency: "BRL",
    image: "https://example.test/source.jpg",
    gallery: ["https://example.test/source.jpg"],
    editorialAssets: [{ id: "editorial-fixture", type: "AI_LIFESTYLE" }],
    category: "Sensorial",
    ageRange: "8 anos ou mais",
    stock: 15,
    variants: [
      {
        sourceSkuId: "sku-black",
        name: "Black 4pcs",
        price: 4990,
        stock: 10,
        attributes: { Cor: "Black" },
        imageUrl: null,
      },
      {
        sourceSkuId: "sku-purple",
        name: "Purple 8pcs",
        price: 8990,
        stock: 5,
        attributes: { Cor: "Purple" },
        imageUrl: null,
      },
    ],
    shipping: { weightGrams: 200, lengthCm: 17, widthCm: 14, heightCm: 4 },
    seo: {
      title: "Produto Fixture SEO",
      description: "Descrição SEO fixture.",
    },
    source: {
      provider: "ALIEXPRESS",
      productId: "fixture-001",
      url: "https://example.test/source",
    },
  },
};

console.log("=== DISCOVERY POR SHA ===");
const discoveryFetch: typeof fetch = async () => new Response(JSON.stringify({
  deployments: [
    {
      id: "dpl_prod",
      url: "prod.vercel.app",
      state: "READY",
      target: "production",
      createdAt: 20,
    },
    {
      id: "dpl_preview",
      url: "preview.vercel.app",
      state: "READY",
      target: null,
      createdAt: 10,
    },
  ],
}), { status: 200, headers: { "content-type": "application/json" } });

const deployment = await discoverReadyVercelPreview({
  token: "fixture-token",
  target: {
    provider: "vercel",
    projectId: "prj_Fixture123",
    teamId: "team_Fixture456",
  },
  commitSha: "abc123",
  fetcher: discoveryFetch,
});
assert(deployment?.id === "dpl_preview", "deveria selecionar Preview READY e excluir production");
console.log("✅ Preview READY selecionado por commit");

console.log("=== VERIFICACAO DA PAGINA ===");
const productionUrl = "https://store.example/produto/ae-fixture-001";
const html = `<!doctype html><html><head><title>Produto Fixture SEO | BrinqueTEAndo</title><meta name="description" content="Descrição SEO fixture."><link rel="canonical" href="${productionUrl}"><meta property="og:url" content="${productionUrl}"></head><body><h1>Produto Fixture</h1><p>Descrição comercial fixture.</p><p>R$ 49,90</p><button>Black 4pcs</button><span>R$ 49,90 · 10 em estoque</span><button>Purple 8pcs</button><span>R$ 89,90 · 5 em estoque</span><img src="/products/catalog/ae-fixture-001/editorial-fixture.png"></body></html>`;
const pageFetch: typeof fetch = async () => new Response(html, {
  status: 200,
  headers: { "content-type": "text/html" },
});
const verified = await verifyVercelProductPreview({
  deployment: deployment!,
  payload,
  productionUrl,
  fetcher: pageFetch,
});
assert(verified.ok, JSON.stringify(verified.checks.filter((item) => !item.pass)));
assert(verified.previewProductUrl === "https://preview.vercel.app/produto/ae-fixture-001", "preview product URL incorreta");
console.log("✅ Produto, variantes, preços, estoques, assets e SEO verificados");

console.log("=== FAIL CLOSED ===");
const brokenFetch: typeof fetch = async () => new Response("<html><body>produto errado</body></html>", { status: 200 });
const broken = await verifyVercelProductPreview({
  deployment: deployment!,
  payload,
  productionUrl,
  fetcher: brokenFetch,
});
assert(!broken.ok, "Preview incompleto deveria reprovar");
assert(broken.checks.some((item) => item.code === "PRODUCT_TITLE" && !item.pass), "falha de título ausente");
console.log("✅ Preview divergente bloqueado");

console.log("====================================================");
console.log("VERCEL PREVIEW VERIFIER: PASS");
console.log("====================================================");
