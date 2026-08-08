ALTER TABLE "SupplierVariant"
  ADD COLUMN "orderSkuAttr" TEXT;

ALTER TABLE "FulfillmentBatch"
  ADD COLUMN "logisticsServiceName" TEXT,
  ADD COLUMN "placementStatus" TEXT,
  ADD COLUMN "placementAttemptId" TEXT,
  ADD COLUMN "placementStartedAt" TIMESTAMP(3),
  ADD COLUMN "placementLastError" TEXT;

CREATE TABLE "AliExpressConnection" (
  "id" TEXT NOT NULL DEFAULT 'primary',
  "accessTokenCiphertext" TEXT NOT NULL,
  "accessTokenIv" TEXT NOT NULL,
  "accessTokenTag" TEXT NOT NULL,
  "userId" TEXT,
  "userNick" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AliExpressConnection_pkey" PRIMARY KEY ("id")
);
