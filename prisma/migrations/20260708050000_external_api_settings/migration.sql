CREATE TABLE "ProviderSetting" (
  "providerKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "usesPopularity" BOOLEAN NOT NULL DEFAULT false,
  "usesTags" BOOLEAN NOT NULL DEFAULT false,
  "usesBpm" BOOLEAN NOT NULL DEFAULT false,
  "usesAudioFeatures" BOOLEAN NOT NULL DEFAULT false,
  "encryptedCredentials" TEXT,
  "lastTestStatus" TEXT,
  "lastTestMessage" TEXT,
  "lastTestAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProviderSetting_pkey" PRIMARY KEY ("providerKey")
);

CREATE INDEX "ProviderSetting_enabled_idx" ON "ProviderSetting"("enabled");
CREATE INDEX "ProviderSetting_usesPopularity_idx" ON "ProviderSetting"("usesPopularity");
CREATE INDEX "ProviderSetting_usesTags_idx" ON "ProviderSetting"("usesTags");
CREATE INDEX "ProviderSetting_usesBpm_idx" ON "ProviderSetting"("usesBpm");
CREATE INDEX "ProviderSetting_usesAudioFeatures_idx" ON "ProviderSetting"("usesAudioFeatures");
