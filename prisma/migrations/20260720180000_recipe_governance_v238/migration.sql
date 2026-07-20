-- Mixarr v2.3.8: additive recipe safety, compatibility, and governance state.
-- Existing recipes remain local and enabled, but are revalidated by the application.
ALTER TABLE "PlaylistRecipe"
  ADD COLUMN "governanceSchemaVersion" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "recipeSource" TEXT NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN "originalPayloadJson" JSONB,
  ADD COLUMN "normalizedPayloadJson" JSONB,
  ADD COLUMN "trustState" TEXT NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN "approvalState" TEXT NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "quarantineState" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "quarantineReason" TEXT,
  ADD COLUMN "signatureStatus" TEXT NOT NULL DEFAULT 'MISSING',
  ADD COLUMN "signatureAlgorithm" TEXT,
  ADD COLUMN "signatureKeyId" TEXT,
  ADD COLUMN "signerIdentity" TEXT,
  ADD COLUMN "signatureSignedAt" TIMESTAMP(3),
  ADD COLUMN "requestedPermissionsJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "grantedPermissionsJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "restrictedPermissionsJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "compatibilityStatus" TEXT NOT NULL DEFAULT 'COMPATIBLE',
  ADD COLUMN "compatibilityJson" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
  ADD COLUMN "riskScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "riskFindingsJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "dependencyStatusJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "migrationHistoryJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "revokedLocallyAt" TIMESTAMP(3),
  ADD COLUMN "lastValidatedAt" TIMESTAMP(3);

CREATE TABLE "RecipeSigningKey" (
  "id" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "identity" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL DEFAULT 'ed25519',
  "publicKey" TEXT NOT NULL,
  "official" BOOLEAN NOT NULL DEFAULT false,
  "trusted" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipeSigningKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeSafetyPolicy" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "limitsJson" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeSafetyPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeAuditEvent" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT,
  "recipeVersion" INTEGER,
  "eventType" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "sourceIp" TEXT,
  "previousStateJson" JSONB,
  "newStateJson" JSONB,
  "validationJson" JSONB,
  "riskJson" JSONB,
  "permissionsJson" JSONB,
  "trustState" TEXT,
  "riskLevel" TEXT,
  "result" TEXT NOT NULL DEFAULT 'SUCCESS',
  "correlationId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecipeImportSnapshot" (
  "id" TEXT NOT NULL,
  "recipeId" TEXT,
  "userId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "resourceVersions" JSONB NOT NULL DEFAULT '{}',
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "restoredAt" TIMESTAMP(3),
  "restoredById" TEXT,
  "restoreResultJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeImportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecipeSigningKey_keyId_key" ON "RecipeSigningKey"("keyId");
CREATE INDEX "RecipeSigningKey_official_trusted_revokedAt_idx" ON "RecipeSigningKey"("official", "trusted", "revokedAt");
CREATE INDEX "RecipeSigningKey_expiresAt_idx" ON "RecipeSigningKey"("expiresAt");
CREATE UNIQUE INDEX "RecipeSafetyPolicy_userId_key" ON "RecipeSafetyPolicy"("userId");
CREATE INDEX "PlaylistRecipe_userId_trustState_updatedAt_idx" ON "PlaylistRecipe"("userId", "trustState", "updatedAt");
CREATE INDEX "PlaylistRecipe_userId_approvalState_updatedAt_idx" ON "PlaylistRecipe"("userId", "approvalState", "updatedAt");
CREATE INDEX "PlaylistRecipe_userId_quarantineState_updatedAt_idx" ON "PlaylistRecipe"("userId", "quarantineState", "updatedAt");
CREATE INDEX "PlaylistRecipe_signatureKeyId_idx" ON "PlaylistRecipe"("signatureKeyId");
CREATE INDEX "PlaylistRecipe_riskLevel_updatedAt_idx" ON "PlaylistRecipe"("riskLevel", "updatedAt");
CREATE INDEX "RecipeAuditEvent_recipeId_createdAt_idx" ON "RecipeAuditEvent"("recipeId", "createdAt");
CREATE INDEX "RecipeAuditEvent_eventType_createdAt_idx" ON "RecipeAuditEvent"("eventType", "createdAt");
CREATE INDEX "RecipeAuditEvent_actorId_createdAt_idx" ON "RecipeAuditEvent"("actorId", "createdAt");
CREATE INDEX "RecipeAuditEvent_trustState_createdAt_idx" ON "RecipeAuditEvent"("trustState", "createdAt");
CREATE INDEX "RecipeAuditEvent_riskLevel_createdAt_idx" ON "RecipeAuditEvent"("riskLevel", "createdAt");
CREATE INDEX "RecipeAuditEvent_correlationId_idx" ON "RecipeAuditEvent"("correlationId");
CREATE INDEX "RecipeImportSnapshot_recipeId_createdAt_idx" ON "RecipeImportSnapshot"("recipeId", "createdAt");
CREATE INDEX "RecipeImportSnapshot_userId_status_createdAt_idx" ON "RecipeImportSnapshot"("userId", "status", "createdAt");
CREATE INDEX "RecipeImportSnapshot_correlationId_idx" ON "RecipeImportSnapshot"("correlationId");

ALTER TABLE "PlaylistRecipe" ADD CONSTRAINT "PlaylistRecipe_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecipeSigningKey" ADD CONSTRAINT "RecipeSigningKey_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecipeSafetyPolicy" ADD CONSTRAINT "RecipeSafetyPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeAuditEvent" ADD CONSTRAINT "RecipeAuditEvent_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecipeAuditEvent" ADD CONSTRAINT "RecipeAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecipeImportSnapshot" ADD CONSTRAINT "RecipeImportSnapshot_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecipeImportSnapshot" ADD CONSTRAINT "RecipeImportSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
