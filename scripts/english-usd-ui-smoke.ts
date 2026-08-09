import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const page = readFileSync("src/app/products/[id]/page.tsx", "utf8");
const editor = readFileSync("src/app/products/[id]/product-editor.tsx", "utf8");
const optimizeButton = readFileSync("src/app/products/[id]/optimize-button.tsx", "utf8");
const optimizeRoute = readFileSync("src/app/api/products/[id]/optimize/route.ts", "utf8");
const copyMarket = readFileSync("src/lib/copy-market.ts", "utf8");

assert(copyMarket.includes('case "en"') || copyMarket.includes('language === "en"'), "English deve mapear para USD");
assert(copyMarket.includes('"USD"'), "Mapeamento de English precisa usar USD");
assert(optimizeRoute.includes("storeCurrencyForCopyLanguage"), "Rota de otimização deve derivar moeda do idioma");
assert(page.includes("storeCurrency={product.storeCurrency}"), "Editor deve receber moeda do produto diretamente do servidor");
assert(page.includes("initialLanguage={copyLanguageFromVersion(product.aiCopyVersion)}"), "Seletor deve refletir o idioma atual da copy");
assert(editor.includes("storeCurrency: string;"), "Editor deve receber storeCurrency como prop");
assert(editor.includes("props.storeCurrency.toUpperCase()"), "Editor deve usar a moeda recebida do servidor");
assert(!editor.includes("useState(\"BRL\")"), "Editor não pode iniciar fixamente em BRL");
assert(!editor.includes("/pricing-context"), "Editor não deve depender de segunda chamada para descobrir moeda");
assert(optimizeButton.includes("initialLanguage"), "Seletor deve receber idioma atual");

console.log("ENGLISH -> USD UI: PASS");
