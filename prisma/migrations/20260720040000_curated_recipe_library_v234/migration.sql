-- Mixarr v2.3.4: additive, offline curated recipe library state.
-- Existing personal recipes and generated playlists remain unchanged.
ALTER TABLE "PlaylistRecipe"
  ADD COLUMN "sourceRecipeId" TEXT,
  ADD COLUMN "sourceRecipeVersion" INTEGER;

CREATE TABLE "BuiltInRecipePreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "lastUsedAt" TIMESTAMP(3),
  "lastUsedVersion" INTEGER,
  "useCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BuiltInRecipePreference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlaylistRecipe_userId_sourceRecipeId_idx" ON "PlaylistRecipe"("userId", "sourceRecipeId");
CREATE UNIQUE INDEX "BuiltInRecipePreference_userId_recipeId_key" ON "BuiltInRecipePreference"("userId", "recipeId");
CREATE INDEX "BuiltInRecipePreference_userId_favorite_updatedAt_idx" ON "BuiltInRecipePreference"("userId", "favorite", "updatedAt");
CREATE INDEX "BuiltInRecipePreference_userId_hidden_updatedAt_idx" ON "BuiltInRecipePreference"("userId", "hidden", "updatedAt");
CREATE INDEX "BuiltInRecipePreference_userId_lastUsedAt_idx" ON "BuiltInRecipePreference"("userId", "lastUsedAt");

ALTER TABLE "BuiltInRecipePreference"
  ADD CONSTRAINT "BuiltInRecipePreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
