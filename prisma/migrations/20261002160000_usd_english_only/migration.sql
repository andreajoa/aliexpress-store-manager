-- Normalize the Store Manager to the AMB commercial market: English / USD only.
-- Never reinterpret legacy BRL/EUR numeric prices as USD.
UPDATE "ProductVariant"
SET "salePrice" = NULL
WHERE "productId" IN (
  SELECT "id"
  FROM "Product"
  WHERE UPPER("storeCurrency") <> 'USD'
);

UPDATE "Product"
SET
  "recommendedPrice" = NULL,
  "compareAtPrice" = NULL,
  "storeCurrency" = 'USD'
WHERE UPPER("storeCurrency") <> 'USD';

UPDATE "Store"
SET "currency" = 'USD'
WHERE UPPER("currency") <> 'USD';

ALTER TABLE "Store"
ALTER COLUMN "currency" SET DEFAULT 'USD';

ALTER TABLE "Product"
ALTER COLUMN "storeCurrency" SET DEFAULT 'USD';

ALTER TABLE "Order"
ALTER COLUMN "currency" SET DEFAULT 'USD';
