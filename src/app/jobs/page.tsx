import Link from "next/link";
import { cookies } from "next/headers";
import { Activity } from "lucide-react";
import prisma from "@/lib/prisma";
import { getClearableJobHistoryCount, getJobHistory } from "@/lib/jobHistory";
import WorkerHealthCard from "@/components/WorkerHealthCard";
import CopySupportButton from "@/components/CopySupportButton";
import ClearJobHistoryButton from "@/components/ClearJobHistoryButton";
import styles from "./jobs.module.css";

export const metadata = {
  title: "Job History | Mixarr",
  description: "Recent Mixarr background jobs, syncs, retries, and playlist activity",
};

const statusOptions = [
  ["all", "All"],
  ["running", "Running"],
  ["retrying", "Retrying"],
  ["completed", "Completed"],
  ["completed_with_warnings", "Warnings"],
  ["success", "Success"],
  ["warning", "Warning"],
  ["failed", "Failed"],
  ["error", "Error"],
  ["cancelled", "Cancelled"],
  ["interrupted", "Interrupted"],
  ["stale", "Stale"],
  ["skipped", "Skipped"],
  ["blocked", "Blocked"],
];

const typeOptions = [
  ["all", "All"],
  ["bpm", "BPM"],
  ["audio_features", "Audio Features"],
  ["plex_sync", "Plex Sync"],
  ["playlist", "Playlist"],
  ["library_health", "Library Health"],
  ["cleanup", "Cleanup"],
  ["other", "Other"],
];

function formatDate(value: Date | null) {
  if (!value) return "Still running";
  return value.toLocaleString();
}

