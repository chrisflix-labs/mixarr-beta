-- Mixarr v2.3.6 household collaboration is opt-in. This migration only adds
-- new tables, indexes, and nullable relationships; existing playlists remain individual.
CREATE TABLE "Household" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "avatar" TEXT, "status" TEXT NOT NULL DEFAULT 'ACTIVE', "defaultBalanceMode" TEXT NOT NULL DEFAULT 'BALANCED_HOUSEHOLD',
  "defaultFamilyRule" TEXT NOT NULL DEFAULT 'STRICTEST_PROFILE', "defaultMaximumInfluence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "archivedAt" TIMESTAMP(3),
  CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HouseholdMember" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "userId" TEXT NOT NULL, "displayName" TEXT NOT NULL,
  "memberType" TEXT NOT NULL DEFAULT 'MEMBER', "influenceWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "temporarilyExcluded" BOOLEAN NOT NULL DEFAULT false, "exclusionExpiresAt" TIMESTAMP(3),
  "votingEligible" BOOLEAN NOT NULL DEFAULT true, "approvalEligible" BOOLEAN NOT NULL DEFAULT true,
  "familyFriendlyRestriction" TEXT NOT NULL DEFAULT 'INHERIT', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HouseholdGuest" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "displayName" TEXT NOT NULL, "isReusable" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "expiresAt" TIMESTAMP(3), "influenceWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "votingEligible" BOOLEAN NOT NULL DEFAULT true, "approvalEligible" BOOLEAN NOT NULL DEFAULT false,
  "explicitContentRestriction" TEXT NOT NULL DEFAULT 'INHERIT', "preferencesJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HouseholdGuest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HouseholdPreference" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "actorUserId" TEXT, "actorGuestId" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'HOUSEHOLD', "playlistId" TEXT, "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL,
  "state" TEXT NOT NULL, "strength" DOUBLE PRECISION NOT NULL DEFAULT 1, "isHardRule" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HouseholdPreference_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HouseholdPlaylistConfiguration" (
  "id" TEXT NOT NULL, "generatedPlaylistId" TEXT NOT NULL, "householdId" TEXT NOT NULL,
  "balanceMode" TEXT NOT NULL DEFAULT 'BALANCED_HOUSEHOLD', "primaryMemberId" TEXT,
  "sharedFavoritesWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.15, "maximumIndividualInfluence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "maximumTracksPerMemberPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.5, "maximumConsecutiveMemberTracks" INTEGER NOT NULL DEFAULT 3,
  "requireEveryParticipant" BOOLEAN NOT NULL DEFAULT true, "redistributeUnusedInfluence" BOOLEAN NOT NULL DEFAULT true,
  "administratorOverride" BOOLEAN NOT NULL DEFAULT false, "familyRule" TEXT NOT NULL DEFAULT 'STRICTEST_PROFILE',
  "unknownRatingRule" TEXT NOT NULL DEFAULT 'BLOCK', "preferCleanVersions" BOOLEAN NOT NULL DEFAULT true,
  "partyModeEnabled" BOOLEAN NOT NULL DEFAULT false, "partySettingsJson" JSONB, "votingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "liveFeedbackEnabled" BOOLEAN NOT NULL DEFAULT false, "approvalMode" TEXT NOT NULL DEFAULT 'DISABLED',
  "fixedApprovalCount" INTEGER, "approvalConflictSeverity" INTEGER, "publicationStatus" TEXT NOT NULL DEFAULT 'PUBLISHED',
  "fairnessSettingsJson" JSONB, "generationSnapshotJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "HouseholdPlaylistConfiguration_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlaylistParticipant" (
  "id" TEXT NOT NULL, "configurationId" TEXT NOT NULL, "householdMemberId" TEXT, "householdGuestId" TEXT,
  "configuredInfluence" DOUBLE PRECISION NOT NULL DEFAULT 1, "effectiveInfluence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "capReduction" DOUBLE PRECISION NOT NULL DEFAULT 0, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "temporarilyExcluded" BOOLEAN NOT NULL DEFAULT false, "exclusionExpiresAt" TIMESTAMP(3),
  "excludeFromApprovals" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PlaylistParticipant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlaylistVote" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "generatedPlaylistId" TEXT NOT NULL, "playlistVersion" INTEGER NOT NULL DEFAULT 1,
  "targetType" TEXT NOT NULL DEFAULT 'PLAYLIST', "targetId" TEXT NOT NULL DEFAULT 'PLAYLIST', "voterKey" TEXT NOT NULL,
  "userId" TEXT, "householdMemberId" TEXT, "householdGuestId" TEXT, "voteType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistVote_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlaylistApproval" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "generatedPlaylistId" TEXT NOT NULL, "playlistVersion" INTEGER NOT NULL DEFAULT 1,
  "approverKey" TEXT NOT NULL, "userId" TEXT, "householdMemberId" TEXT, "householdGuestId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'APPROVED', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaylistApproval_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PreferenceConflict" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "generatedPlaylistId" TEXT, "generationId" TEXT,
  "category" TEXT NOT NULL, "severity" INTEGER NOT NULL, "participantsJson" JSONB NOT NULL,
  "conflictingValuesJson" JSONB NOT NULL, "resolutionMethod" TEXT NOT NULL, "resolvedValueJson" JSONB,
  "affectedSelection" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PreferenceConflict_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlaylistContribution" (
  "id" TEXT NOT NULL, "generatedPlaylistId" TEXT NOT NULL, "playlistVersion" INTEGER NOT NULL DEFAULT 1,
  "trackId" TEXT, "householdMemberId" TEXT, "householdGuestId" TEXT, "contributionType" TEXT NOT NULL,
  "contributionWeight" DOUBLE PRECISION NOT NULL, "primaryContributor" BOOLEAN NOT NULL DEFAULT false,
  "compatibilityScore" DOUBLE PRECISION, "selectionReason" TEXT NOT NULL, "conflictStatus" TEXT,
  "approvalStatus" TEXT, "metadataJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaylistContribution_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HouseholdActivity" (
  "id" TEXT NOT NULL, "householdId" TEXT NOT NULL, "generatedPlaylistId" TEXT, "playlistVersion" INTEGER,
  "actorUserId" TEXT, "eventType" TEXT NOT NULL, "summary" TEXT NOT NULL, "beforeJson" JSONB,
  "afterJson" JSONB, "metadataJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HouseholdActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Household_ownerId_name_key" ON "Household"("ownerId", "name");
CREATE INDEX "Household_ownerId_status_updatedAt_idx" ON "Household"("ownerId", "status", "updatedAt");
CREATE UNIQUE INDEX "HouseholdMember_householdId_userId_key" ON "HouseholdMember"("householdId", "userId");
CREATE INDEX "HouseholdMember_householdId_isActive_temporarilyExcluded_idx" ON "HouseholdMember"("householdId", "isActive", "temporarilyExcluded");
CREATE INDEX "HouseholdMember_userId_updatedAt_idx" ON "HouseholdMember"("userId", "updatedAt");
CREATE INDEX "HouseholdGuest_householdId_isActive_expiresAt_idx" ON "HouseholdGuest"("householdId", "isActive", "expiresAt");
CREATE UNIQUE INDEX "HouseholdPreference_householdId_scope_playlistId_targetType_targetId_actorUserId_actorGuestId_key" ON "HouseholdPreference"("householdId", "scope", "playlistId", "targetType", "targetId", "actorUserId", "actorGuestId");
CREATE INDEX "HouseholdPreference_householdId_targetType_targetId_state_idx" ON "HouseholdPreference"("householdId", "targetType", "targetId", "state");
CREATE INDEX "HouseholdPreference_playlistId_updatedAt_idx" ON "HouseholdPreference"("playlistId", "updatedAt");
CREATE UNIQUE INDEX "HouseholdPlaylistConfiguration_generatedPlaylistId_key" ON "HouseholdPlaylistConfiguration"("generatedPlaylistId");
CREATE INDEX "HouseholdPlaylistConfiguration_householdId_updatedAt_idx" ON "HouseholdPlaylistConfiguration"("householdId", "updatedAt");
CREATE INDEX "HouseholdPlaylistConfiguration_publicationStatus_updatedAt_idx" ON "HouseholdPlaylistConfiguration"("publicationStatus", "updatedAt");
CREATE UNIQUE INDEX "PlaylistParticipant_configurationId_householdMemberId_key" ON "PlaylistParticipant"("configurationId", "householdMemberId");
CREATE UNIQUE INDEX "PlaylistParticipant_configurationId_householdGuestId_key" ON "PlaylistParticipant"("configurationId", "householdGuestId");
CREATE INDEX "PlaylistParticipant_configurationId_isActive_temporarilyExcluded_idx" ON "PlaylistParticipant"("configurationId", "isActive", "temporarilyExcluded");
CREATE UNIQUE INDEX "PlaylistVote_generatedPlaylistId_playlistVersion_targetType_targetId_voterKey_key" ON "PlaylistVote"("generatedPlaylistId", "playlistVersion", "targetType", "targetId", "voterKey");
CREATE INDEX "PlaylistVote_householdId_generatedPlaylistId_updatedAt_idx" ON "PlaylistVote"("householdId", "generatedPlaylistId", "updatedAt");
CREATE INDEX "PlaylistVote_generatedPlaylistId_playlistVersion_voteType_idx" ON "PlaylistVote"("generatedPlaylistId", "playlistVersion", "voteType");
CREATE UNIQUE INDEX "PlaylistApproval_generatedPlaylistId_playlistVersion_approverKey_key" ON "PlaylistApproval"("generatedPlaylistId", "playlistVersion", "approverKey");
CREATE INDEX "PlaylistApproval_generatedPlaylistId_playlistVersion_status_idx" ON "PlaylistApproval"("generatedPlaylistId", "playlistVersion", "status");
CREATE INDEX "PreferenceConflict_householdId_createdAt_idx" ON "PreferenceConflict"("householdId", "createdAt");
CREATE INDEX "PreferenceConflict_generatedPlaylistId_severity_idx" ON "PreferenceConflict"("generatedPlaylistId", "severity");
CREATE INDEX "PreferenceConflict_generationId_idx" ON "PreferenceConflict"("generationId");
CREATE INDEX "PlaylistContribution_generatedPlaylistId_playlistVersion_trackId_idx" ON "PlaylistContribution"("generatedPlaylistId", "playlistVersion", "trackId");
CREATE INDEX "PlaylistContribution_householdMemberId_createdAt_idx" ON "PlaylistContribution"("householdMemberId", "createdAt");
CREATE INDEX "PlaylistContribution_householdGuestId_createdAt_idx" ON "PlaylistContribution"("householdGuestId", "createdAt");
CREATE INDEX "HouseholdActivity_householdId_createdAt_idx" ON "HouseholdActivity"("householdId", "createdAt");
CREATE INDEX "HouseholdActivity_generatedPlaylistId_createdAt_idx" ON "HouseholdActivity"("generatedPlaylistId", "createdAt");
CREATE INDEX "HouseholdActivity_actorUserId_createdAt_idx" ON "HouseholdActivity"("actorUserId", "createdAt");
CREATE INDEX "HouseholdActivity_eventType_createdAt_idx" ON "HouseholdActivity"("eventType", "createdAt");

ALTER TABLE "Household" ADD CONSTRAINT "Household_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseholdGuest" ADD CONSTRAINT "HouseholdGuest_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseholdPreference" ADD CONSTRAINT "HouseholdPreference_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseholdPreference" ADD CONSTRAINT "HouseholdPreference_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HouseholdPreference" ADD CONSTRAINT "HouseholdPreference_actorGuestId_fkey" FOREIGN KEY ("actorGuestId") REFERENCES "HouseholdGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HouseholdPlaylistConfiguration" ADD CONSTRAINT "HouseholdPlaylistConfiguration_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HouseholdPlaylistConfiguration" ADD CONSTRAINT "HouseholdPlaylistConfiguration_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaylistParticipant" ADD CONSTRAINT "PlaylistParticipant_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "HouseholdPlaylistConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistParticipant" ADD CONSTRAINT "PlaylistParticipant_householdMemberId_fkey" FOREIGN KEY ("householdMemberId") REFERENCES "HouseholdMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaylistParticipant" ADD CONSTRAINT "PlaylistParticipant_householdGuestId_fkey" FOREIGN KEY ("householdGuestId") REFERENCES "HouseholdGuest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaylistVote" ADD CONSTRAINT "PlaylistVote_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistVote" ADD CONSTRAINT "PlaylistVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistVote" ADD CONSTRAINT "PlaylistVote_householdMemberId_fkey" FOREIGN KEY ("householdMemberId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistVote" ADD CONSTRAINT "PlaylistVote_householdGuestId_fkey" FOREIGN KEY ("householdGuestId") REFERENCES "HouseholdGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistApproval" ADD CONSTRAINT "PlaylistApproval_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistApproval" ADD CONSTRAINT "PlaylistApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistApproval" ADD CONSTRAINT "PlaylistApproval_householdMemberId_fkey" FOREIGN KEY ("householdMemberId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistApproval" ADD CONSTRAINT "PlaylistApproval_householdGuestId_fkey" FOREIGN KEY ("householdGuestId") REFERENCES "HouseholdGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PreferenceConflict" ADD CONSTRAINT "PreferenceConflict_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistContribution" ADD CONSTRAINT "PlaylistContribution_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaylistContribution" ADD CONSTRAINT "PlaylistContribution_householdMemberId_fkey" FOREIGN KEY ("householdMemberId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlaylistContribution" ADD CONSTRAINT "PlaylistContribution_householdGuestId_fkey" FOREIGN KEY ("householdGuestId") REFERENCES "HouseholdGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HouseholdActivity" ADD CONSTRAINT "HouseholdActivity_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseholdActivity" ADD CONSTRAINT "HouseholdActivity_generatedPlaylistId_fkey" FOREIGN KEY ("generatedPlaylistId") REFERENCES "GeneratedPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HouseholdActivity" ADD CONSTRAINT "HouseholdActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
