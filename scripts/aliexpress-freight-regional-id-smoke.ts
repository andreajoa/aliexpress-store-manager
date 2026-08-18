import { regionalProductIdFromEnvelope } from "../src/lib/aliexpress-top-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("=== ALIEXPRESS FREIGHT REGIONAL PRODUCT ID ===");

const realShape = {
  result: {
    product_id_converter_result: {
      main_product_id: 1005012190285521,
      sub_product_id: "{\"US\":3256812003970769}",
    },
  },
};

assert(
  regionalProductIdFromEnvelope(realShape, "US") === "3256812003970769",
  "US regional product ID was not extracted from the real stringified map shape",
);
console.log("✅ stringified US sub_product_id parsed");

const objectShape = {
  result: {
    product_id_converter_result: {
      main_product_id: "1005000000000000",
      sub_product_id: {
        GB: "3256800000000000",
      },
    },
  },
};

assert(
  regionalProductIdFromEnvelope(objectShape, "UK") === "3256800000000000",
  "UK/GB alias was not resolved",
);
console.log("✅ object map and UK/GB alias parsed");

assert(
  regionalProductIdFromEnvelope(realShape, "CA") === null,
  "Missing regional market should return null",
);
console.log("✅ missing market safely falls back");

console.log("ALIEXPRESS FREIGHT REGIONAL PRODUCT ID: PASS");