function formatDuration(ms: number | null) {
  if (ms == null) return "Still running";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function typeLabel(type: string) {
  const label = typeOptions.find(([value]) => value === type)?.[1];
  if (label) return label;
  return type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countValue(value: number | null) {
  return (value ?? 0).toLocaleString();
}

function plexSyncCounts(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const counts = (metadata as any).counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null;
  return counts as Record<string, number>;
}

export default async function JobHistoryPage({
  searchParams,
}: {
  searchParams?: { status?: string; type?: string };
}) {
  const userId = cookies().get("mixarr_session")?.value;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
  const selectedStatus = searchParams?.status || "all";
  const selectedType = searchParams?.type || "all";
  const [jobs, clearableJobCount] = user
    ? await Promise.all([
        getJobHistory({ userId: user.id, status: selectedStatus, type: selectedType }),
        getClearableJobHistoryCount({ userId: user.id }),
      ])
    : [[], 0];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>
            <Activity size={14} />
            Activity History
          </span>
          <h2>Job History</h2>
          <p>Recent syncs, retries, playlist runs, cleanup jobs, and analysis work are shown newest first.</p>
        </div>
      </header>

      {!user ? (
        <div className={styles.authPanel}>Connect Plex to view recent Mixarr jobs.</div>
      ) : (
        <>
          <form className={styles.filters}>
            <div className={styles.filterField}>
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={selectedStatus}>
                {statusOptions.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className={styles.filterField}>
              <label htmlFor="type">Job type</label>
              <select id="type" name="type" defaultValue={selectedType}>
                {typeOptions.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <button className={styles.filterButton} type="submit">Apply Filters</button>
            <Link className={styles.secondaryButton} href="/job-history">Reset</Link>
          </form>

          <ClearJobHistoryButton clearableCount={clearableJobCount} />

          <WorkerHealthCard />

          {jobs.length === 0 ? (
            <div className={styles.emptyState}>No jobs have been recorded yet. Run a sync, retry, or playlist job to see history here.</div>
          ) : (
            <section className={styles.jobList} aria-label="Recent Mixarr jobs">
              {jobs.map((job) => {
                const plexCounts = job.type === "plex_sync" ? plexSyncCounts(job.metadata) : null;
                return (
                <article key={job.id} className={styles.jobCard}>
                  <div className={styles.jobTop}>
                    <div>
                      <h3>{job.name}</h3>
                      <div className={styles.jobType}>{typeLabel(job.type)}</div>
                    </div>
                    <span className={styles.statusBadge} data-status={job.status}>{job.status}</span>
                  </div>

                  <div className={styles.metaGrid}>
                    <div className={styles.metaItem}>
                      <span>Started</span>
                      <strong>{formatDate(job.startedAt)}</strong>
                    </div>
                    <div className={styles.metaItem}>
                      <span>Finished</span>
                      <strong>{formatDate(job.finishedAt)}</strong>
                    </div>
                    <div className={styles.metaItem}>
                      <span>Duration</span>
                      <strong>{formatDuration(job.durationMs)}</strong>
                    </div>
                    <div className={styles.metaItem}>
                      <span>Trigger</span>
                      <strong>{job.trigger || "unknown"}</strong>
                    </div>
                    <div className={styles.metaItem}>
                      <span>Worker</span>
                      <strong>{job.workerId || "unknown"}</strong>
                    </div>
                    <div className={styles.metaItem}>
                      <span>Lock</span>
                      <strong>{job.lockKey || "none"}</strong>
                    </div>
                    <div className={styles.metaItem}>
                      <span>Last progress</span>
                      <strong>{formatDate(job.lastProgressAt)}</strong>
                    </div>
                    <div className={styles.metaItem}>
                      <span>Lease expires</span>
                      <strong>{formatDate(job.leaseExpiresAt)}</strong>
                    </div>
                  </div>

                  <div className={styles.counts} aria-label="Job counts">
                    <span>Attempted {countValue(job.attempted)}</span>
                    <span>Processed {countValue(job.processed)}</span>
                    <span>Skipped {countValue(job.skipped)}</span>
                    <span>Failed {countValue(job.failed)}</span>
                  </div>

                  {plexCounts && (
                    <div className={styles.counts} aria-label="Plex sync summary">
                      <span>Scanned {countValue(plexCounts.scanned ?? null)}</span>
                      <span>Matched {countValue(plexCounts.matched ?? null)}</span>
                      <span>New {countValue(plexCounts.newTracks ?? null)}</span>
                      <span>Updated {countValue(plexCounts.updatedMetadata ?? null)}</span>
                      <span>Moved {countValue(plexCounts.movedFiles ?? null)}</span>
                      <span>Renamed {countValue(plexCounts.renamedTracks ?? null)}</span>
                      <span>Missing {countValue(plexCounts.markedMissing ?? null)}</span>
                      <span>Restored {countValue(plexCounts.restored ?? null)}</span>
                      <span>Duplicates {countValue(plexCounts.duplicateCandidates ?? null)}</span>
                      <span>Conflicts {countValue(plexCounts.matchConflicts ?? null)}</span>
                    </div>
                  )}

                  {job.summary && <p className={styles.summary}>{job.summary}</p>}
                  {job.recoveryHint && ["failed", "interrupted", "stale"].includes(job.status) && (
                    <p className={styles.summary}>Recovery: {job.recoveryHint}</p>
                  )}

                  {["failed", "interrupted", "stale"].includes(job.status) && (
                    <div className={styles.supportActions}>
                      <CopySupportButton
                        url={`/api/support/job-report/${job.id}`}
                        label="Copy Failure Report"
                        className={styles.secondaryButton}
                      />
                      <Link href="/support" className={styles.secondaryButton}>Report this issue</Link>
                    </div>
                  )}

                  {job.error && (
                    <details className={styles.errorDetails}>
                      <summary>Error details</summary>
                      <pre>{job.error.length > 2000 ? `${job.error.slice(0, 1999)}...` : job.error}</pre>
                    </details>
                  )}
                </article>
              );})}
            </section>
          )}
        </>
      )}
    </main>
  );
}
