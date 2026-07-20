-- Mixarr v2.3.9: indexes for Recipe Studio lists, analytics, usage, and audit-adjacent job queries.
-- This migration is additive and does not alter recipe documents or playlist associations.
CREATE INDEX "PlaylistRecipe_userId_isArchived_deletedAt_updatedAt_idx"
  ON "PlaylistRecipe"("userId", "isArchived", "deletedAt", "updatedAt");

CREATE INDEX "PlaylistRecipe_userId_recipeSource_updatedAt_idx"
  ON "PlaylistRecipe"("userId", "recipeSource", "updatedAt");

CREATE INDEX "GeneratedPlaylist_userId_recipeId_updatedAt_idx"
  ON "GeneratedPlaylist"("userId", "recipeId", "updatedAt");

CREATE INDEX "JobHistory_userId_type_status_startedAt_idx"
  ON "JobHistory"("userId", "type", "status", "startedAt");
