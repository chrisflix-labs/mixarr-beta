-- CreateTable
CREATE TABLE "JobHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "trigger" TEXT NOT NULL DEFAULT 'unknown',
    "summary" TEXT,
    "attempted" INTEGER,
    "processed" INTEGER,
    "skipped" INTEGER,
    "failed" INTEGER,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobHistory_userId_startedAt_idx" ON "JobHistory"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "JobHistory_status_startedAt_idx" ON "JobHistory"("status", "startedAt");

-- CreateIndex
CREATE INDEX "JobHistory_type_startedAt_idx" ON "JobHistory"("type", "startedAt");

-- AddForeignKey
ALTER TABLE "JobHistory" ADD CONSTRAINT "JobHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
