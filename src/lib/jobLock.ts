import { getWorkerIdentity, markJobLeaseHeartbeat } from "./workerHealth";
import { logDebug } from "./logging";

export const GLOBAL_SYNC_JOB_KEY = "global:sync";

export type ActiveJob = {
  id: string;
  name: string;
  source: string;
  keys: string[];
  lockKey: string;
  workerId: string;
  jobHistoryId?: string;
  jobHistoryType?: string;
  startedAt: string;
  lastHeartbeatAt: string;
  leaseExpiresAt: string;
  phase?: string;
};

type JobLockState = {
  activeByKey: Record<string, ActiveJob>;
  lastSkipped?: {
    name: string;
    source: string;
    skippedAt: string;
    activeJob: ActiveJob;
  };
};

const globalJobLocks = globalThis as typeof globalThis & {
  mixarrJobLocks?: JobLockState;
};

const jobLocks = globalJobLocks.mixarrJobLocks ?? { activeByKey: {} };
globalJobLocks.mixarrJobLocks = jobLocks;

function heartbeatEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function jobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function uniqueJobs() {
  const seen = new Set<string>();
  return Object.values(jobLocks.activeByKey).filter((job) => {
    if (seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
}

export function getJobConflict(keys: string[]) {
  for (const key of keys) {
    const job = jobLocks.activeByKey[key];
    if (job) return job;
  }
  return null;
}

export function acquireJobLock({
  name,
  keys,
  source = "manual",
}: {
  name: string;
  keys: string[];
  source?: string;
}) {
  const normalizedKeys = Array.from(new Set(keys));
  const activeJob = getJobConflict(normalizedKeys);
  if (activeJob) {
    jobLocks.lastSkipped = {
      name,
      source,
      skippedAt: new Date().toISOString(),
      activeJob,
    };
    console.warn(`[Worker] Duplicate job blocked type=${name} lockKey=${normalizedKeys[0] || "unknown"} existingJob=${activeJob.id} status=running`);
    return { acquired: false as const, activeJob };
  }

  const now = new Date();
  const worker = getWorkerIdentity();
  const job: ActiveJob = {
    id: jobId(),
    name,
    source,
    keys: normalizedKeys,
    lockKey: normalizedKeys[0] || name,
    workerId: worker.workerId,
    startedAt: now.toISOString(),
    lastHeartbeatAt: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
  for (const key of normalizedKeys) jobLocks.activeByKey[key] = job;
  logDebug(`[Worker] Acquired job id=${job.id} type=${name} lockKey=${job.lockKey}`);
  if (heartbeatEnabled()) {
    void markJobLeaseHeartbeat({
      jobId: null,
      jobType: name,
      lockKey: job.lockKey,
    });
  }

  return {
    acquired: true as const,
    job,
    release: () => releaseJobLock(job),
  };
}

export function releaseJobLock(job: ActiveJob) {
  for (const key of job.keys) {
    if (jobLocks.activeByKey[key]?.id === job.id) {
      delete jobLocks.activeByKey[key];
    }
  }
  logDebug(`[Worker] Released job id=${job.id} type=${job.name} lockKey=${job.lockKey}`);
  if (heartbeatEnabled()) void markJobLeaseHeartbeat({ jobId: null });
}

export function setJobPhase(job: ActiveJob, phase: string) {
  job.phase = phase;
  const now = new Date();
  job.lastHeartbeatAt = now.toISOString();
  for (const key of job.keys) {
    if (jobLocks.activeByKey[key]?.id === job.id) {
      jobLocks.activeByKey[key] = job;
    }
  }
  if (heartbeatEnabled()) {
    void markJobLeaseHeartbeat({
      jobId: job.jobHistoryId || null,
      jobType: job.jobHistoryType || job.name,
      lockKey: job.lockKey,
      progress: { phase },
      currentItemLabel: phase,
    });
  }
}

export function attachJobHistoryToLock(job: ActiveJob, history: { id: string } | null, type: string) {
  if (!history) return;
  job.jobHistoryId = history.id;
  job.jobHistoryType = type;
  for (const key of job.keys) {
    if (jobLocks.activeByKey[key]?.id === job.id) {
      jobLocks.activeByKey[key] = job;
    }
  }
  if (heartbeatEnabled()) {
    void markJobLeaseHeartbeat({
      jobId: history.id,
      jobType: type,
      lockKey: job.lockKey,
    });
  }
}

export function getJobDebugSnapshot(now = Date.now()) {
  const activeJobs = uniqueJobs().map((job) => {
    const started = new Date(job.startedAt).getTime();
    return {
      id: job.id,
      name: job.name,
      source: job.source,
      workerId: job.workerId,
      lockKey: job.lockKey,
      jobHistoryId: job.jobHistoryId || null,
      startedAt: job.startedAt,
      lastHeartbeatAt: job.lastHeartbeatAt,
      leaseExpiresAt: job.leaseExpiresAt,
      durationSeconds: Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 1000)) : 0,
      phase: job.phase || null,
    };
  });

  return {
    activeJob: activeJobs.find((job) => job.id === jobLocks.activeByKey[GLOBAL_SYNC_JOB_KEY]?.id) || activeJobs[0] || null,
    activeJobs,
    queuedJobs: 0,
    lastSkipped: jobLocks.lastSkipped || null,
  };
}

export function resetJobLocksForTests() {
  jobLocks.activeByKey = {};
  jobLocks.lastSkipped = undefined;
}
