import { decryptSecret, encryptSecret } from "../src/lib/aliexpress-token-crypto.ts";
import { buildAliExpressAuthorizeUrl, tokenExpiryFromResponse } from "../src/lib/aliexpress-connection.ts";
import { officialSkusFromProductResponse } from "../src/lib/aliexpress-sku-sync.ts";
import { AliExpressTopClient, signTopParameters } from "../src/lib/aliexpress-top-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("=== TOP SIGNATURE ===");
const signature = signTopParameters({
  method: "aliexpress.ds.product.get",
  app_key: "test-key",
  session: "test-session",
  timestamp: "2026-08-08 12:34:56",
  format: "json",
  v: "2.0",
  sign_method: "hmac",
  product_id: "12345",
  ship_to_country: "US",
}, "test-secret");
assert(signature === "9E2EDF9AF526630A3EF4C98CC8B3F0A5", "TOP HMAC-MD5 vector changed");
console.log("✅ deterministic HMAC-MD5 vector");

console.log("=== TOKEN ENCRYPTION ===");
const cryptoEnv = { ALIEXPRESS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
const encrypted = encryptSecret("access-token-do-not-leak", cryptoEnv);
assert(encrypted.ciphertext !== "access-token-do-not-leak", "Token persisted as plaintext");
assert(decryptSecret(encrypted, cryptoEnv) === "access-token-do-not-leak", "Encrypted token cannot round-trip");
console.log("✅ AES-256-GCM round trip, no plaintext storage");

console.log("=== OAUTH URL / EXPIRY ===");
const oauthEnv = {
  ALIEXPRESS_APP_KEY: "123",
  ALIEXPRESS_APP_SECRET: "secret",
  ALIEXPRESS_OAUTH_REDIRECT_URI: "https://manager.example/api/aliexpress/oauth/callback",
};
const authorize = new URL(buildAliExpressAuthorizeUrl({ state: "state-123", env: oauthEnv }));
assert(authorize.hostname === "oauth.aliexpress.com", "Unexpected OAuth host");
assert(authorize.searchParams.get("response_type") === "code", "OAuth server flow must request code");
assert(authorize.searchParams.get("state") === "state-123", "OAuth state missing");
const expires = tokenExpiryFromResponse({ expire_time: 2_000_000_000_000 }, 1_900_000_000_000);
assert(expires.getTime() === 2_000_000_000_000, "Millisecond expire_time not preserved");
console.log("✅ OAuth state + millisecond expiry");

console.log("=== OFFICIAL SKU PARSER ===");
const parsed = officialSkusFromProductResponse({
  result: {
    ae_item_base_info_dto: { product_id: 32982857990, product_status_type: "onSelling", currency_code: "USD" },
    ae_item_sku_info_dtos: {
      ae_item_sku_info_d_t_o: [{
        id: "14:193;200007763:201336100",
        sku_code: "merchant-code",
        sku_available_stock: 12,
        offer_sale_price: "3.30",
        ae_sku_property_dtos: {
          ae_sku_property_d_t_o: [
            { sku_property_name: "Color", sku_property_value: "Purple" },
            { sku_property_name: "Pieces", sku_property_value: "8pcs" },
          ],
        },
      }],
    },
  },
});
assert(parsed.productId === "32982857990", "Product ID parser failed");
assert(parsed.skus.length === 1, "Official SKU parser lost SKU");
assert(parsed.skus[0].orderSkuAttr === "14:193;200007763:201336100", "orderSkuAttr must come from official SKU id");
assert(parsed.skus[0].stock === 12 && parsed.skus[0].price === 3.3, "Official stock/price parser failed");
console.log("✅ official order sku_attr comes from AliExpress response");

console.log("=== PLACE ORDER FAIL-CLOSED ===");
const client = new AliExpressTopClient({ appKey: "x", appSecret: "y", endpoint: "https://example.invalid" });
let blocked = false;
try {
  await client.placeOrder({
    session: "session",
    logisticsAddress: { country: "US" },
    productItems: [{ productId: "1", quantity: 1, skuAttr: "", logisticsServiceName: "CAINIAO_STANDARD" }],
  });
} catch (error) {
  blocked = error instanceof Error && error.message.includes("sku_attr");
}
assert(blocked, "Place order did not fail closed without official sku_attr");
console.log("✅ no supplier order without official sku_attr");

console.log("=== API ENVELOPE / ERROR ===");
const goodFetch = async () => new Response(JSON.stringify({
  aliexpress_trade_buy_placeorder_response: {
    result: { is_success: true, order_list: { number: ["10001"] } },
  },
}), { status: 200, headers: { "Content-Type": "application/json" } });
const placed = await client.placeOrder({
  session: "session",
  logisticsAddress: { country: "US" },
  productItems: [{ productId: "1", quantity: 1, skuAttr: "14:193", logisticsServiceName: "CAINIAO_STANDARD" }],
}, goodFetch as typeof fetch);
assert(placed.orderIds[0] === "10001", "Place-order normalization failed");

let apiBlocked = false;
const badFetch = async () => new Response(JSON.stringify({ error_response: { code: 50, sub_msg: "invalid" } }), { status: 200 });
try {
  await client.execute("aliexpress.ds.product.get", "session", {}, badFetch as typeof fetch);
} catch (error) {
  apiBlocked = error instanceof Error && error.message.includes("invalid");
}
assert(apiBlocked, "error_response was not surfaced");
console.log("✅ success and error envelopes normalized");

console.log("====================================================");
console.log("ALIEXPRESS OPEN PLATFORM: PASS");
console.log("====================================================");
