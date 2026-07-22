-- Mixarr v2.4.7: provider-neutral, reproducible recommendation explanations.
-- Additive only; existing recipes and historical Smart Mix traces remain valid.

ALTER TABLE "SmartMixDecisionTrace" ADD COLUMN "albumName" TEXT;

CREATE TABLE "RecommendationExplanation" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "recipeId" TEXT, "recipeVersion" INTEGER,
  "generatedPlaylistId" TEXT, "generationRecordId" TEXT, "aiRequestId" TEXT, "aiProposalId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'RECIPE_COPILOT', "originalRequest" TEXT, "originalRequestHash" TEXT,
  "originalRequestCreatedAt" TIMESTAMP(3), "requestSource" TEXT NOT NULL DEFAULT 'RECIPE_COPILOT',
  "structuredInterpretationJson" JSONB NOT NULL, "generatedConfigurationJson" JSONB NOT NULL,
  "generatedSettingsJson" JSONB NOT NULL DEFAULT '[]', "validationResultsJson" JSONB NOT NULL DEFAULT '[]',
  "uncertaintyWarningsJson" JSONB NOT NULL DEFAULT '[]', "semanticDiffJson" JSONB NOT NULL DEFAULT '[]',
  "overallConfidence" DOUBLE PRECISION, "overallConfidenceCategory" TEXT NOT NULL DEFAULT 'unknown',
  "explanationSchemaVersion" TEXT NOT NULL DEFAULT '1.0', "recipeSchemaVersion" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL, "modelProvider" TEXT, "modelIdentifier" TEXT, "privacyMode" TEXT,
  "aiCallRequired" BOOLEAN NOT NULL DEFAULT true, "interpretationCost" DECIMAL(18,6),
  "deterministicRenderCost" DECIMAL(18,6) NOT NULL DEFAULT 0, "interpretationHash" TEXT NOT NULL,
  "configurationHash" TEXT NOT NULL, "reproducibilityStatus" TEXT NOT NULL,
  "reproducibilityReason" TEXT NOT NULL, "reproducibilitySnapshotJson" JSONB NOT NULL,
  "metadataSnapshotPolicy" TEXT NOT NULL DEFAULT 'reference-or-snapshot', "randomSeed" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecommendationExplanation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExplanationAssumption" (
  "id" TEXT NOT NULL, "explanationId" TEXT NOT NULL, "sourceText" TEXT, "description" TEXT NOT NULL,
  "fieldPath" TEXT, "inferredValueJson" JSONB, "confidence" DOUBLE PRECISION,
  "confidenceCategory" TEXT NOT NULL DEFAULT 'unknown', "responsibility" TEXT NOT NULL DEFAULT 'ai_interpretation',
  "effect" TEXT NOT NULL DEFAULT 'score', "status" TEXT NOT NULL DEFAULT 'pending', "userOverrideValueJson" JSONB,
  "relatedRuleIdsJson" JSONB NOT NULL DEFAULT '[]', "alternativeValuesJson" JSONB NOT NULL DEFAULT '[]',
  "acceptedAt" TIMESTAMP(3), "rejectedAt" TIMESTAMP(3), "modifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExplanationAssumption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExplanationAlternative" (
  "id" TEXT NOT NULL, "explanationId" TEXT NOT NULL, "label" TEXT NOT NULL,
  "structuredInterpretationJson" JSONB NOT NULL, "generatedConfigurationJson" JSONB,
  "confidence" DOUBLE PRECISION, "confidenceCategory" TEXT NOT NULL DEFAULT 'unknown',
  "differenceSummaryJson" JSONB NOT NULL DEFAULT '[]', "expectedRuleImpactJson" JSONB NOT NULL DEFAULT '[]',
  "appliedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExplanationAlternative_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecommendationRuleTrace" (
  "id" TEXT NOT NULL, "explanationId" TEXT NOT NULL, "nodeType" TEXT NOT NULL,
  "nodeIdentifier" TEXT NOT NULL, "sourceNodeId" TEXT, "targetRuleId" TEXT, "fieldPath" TEXT,
  "inputValueJson" JSONB, "outputValueJson" JSONB, "responsibility" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION, "assumptionsJson" JSONB NOT NULL DEFAULT '[]',
  "validationStatus" TEXT NOT NULL DEFAULT 'not_evaluated', "parentNodeIdsJson" JSONB NOT NULL DEFAULT '[]',
  "childNodeIdsJson" JSONB NOT NULL DEFAULT '[]', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecommendationRuleTrace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecommendationTrackEvaluation" (
  "id" TEXT NOT NULL, "explanationId" TEXT NOT NULL, "generationId" TEXT, "trackId" TEXT,
  "trackTitle" TEXT, "artistName" TEXT, "albumName" TEXT, "selected" BOOLEAN NOT NULL DEFAULT false,
  "rank" INTEGER, "ruleId" TEXT NOT NULL, "ruleType" TEXT NOT NULL, "result" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL, "inputSnapshotJson" JSONB NOT NULL, "scoreDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "scoreBefore" DOUBLE PRECISION, "scoreAfter" DOUBLE PRECISION, "exclusion" BOOLEAN NOT NULL DEFAULT false,
  "responsibility" TEXT NOT NULL DEFAULT 'deterministic_engine', "metadataQuality" DOUBLE PRECISION,
  "evaluatedAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecommendationTrackEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExplanationApprovalNote" (
  "id" TEXT NOT NULL, "explanationId" TEXT NOT NULL, "approverUserId" TEXT NOT NULL,
  "decision" TEXT NOT NULL, "note" TEXT NOT NULL, "relatedFieldPath" TEXT, "relatedRuleId" TEXT,
  "recipeVersion" INTEGER, "explanationVersion" TEXT NOT NULL, "generationRunId" TEXT,
  "requestedChangeJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExplanationApprovalNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecommendationExplanationAudit" (
  "id" TEXT NOT NULL, "explanationId" TEXT NOT NULL, "actorId" TEXT, "eventType" TEXT NOT NULL,
  "detailsJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecommendationExplanationAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecommendationExplanation_generationRecordId_key" ON "RecommendationExplanation"("generationRecordId");
CREATE UNIQUE INDEX "RecommendationExplanation_aiRequestId_key" ON "RecommendationExplanation"("aiRequestId");
CREATE UNIQUE INDEX "RecommendationExplanation_aiProposalId_key" ON "RecommendationExplanation"("aiProposalId");
CREATE INDEX "RecommendationExplanation_ownerId_createdAt_idx" ON "RecommendationExplanation"("ownerId", "createdAt");
CREATE INDEX "RecommendationExplanation_recipeId_recipeVersion_createdAt_idx" ON "RecommendationExplanation"("recipeId", "recipeVersion", "createdAt");
CREATE INDEX "RecommendationExplanation_generatedPlaylistId_createdAt_idx" ON "RecommendationExplanation"("generatedPlaylistId", "createdAt");
CREATE INDEX "RecommendationExplanation_reproducibilityStatus_updatedAt_idx" ON "RecommendationExplanation"("reproducibilityStatus", "updatedAt");
CREATE INDEX "ExplanationAssumption_explanationId_status_createdAt_idx" ON "ExplanationAssumption"("explanationId", "status", "createdAt");
CREATE INDEX "ExplanationAssumption_fieldPath_idx" ON "ExplanationAssumption"("fieldPath");
CREATE INDEX "ExplanationAlternative_explanationId_confidence_createdAt_idx" ON "ExplanationAlternative"("explanationId", "confidence", "createdAt");
CREATE INDEX "RecommendationRuleTrace_explanationId_nodeType_nodeIdentifier_idx" ON "RecommendationRuleTrace"("explanationId", "nodeType", "nodeIdentifier");
CREATE INDEX "RecommendationRuleTrace_explanationId_targetRuleId_idx" ON "RecommendationRuleTrace"("explanationId", "targetRuleId");
CREATE INDEX "RecommendationRuleTrace_fieldPath_idx" ON "RecommendationRuleTrace"("fieldPath");
CREATE INDEX "RecommendationTrackEvaluation_explanationId_selected_rank_idx" ON "RecommendationTrackEvaluation"("explanationId", "selected", "rank");
CREATE INDEX "RecommendationTrackEvaluation_explanationId_trackId_evaluatedAt_idx" ON "RecommendationTrackEvaluation"("explanationId", "trackId", "evaluatedAt");
CREATE INDEX "RecommendationTrackEvaluation_explanationId_ruleId_result_idx" ON "RecommendationTrackEvaluation"("explanationId", "ruleId", "result");
CREATE INDEX "RecommendationTrackEvaluation_explanationId_reasonCode_idx" ON "RecommendationTrackEvaluation"("explanationId", "reasonCode");
CREATE INDEX "RecommendationTrackEvaluation_generationId_trackId_idx" ON "RecommendationTrackEvaluation"("generationId", "trackId");
CREATE INDEX "RecommendationTrackEvaluation_expiresAt_idx" ON "RecommendationTrackEvaluation"("expiresAt");
CREATE INDEX "ExplanationApprovalNote_explanationId_createdAt_idx" ON "ExplanationApprovalNote"("explanationId", "createdAt");
CREATE INDEX "ExplanationApprovalNote_approverUserId_createdAt_idx" ON "ExplanationApprovalNote"("approverUserId", "createdAt");
CREATE INDEX "RecommendationExplanationAudit_explanationId_createdAt_idx" ON "RecommendationExplanationAudit"("explanationId", "createdAt");
CREATE INDEX "RecommendationExplanationAudit_actorId_createdAt_idx" ON "RecommendationExplanationAudit"("actorId", "createdAt");
CREATE INDEX "RecommendationExplanationAudit_eventType_createdAt_idx" ON "RecommendationExplanationAudit"("eventType", "createdAt");

ALTER TABLE "RecommendationExplanation" ADD CONSTRAINT "RecommendationExplanation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationExplanation" ADD CONSTRAINT "RecommendationExplanation_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "PlaylistRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecommendationExplanation" ADD CONSTRAINT "RecommendationExplanation_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecommendationExplanation" ADD CONSTRAINT "RecommendationExplanation_generationRecordId_fkey" FOREIGN KEY ("generationRecordId") REFERENCES "SmartMixExplanationGeneration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecommendationExplanation" ADD CONSTRAINT "RecommendationExplanation_aiRequestId_fkey" FOREIGN KEY ("aiRequestId") REFERENCES "AiRecipeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecommendationExplanation" ADD CONSTRAINT "RecommendationExplanation_aiProposalId_fkey" FOREIGN KEY ("aiProposalId") REFERENCES "AiRecipeProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExplanationAssumption" ADD CONSTRAINT "ExplanationAssumption_explanationId_fkey" FOREIGN KEY ("explanationId") REFERENCES "RecommendationExplanation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExplanationAlternative" ADD CONSTRAINT "ExplanationAlternative_explanationId_fkey" FOREIGN KEY ("explanationId") REFERENCES "RecommendationExplanation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationRuleTrace" ADD CONSTRAINT "RecommendationRuleTrace_explanationId_fkey" FOREIGN KEY ("explanationId") REFERENCES "RecommendationExplanation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationTrackEvaluation" ADD CONSTRAINT "RecommendationTrackEvaluation_explanationId_fkey" FOREIGN KEY ("explanationId") REFERENCES "RecommendationExplanation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExplanationApprovalNote" ADD CONSTRAINT "ExplanationApprovalNote_explanationId_fkey" FOREIGN KEY ("explanationId") REFERENCES "RecommendationExplanation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExplanationApprovalNote" ADD CONSTRAINT "ExplanationApprovalNote_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecommendationExplanationAudit" ADD CONSTRAINT "RecommendationExplanationAudit_explanationId_fkey" FOREIGN KEY ("explanationId") REFERENCES "RecommendationExplanation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationExplanationAudit" ADD CONSTRAINT "RecommendationExplanationAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
