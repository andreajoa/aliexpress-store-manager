import { readFileSync } from "node:fs";

import {
  convertMoney,
  storeCurrencyForCopyLanguage,
} from "../src/lib/copy-market.ts";
import { buildZipArchive } from "../src/lib/zip-archive.ts";

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  storeCurrencyForCopyLanguage("pt-BR") === "BRL",
  "pt-BR deve usar BRL"
);
assert(
  storeCurrencyForCopyLanguage("en") === "USD",
  "English deve usar USD"
);
assert(
  storeCurrencyForCopyLanguage("fr") === "EUR",
  "Français deve usar EUR"
);
assert(
  storeCurrencyForCopyLanguage("de") === "EUR",
  "Deutsch deve usar EUR"
);
assert(
  convertMoney(100, 0.2) === 20,
  "conversão monetária deve alterar o valor, não apenas o símbolo"
);

const zip = buildZipArchive([
  {
    name: "loja/produto.csv",
    data: "sku,price\nabc,9.99",
  },
  {
    name: "loja/produto.json",
    data: '{"ok":true}',
  },
], {
  now: new Date("2026-08-09T12:00:00Z"),
});

assert(
  zip.readUInt32LE(0) === 0x04034b50,
  "ZIP precisa começar com local file header"
);
assert(
  zip.includes(Buffer.from("loja/produto.csv")),
  "ZIP deve conter produto.csv"
);
assert(
  zip.includes(Buffer.from("loja/produto.json")),
  "ZIP deve conter produto.json"
);
assert(
  zip.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])),
  "ZIP deve conter end-of-central-directory"
);

const productExportRoute = readFileSync(
  "src/app/api/exports/product/route.ts",
  "utf8"
);
const storeExportRoute = readFileSync(
  "src/app/api/exports/store/route.ts",
  "utf8"
);
const editRoute = readFileSync(
  "src/app/api/products/[id]/edit/route.ts",
  "utf8"
);
const optimizeRoute = readFileSync(
  "src/app/api/products/[id]/optimize/route.ts",
  "utf8"
);
const pricingContextRoute = readFileSync(
  "src/app/api/products/[id]/pricing-context/route.ts",
  "utf8"
);
const productEditor = readFileSync(
  "src/app/products/[id]/product-editor.tsx",
  "utf8"
);
const exportCenter = readFileSync(
  "src/app/products/[id]/export-center.tsx",
  "utf8"
);

for (const source of [
  productExportRoute,
  storeExportRoute,
]) {
  assert(
    !source.includes("LOCAL_EXPORTS_ENABLED"),
    "exportação web não pode depender de LOCAL_EXPORTS_ENABLED"
  );
  assert(
    !source.includes("somente no Manager local"),
    "exportação web não pode manter bloqueio local-only"
  );
}

assert(
  !editRoute.includes('storeCurrency: "BRL"'),
  "salvar edição não pode forçar BRL"
);
assert(
  optimizeRoute.includes(
    "storeCurrencyForCopyLanguage"
  ) &&
    optimizeRoute.includes("fetchFxRate") &&
    optimizeRoute.includes("targetCurrency"),
  "otimização deve mapear idioma para moeda e converter preços"
);
assert(
  pricingContextRoute.includes("storeCurrency") &&
    productEditor.includes("pricing-context") &&
    productEditor.includes("Venda {storeCurrency}"),
  "editor deve carregar e exibir a moeda real do produto"
);
assert(
  !productEditor.includes("Venda BRL"),
  "editor não pode exibir venda fixamente em BRL"
);
assert(
  exportCenter.includes("response.blob()"),
  "Export Center deve baixar resposta binária no navegador"
);
assert(
  exportCenter.includes("Download iniciado"),
  "Export Center deve confirmar o download web"
);

console.log(
  "WEB EXPORT + MARKET CURRENCY: PASS"
);
