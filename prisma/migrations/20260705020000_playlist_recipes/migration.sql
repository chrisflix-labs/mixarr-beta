-- CreateTable
CREATE TABLE "PlaylistRecipe" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filtersJson" JSONB NOT NULL,
    "createdFromVersion" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaylistRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaylistRecipe_userId_updatedAt_idx" ON "PlaylistRecipe"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "PlaylistRecipe_userId_lastUsedAt_idx" ON "PlaylistRecipe"("userId", "lastUsedAt");

-- AddForeignKey
ALTER TABLE "PlaylistRecipe" ADD CONSTRAINT "PlaylistRecipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
