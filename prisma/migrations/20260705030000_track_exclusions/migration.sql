-- CreateTable
CREATE TABLE "TrackExclusion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackExclusion_trackId_key" ON "TrackExclusion"("trackId");

-- CreateIndex
CREATE INDEX "TrackExclusion_userId_createdAt_idx" ON "TrackExclusion"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TrackExclusion" ADD CONSTRAINT "TrackExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackExclusion" ADD CONSTRAINT "TrackExclusion_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
