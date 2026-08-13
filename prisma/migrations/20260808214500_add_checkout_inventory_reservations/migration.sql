ALTER TABLE "Order"
  ADD COLUMN "checkoutReservationId" TEXT;

CREATE TABLE "InventoryReservation" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "externalReservationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "stripeCheckoutSessionId" TEXT,
  "consumedOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryReservationItem" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "canonicalVariantId" TEXT NOT NULL,
  "supplierProductId" TEXT NOT NULL,
  "supplierVariantId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "sourceCurrency" TEXT,
  "sourceUnitCost" DECIMAL(12,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryReservationItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryReservationItem_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "InventoryReservation_storeId_externalReservationId_key" ON "InventoryReservation"("storeId", "externalReservationId");
CREATE INDEX "InventoryReservation_status_expiresAt_idx" ON "InventoryReservation"("status", "expiresAt");
CREATE INDEX "InventoryReservation_consumedOrderId_idx" ON "InventoryReservation"("consumedOrderId");
CREATE UNIQUE INDEX "InventoryReservationItem_reservationId_canonicalVariantId_key" ON "InventoryReservationItem"("reservationId", "canonicalVariantId");
CREATE INDEX "InventoryReservationItem_supplierVariantId_idx" ON "InventoryReservationItem"("supplierVariantId");
CREATE INDEX "InventoryReservationItem_productId_idx" ON "InventoryReservationItem"("productId");

ALTER TABLE "InventoryReservation"
  ADD CONSTRAINT "InventoryReservation_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryReservationItem"
  ADD CONSTRAINT "InventoryReservationItem_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryReservationItem"
  ADD CONSTRAINT "InventoryReservationItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryReservationItem"
  ADD CONSTRAINT "InventoryReservationItem_canonicalVariantId_fkey"
  FOREIGN KEY ("canonicalVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryReservationItem"
  ADD CONSTRAINT "InventoryReservationItem_supplierProductId_fkey"
  FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryReservationItem"
  ADD CONSTRAINT "InventoryReservationItem_supplierVariantId_fkey"
  FOREIGN KEY ("supplierVariantId") REFERENCES "SupplierVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
