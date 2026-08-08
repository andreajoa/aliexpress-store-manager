CREATE TABLE "EditorialBinary" (
  "storageKey" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EditorialBinary_pkey" PRIMARY KEY ("storageKey")
);

CREATE INDEX "EditorialBinary_sha256_idx" ON "EditorialBinary"("sha256");
