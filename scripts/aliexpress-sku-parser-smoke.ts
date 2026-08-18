import { officialSkusFromProductResponse } from "../src/lib/aliexpress-sku-parser.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("=== ALIEXPRESS SKU PARSER ===");

const simplified = officialSkusFromProductResponse({
  result: {
    ae_item_base_info_dto: {
      product_id: "3256802810470585",
      product_status_type: "onSelling",
      currency_code: "USD",
    },
    ae_item_sku_info_dtos: [
      {
        id: "14:193;200007763:201336100",
        sku_attr: "14:193;200007763:201336100",
        sku_id: "12000021996543210",
        sku_available_stock: 12,
        offer_sale_price: "3.30",
        sku_price: "4.00",
        ae_sku_property_dtos: [
          { sku_property_id: "14", sku_property_name: "Color", sku_property_value: "Purple" },
          { sku_property_id: "200007763", sku_property_name: "Pieces", sku_property_value: "8pcs" },
        ],
      },
    ],
  },
});

assert(simplified.skus.length === 1, "Simplified SKU array was not parsed");
assert(simplified.skus[0].orderSkuAttr === "14:193;200007763:201336100", "sku_attr was not preserved for ordering");
assert(simplified.skus[0].sourceSkuId === "12000021996543210", "sku_id was not preserved as supplier SKU ID");
assert(simplified.skus[0].stock === 12, "Simplified available stock was not parsed");
assert(simplified.skus[0].price === 3.3, "Simplified sale price was not parsed");
assert((simplified.skus[0].attributes as Record<string, string>).Color === "Purple", "Simplified SKU properties were not parsed");
console.log("✅ simplified response array parsed");

const wrapped = officialSkusFromProductResponse({
  result: {
    ae_item_base_info_dto: {
      product_id: "32982857990",
      product_status_type: "onSelling",
      currency_code: "USD",
    },
    ae_item_sku_info_dtos: {
      ae_item_sku_info_d_t_o: [
        {
          id: "14:70221",
          sku_code: "merchant-code",
          ipm_sku_stock: 7,
          sku_price: "9.50",
          ae_sku_property_dtos: {
            ae_sku_property_d_t_o: [
              { sku_property_id: "14", sku_property_name: "Color", sku_property_value: "Blue" },
            ],
          },
        },
      ],
    },
  },
});

assert(wrapped.skus.length === 1, "Wrapped SKU response regressed");
assert(wrapped.skus[0].orderSkuAttr === "14:70221", "Legacy id fallback for sku_attr regressed");
assert(wrapped.skus[0].sourceSkuId === "merchant-code", "Legacy sku_code fallback regressed");
assert(wrapped.skus[0].stock === 7 && wrapped.skus[0].price === 9.5, "Wrapped price/stock parsing regressed");
console.log("✅ wrapped response remains supported");

console.log("ALIEXPRESS SKU PARSER: PASS");
