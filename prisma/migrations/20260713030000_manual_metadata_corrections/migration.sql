-- Mixarr v2.0.8 stores trusted user corrections separately from provider data.
CREATE TABLE "TrackMetadataCorrection" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "previousEffectiveValueJson" JSONB,
    "reason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    CONSTRAINT "TrackMetadataCorrection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackMetadataVerification" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedBy" TEXT,
    "note" TEXT,
    CONSTRAINT "TrackMetadataVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackMetadataSourceOverride" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ignored" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrackMetadataSourceOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackMetadataCorrectionHistory" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValueJson" JSONB,
    "newValueJson" JSONB,
    "source" TEXT,
    "reason" TEXT,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    CONSTRAINT "TrackMetadataCorrectionHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrackMetadataCorrection_trackId_idx" ON "TrackMetadataCorrection"("trackId");
CREATE INDEX "TrackMetadataCorrection_trackId_field_isActive_idx" ON "TrackMetadataCorrection"("trackId", "field", "isActive");
CREATE UNIQUE INDEX "TrackMetadataCorrection_one_active_field_idx" ON "TrackMetadataCorrection"("trackId", "field") WHERE "isActive" = true;
CREATE UNIQUE INDEX "TrackMetadataVerification_trackId_field_source_key" ON "TrackMetadataVerification"("trackId", "field", "source");
CREATE INDEX "TrackMetadataVerification_trackId_idx" ON "TrackMetadataVerification"("trackId");
CREATE UNIQUE INDEX "TrackMetadataSourceOverride_trackId_field_source_key" ON "TrackMetadataSourceOverride"("trackId", "field", "source");
CREATE INDEX "TrackMetadataSourceOverride_trackId_idx" ON "TrackMetadataSourceOverride"("trackId");
CREATE INDEX "TrackMetadataCorrectionHistory_trackId_createdAt_idx" ON "TrackMetadataCorrectionHistory"("trackId", "createdAt");
CREATE INDEX "TrackMetadataCorrectionHistory_batchId_idx" ON "TrackMetadataCorrectionHistory"("batchId");

ALTER TABLE "TrackMetadataCorrection" ADD CONSTRAINT "TrackMetadataCorrection_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackMetadataCorrection" ADD CONSTRAINT "TrackMetadataCorrection_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrackMetadataVerification" ADD CONSTRAINT "TrackMetadataVerification_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackMetadataVerification" ADD CONSTRAINT "TrackMetadataVerification_verifiedBy_fkey" FOREIGN KEY ("verifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrackMetadataSourceOverride" ADD CONSTRAINT "TrackMetadataSourceOverride_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackMetadataCorrectionHistory" ADD CONSTRAINT "TrackMetadataCorrectionHistory_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackMetadataCorrectionHistory" ADD CONSTRAINT "TrackMetadataCorrectionHistory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SmartMixTuningPreset" ALTER COLUMN "tuningVersion" SET DEFAULT '2.0.8';
ALTER TABLE "PlaylistRegeneration" ALTER COLUMN "engineVersion" SET DEFAULT 'v2.0.8';
