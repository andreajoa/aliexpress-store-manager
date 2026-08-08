CREATE TYPE "SupplierRole" AS ENUM ('PRIMARY', 'BACKUP', 'ALTERNATIVE');
CREATE TYPE "SupplierMappingMethod" AS ENUM ('AUTO', 'MANUAL');

CREATE TABLE "SupplierProduct" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'ALIEXPRESS',
  "sourceProductId" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "sellerId" TEXT,
  "sellerName" TEXT,
  "role" "SupplierRole" NOT NULL DEFAULT 'ALTERNATIVE',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "sourceCurrency" TEXT,
  "costMin" DECIMAL(12,2),
  "costMax" DECIMAL(12,2),
  "rawPayload" JSONB,
  "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierVariant" (
  "id" TEXT NOT NULL,
  "supplierProductId" TEXT NOT NULL,
  "sourceSkuId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sourcePrice" DECIMAL(12,2),
  "stock" INTEGER NOT NULL DEFAULT 0,
  "attributes" JSONB,
  "imageUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierVariantMapping" (
  "id" TEXT NOT NULL,
  "supplierProductId" TEXT NOT NULL,
  "supplierVariantId" TEXT NOT NULL,
  "canonicalVariantId" TEXT NOT NULL,
  "confidence" DECIMAL(5,4),
  "method" "SupplierMappingMethod" NOT NULL DEFAULT 'MANUAL',
  "evidence" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierVariantMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierProduct_productId_provider_sourceProductId_key" ON "SupplierProduct"("productId", "provider", "sourceProductId");
CREATE INDEX "SupplierProduct_productId_role_idx" ON "SupplierProduct"("productId", "role");
CREATE INDEX "SupplierProduct_status_idx" ON "SupplierProduct"("status");
CREATE UNIQUE INDEX "SupplierProduct_one_active_primary_idx" ON "SupplierProduct"("productId") WHERE "role" = 'PRIMARY' AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX "SupplierVariant_supplierProductId_sourceSkuId_key" ON "SupplierVariant"("supplierProductId", "sourceSkuId");
CREATE INDEX "SupplierVariant_supplierProductId_stock_idx" ON "SupplierVariant"("supplierProductId", "stock");
CREATE UNIQUE INDEX "SupplierVariantMapping_supplierProductId_canonicalVariantId_key" ON "SupplierVariantMapping"("supplierProductId", "canonicalVariantId");
CREATE UNIQUE INDEX "SupplierVariantMapping_supplierProductId_supplierVariantId_key" ON "SupplierVariantMapping"("supplierProductId", "supplierVariantId");
CREATE INDEX "SupplierVariantMapping_canonicalVariantId_active_idx" ON "SupplierVariantMapping"("canonicalVariantId", "active");

ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierVariant" ADD CONSTRAINT "SupplierVariant_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierVariantMapping" ADD CONSTRAINT "SupplierVariantMapping_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierVariantMapping" ADD CONSTRAINT "SupplierVariantMapping_supplierVariantId_fkey" FOREIGN KEY ("supplierVariantId") REFERENCES "SupplierVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierVariantMapping" ADD CONSTRAINT "SupplierVariantMapping_canonicalVariantId_fkey" FOREIGN KEY ("canonicalVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing imported AliExpress product becomes the initial primary supplier.
INSERT INTO "SupplierProduct" (
  "id", "productId", "provider", "sourceProductId", "sourceUrl", "sellerId",
  "role", "priority", "status", "sourceCurrency", "costMin", "costMax",
  "rawPayload", "lastCheckedAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-' || p."id",
  p."id",
  p."sourceProvider",
  p."sourceProductId",
  p."sourceUrl",
  p."sourceSellerId",
  'PRIMARY'::"SupplierRole",
  0,
  'ACTIVE',
  p."sourceCurrency",
  p."costMin",
  p."costMax",
  p."rawPayload",
  CURRENT_TIMESTAMP,
  p."createdAt",
  CURRENT_TIMESTAMP
FROM "Product" p;

INSERT INTO "SupplierVariant" (
  "id", "supplierProductId", "sourceSkuId", "name", "sourcePrice", "stock",
  "attributes", "imageUrl", "createdAt", "updatedAt"
)
SELECT
  'legacy-' || pv."id",
  'legacy-' || pv."productId",
  pv."sourceSkuId",
  CASE
    WHEN pv."attributes" IS NULL OR pv."attributes" = '{}'::jsonb THEN 'SKU ' || pv."sourceSkuId"
    ELSE pv."attributes"::text
  END,
  pv."costPrice",
  GREATEST(COALESCE(pv."stock", 0), 0),
  pv."attributes",
  pv."imageUrl",
  pv."createdAt",
  CURRENT_TIMESTAMP
FROM "ProductVariant" pv;

INSERT INTO "SupplierVariantMapping" (
  "id", "supplierProductId", "supplierVariantId", "canonicalVariantId",
  "confidence", "method", "evidence", "active", "verifiedAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-map-' || pv."id",
  'legacy-' || pv."productId",
  'legacy-' || pv."id",
  pv."id",
  1.0000,
  'AUTO'::"SupplierMappingMethod",
  jsonb_build_object('source', 'legacy-primary-backfill', 'basis', 'original imported SKU'),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "ProductVariant" pv;
