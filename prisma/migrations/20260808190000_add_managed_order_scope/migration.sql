ALTER TABLE "Order"
  ADD COLUMN "sourceOrderScope" TEXT NOT NULL DEFAULT 'FULL_ORDER',
  ADD COLUMN "sourceOrderTotal" DECIMAL(12,2);

UPDATE "Order"
SET "sourceOrderTotal" = "total"
WHERE "sourceOrderTotal" IS NULL;
