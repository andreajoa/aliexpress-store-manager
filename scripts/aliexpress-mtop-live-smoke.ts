import { getAliExpressMtopProduct } from "../src/lib/aliexpress-mtop.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const productId = process.env.ALIEXPRESS_MTOP_TEST_PRODUCT_ID || "3256811750293175";
const product = await getAliExpressMtopProduct(productId);

assert(product.id === productId, `Product ID divergente: ${product.id}`);
assert(typeof product.title === "string" && product.title.length > 3, "Título ausente");
assert((product.images || []).length > 0, "Imagens ausentes");
assert((product.sku_pricing || []).length > 0, "Nenhum SKU retornado");

for (const sku of product.sku_pricing || []) {
  assert(Boolean(sku.sku_id), "SKU sem ID");
  assert(typeof sku.sale_price === "number" && Number.isFinite(sku.sale_price), `SKU ${sku.sku_id} sem preço`);
  assert(
    typeof sku.available_quantity === "number" && Number.isFinite(sku.available_quantity) && sku.available_quantity >= 0,
    `SKU ${sku.sku_id} sem estoque verificável`,
  );
}

console.log(JSON.stringify({
  ok: true,
  provider: product.operational_provider,
  productId: product.id,
  title: product.title,
  images: product.images?.length || 0,
  variants: product.variants?.length || 0,
  skus: product.sku_pricing?.length || 0,
  stock: (product.sku_pricing || []).reduce((sum, sku) => sum + (sku.available_quantity || 0), 0),
}, null, 2));
