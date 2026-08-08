ALTER TABLE "EditorialAsset"
  ADD COLUMN "content" BYTEA,
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "contentSha256" TEXT,
  ADD COLUMN "contentBytes" INTEGER;

CREATE INDEX "EditorialAsset_contentSha256_idx" ON "EditorialAsset"("contentSha256");
