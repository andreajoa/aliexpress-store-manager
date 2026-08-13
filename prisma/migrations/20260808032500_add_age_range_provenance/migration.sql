ALTER TABLE "Publication"
ADD COLUMN "targetAgeSource" TEXT,
ADD COLUMN "targetAgeEvidence" TEXT,
ADD COLUMN "targetAgeVerifiedAt" TIMESTAMP(3);
