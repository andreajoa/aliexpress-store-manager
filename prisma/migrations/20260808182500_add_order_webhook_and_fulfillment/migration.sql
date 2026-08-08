ALTER TABLE "Store"
  ADD COLUMN "webhookTokenHash" TEXT,
  ADD COLUMN "webhookTokenCreatedAt" TIMESTAMP(3),
  ADD COLUMN "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "webhookLastSeenAt" TIMESTAMP(3);

ALTER TABLE "OrderItem"
  ADD COLUMN "fulfillmentSupplierProductId" TEXT,
  ADD COLUMN "fulfillmentSupplierVariantId" TEXT,
  ADD COLUMN "fulfillmentProvider" TEXT,
  ADD COLUMN "fulfillmentSourceProductId" TEXT,
  ADD COLUMN "fulfillmentSourceSkuId" TEXT,
  ADD COLUMN "fulfillmentSourceUrl" TEXT,
  ADD COLUMN "fulfillmentUnitCost" DECIMAL(12,2),
  ADD COLUMN "fulfillmentCurrency" TEXT,
  ADD COLUMN "fulfillmentSelectionMethod" TEXT,
  ADD COLUMN "fulfillmentSelectionEvidence" JSONB,
  ADD COLUMN "supplierSelectedAt" TIMESTAMP(3),
  ADD COLUMN "fulfillmentPreparedAt" TIMESTAMP(3);

CREATE INDEX "OrderItem_fulfillmentSupplierProductId_idx" ON "OrderItem"("fulfillmentSupplierProductId");
CREATE INDEX "OrderItem_fulfillmentSupplierVariantId_idx" ON "OrderItem"("fulfillmentSupplierVariantId");

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_fulfillmentSupplierProductId_fkey"
  FOREIGN KEY ("fulfillmentSupplierProductId") REFERENCES "SupplierProduct"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_fulfillmentSupplierVariantId_fkey"
  FOREIGN KEY ("fulfillmentSupplierVariantId") REFERENCES "SupplierVariant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
