ALTER TABLE "GeneratedPlaylist"
  ADD COLUMN IF NOT EXISTS "tuningPresetName" TEXT,
  ADD COLUMN IF NOT EXISTS "tuningConfigJson" JSONB;

CREATE TABLE IF NOT EXISTS "SmartMixTuningPreset" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "configJson" JSONB NOT NULL,
  "tuningVersion" TEXT NOT NULL DEFAULT '2.0.2',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartMixTuningPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SmartMixTuningPreset_userId_name_key" ON "SmartMixTuningPreset"("userId", "name");
CREATE INDEX IF NOT EXISTS "SmartMixTuningPreset_userId_updatedAt_idx" ON "SmartMixTuningPreset"("userId", "updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SmartMixTuningPreset_userId_fkey') THEN
    ALTER TABLE "SmartMixTuningPreset"
      ADD CONSTRAINT "SmartMixTuningPreset_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
