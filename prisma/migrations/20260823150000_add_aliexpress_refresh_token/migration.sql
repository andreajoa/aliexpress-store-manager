-- AlterTable
ALTER TABLE "AliExpressConnection" ADD COLUMN "refreshTokenCiphertext" TEXT,
ADD COLUMN "refreshTokenIv" TEXT,
ADD COLUMN "refreshTokenTag" TEXT,
ADD COLUMN "refreshExpiresAt" TIMESTAMP(3);
