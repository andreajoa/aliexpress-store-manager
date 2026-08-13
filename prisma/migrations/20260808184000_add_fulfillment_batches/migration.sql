CREATE TABLE "FulfillmentBatch" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "supplierProductId" TEXT,
  "provider" TEXT NOT NULL,
  "sourceProductId" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "currency" TEXT,
  "status" "FulfillmentStatus" NOT NULL DEFAULT 'PROCESSING',
  "externalOrderId" TEXT,
  "trackingCode" TEXT,
  "trackingUrl" TEXT,
  "carrier" TEXT,
  "orderedAt" TIMESTAMP(3),
  "shippedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FulfillmentBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OrderItem" ADD COLUMN "fulfillmentBatchId" TEXT;

CREATE INDEX "FulfillmentBatch_orderId_status_idx" ON "FulfillmentBatch"("orderId", "status");
CREATE INDEX "FulfillmentBatch_supplierProductId_idx" ON "FulfillmentBatch"("supplierProductId");
CREATE INDEX "OrderItem_fulfillmentBatchId_idx" ON "OrderItem"("fulfillmentBatchId");

ALTER TABLE "FulfillmentBatch"
  ADD CONSTRAINT "FulfillmentBatch_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FulfillmentBatch"
  ADD CONSTRAINT "FulfillmentBatch_supplierProductId_fkey"
  FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_fulfillmentBatchId_fkey"
  FOREIGN KEY ("fulfillmentBatchId") REFERENCES "FulfillmentBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
