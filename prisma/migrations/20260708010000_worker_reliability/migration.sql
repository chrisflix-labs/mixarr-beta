-- Background worker reliability metadata.

ALTER TABLE "JobHistory"
  ADD COLUMN "workerId" TEXT,
  ADD COLUMN "lockKey" TEXT,
  ADD COLUMN "currentItemLabel" TEXT,
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "lastProgressAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "progress" JSONB,
  ADD COLUMN "recoveryHint" TEXT;

CREATE INDEX "JobHistory_workerId_status_idx" ON "JobHistory"("workerId", "status");
CREATE INDEX "JobHistory_lockKey_status_idx" ON "JobHistory"("lockKey", "status");
CREATE INDEX "JobHistory_lastHeartbeatAt_idx" ON "JobHistory"("lastHeartbeatAt");
CREATE INDEX "JobHistory_leaseExpiresAt_idx" ON "JobHistory"("leaseExpiresAt");

CREATE TABLE "WorkerHeartbeat" (
  "workerId" TEXT NOT NULL,
  "hostname" TEXT,
  "processId" INTEGER,
  "appVersion" TEXT,
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "currentJobId" TEXT,
  "currentJobType" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

CREATE INDEX "WorkerHeartbeat_lastHeartbeatAt_idx" ON "WorkerHeartbeat"("lastHeartbeatAt");
CREATE INDEX "WorkerHeartbeat_status_idx" ON "WorkerHeartbeat"("status");
