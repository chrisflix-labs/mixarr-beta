"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Download, FileArchive, Info, Loader2, RefreshCw,
  ShieldCheck, Trash2, UploadCloud,
} from "lucide-react";
import styles from "@/app/settings/system/library-backup/library-backup.module.css";

type Coverage = {
  totalTracks: number;
  plexLibrary: { tracksAvailable: number };
  audioFeatures: { completed: number; incomplete: number; local: number; api: number; estimated: number };
  popularity: { values: number; attempted: number; noData: number };
  genres: { values: number; attempted: number; noData: number };
  bpm: { values: number; attempted: number; pending: number };
  storage: { backupDirLabel: string; warning: string; separateVolumeUnverified: boolean };
  included: string[];
  excluded: string[];
};

type ArchiveSummary = {
  id: string;
  fileName: string;
  schemaVersion: number;
  mixarrVersion: string;
  fileSizeBytes: number;
  counts: { tracks: number; audioFeatures: number; bpm: number; popularity: number; genres: number; noData: number };
  notes: string | null;
  verificationStatus: string;
  createdAt: string;
  lastRestoredAt: string | null;
};

type BackupJob = { id: string; status: string; phase: string; processed: number; totalEstimate: number; trackCount: number; archiveId: string | null; error: string | null };

type RestorePreview = {
  compatibility: string;
  tracksInBackup: number;
  tracksInLibrary: number;
  matches: { exact: number; highConfidence: number; ambiguous: number; unmatched: number };
  categories: Record<string, { existing: number; wouldAdd: number; wouldOverwrite: number; skipped: number; noDataRestored: number }>;
  warnings: string[];
};

type RestoreJob = {
  id: string;
  archiveFileName: string;
  status: string;
  phase: string;
  conflictPolicy: string;
  compatibility: string | null;
  archiveTrackCount: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  appliedCount: number;
  preview: RestorePreview | null;
  report: Record<string, unknown> | null;
  error: string | null;
};

type Policy = "fill_missing" | "prefer_backup" | "keep_current";

const PHASE_LABELS: Record<string, string> = {
  preparing: "Preparing", reading: "Reading tracks", exporting: "Exporting features",
  writing: "Writing archive", verifying: "Verifying checksums", completed: "Complete", failed: "Failed",
  uploaded: "Uploaded", validating: "Validating", preview_ready: "Preview ready",
  waiting_for_library_sync: "Waiting for library sync", matching: "Matching tracks",
  restoring: "Restoring", canceled: "Canceled", interrupted: "Interrupted", completed_with_warnings: "Completed with warnings",
};

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes; let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function LibraryBackupManager({ initialCoverage }: { initialCoverage: Coverage | null }) {
  const [coverage, setCoverage] = useState<Coverage | null>(initialCoverage);
  const [archives, setArchives] = useState<ArchiveSummary[]>([]);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "success" | "error"; text: string } | null>(null);
  const [backupJob, setBackupJob] = useState<BackupJob | null>(null);
  const [creating, setCreating] = useState(false);

  // Restore state
  const [restore, setRestore] = useState<RestoreJob | null>(null);
  const [policy, setPolicy] = useState<Policy>("fill_missing");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadArchives = useCallback(async () => {
    const res = await fetch("/api/library-backups", { cache: "no-store" });
    if (res.ok) setArchives((await res.json()).archives ?? []);
  }, []);

  const refreshCoverage = useCallback(async () => {
    const res = await fetch("/api/library-backups/status", { cache: "no-store" });
    if (res.ok) setCoverage(await res.json());
  }, []);

  useEffect(() => { void loadArchives(); }, [loadArchives]);

  // Poll a running backup job.
  useEffect(() => {
    if (!backupJob || ["completed", "failed"].includes(backupJob.status)) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/library-backups/jobs/${backupJob.id}`, { cache: "no-store" });
      if (res.ok) {
        const { job } = await res.json();
        setBackupJob(job);
        if (job.status === "completed") { setMessage({ tone: "success", text: "Backup created successfully." }); void loadArchives(); }
        if (job.status === "failed") setMessage({ tone: "error", text: job.error || "Backup failed." });
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [backupJob, loadArchives]);

  // Poll a running restore job.
  useEffect(() => {
    if (!restore || !["matching", "restoring", "validating"].includes(restore.status)) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/library-backups/restore/${restore.id}`, { cache: "no-store" });
      if (res.ok) {
        const { restore: job } = await res.json();
        setRestore(job);
        if (["completed", "completed_with_warnings", "failed", "canceled"].includes(job.status)) {
          void refreshCoverage();
          setMessage({ tone: job.status === "failed" ? "error" : "success", text: `Restore ${job.status.replace(/_/g, " ")}.` });
        }
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [restore, refreshCoverage]);

  const createBackup = useCallback(async () => {
    setCreating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/library-backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: notes || undefined }) });
      const data = await res.json();
      if (!res.ok) { setMessage({ tone: "error", text: data.error || "Failed to start backup." }); return; }
      setBackupJob({ id: data.jobId, status: "preparing", phase: "preparing", processed: 0, totalEstimate: coverage?.totalTracks ?? 0, trackCount: 0, archiveId: null, error: null });
      setMessage({ tone: "info", text: "Backup started. This continues in the background." });
    } finally { setCreating(false); }
  }, [notes, coverage]);

  const deleteArchive = useCallback(async (id: string) => {
    if (!window.confirm("Delete this backup? This cannot be undone. Keep a downloaded copy if you still need it.")) return;
    const res = await fetch(`/api/library-backups/${id}`, { method: "DELETE" });
    if (res.ok) { setMessage({ tone: "success", text: "Backup deleted." }); void loadArchives(); }
    else setMessage({ tone: "error", text: "Failed to delete backup." });
  }, [loadArchives]);

  const uploadForRestore = useCallback(async (file: File) => {
    setUploading(true);
    setMessage(null);
    setRestore(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/library-backups/restore/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { setMessage({ tone: "error", text: data.error || "Upload failed." }); return; }
      setMessage({
        tone: data.waitingForLibrarySync ? "info" : "success",
        text: data.waitingForLibrarySync
          ? `Backup validated and staged (${data.archiveTrackCount} records). It will apply after a Plex library sync.`
          : `Backup validated: ${data.archiveTrackCount} records, compatibility "${data.compatibility}".`,
      });
      const statusRes = await fetch(`/api/library-backups/restore/${data.restoreJobId}`, { cache: "no-store" });
      if (statusRes.ok) setRestore((await statusRes.json()).restore);
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }, []);

  const runPreview = useCallback(async () => {
    if (!restore) return;
    setMessage(null);
    const res = await fetch(`/api/library-backups/restore/${restore.id}/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conflictPolicy: policy }),
    });
    const data = await res.json();
    if (!res.ok) { setMessage({ tone: "error", text: data.error || "Preview failed." }); return; }
    const statusRes = await fetch(`/api/library-backups/restore/${restore.id}`, { cache: "no-store" });
    if (statusRes.ok) setRestore((await statusRes.json()).restore);
  }, [restore, policy]);

  const applyRestore = useCallback(async () => {
    if (!restore) return;
    if (!window.confirm(policy === "prefer_backup"
      ? "Prefer Backup will overwrite current library-intelligence values with the backup's. Continue?"
      : "Apply this restore now?")) return;
    setMessage(null);
    const res = await fetch(`/api/library-backups/restore/${restore.id}/apply`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conflictPolicy: policy }),
    });
    if (res.ok) { setRestore({ ...restore, status: "restoring", phase: "restoring" }); setMessage({ tone: "info", text: "Restore started in the background." }); }
    else setMessage({ tone: "error", text: (await res.json()).error || "Failed to start restore." });
  }, [restore, policy]);

  const cancelRestore = useCallback(async () => {
    if (!restore) return;
    await fetch(`/api/library-backups/restore/${restore.id}/cancel`, { method: "POST" });
    setMessage({ tone: "info", text: "Cancellation requested." });
  }, [restore]);

  const backupRunning = backupJob && !["completed", "failed"].includes(backupJob.status);

  return (
    <div className={styles.manager}>
      {message && (
        <div className={`${styles.banner} ${styles[`banner_${message.tone}`]}`} role={message.tone === "error" ? "alert" : "status"}>
          {message.tone === "error" ? <AlertTriangle size={16} /> : message.tone === "success" ? <CheckCircle2 size={16} /> : <Info size={16} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Coverage cards */}
      {coverage && (
        <section className={`glass-panel ${styles.section}`} aria-labelledby="coverage-h">
          <div className={styles.sectionHead}>
            <h3 id="coverage-h">Current backup coverage</h3>
            <button className={styles.iconBtn} onClick={() => void refreshCoverage()} aria-label="Refresh coverage"><RefreshCw size={16} /></button>
          </div>
          <div className={styles.cards}>
            <CoverageCard title="Plex Library" rows={[["Tracks available", coverage.plexLibrary.tracksAvailable]]} />
            <CoverageCard title="Audio Features" rows={[["Completed", coverage.audioFeatures.completed], ["Incomplete", coverage.audioFeatures.incomplete], ["Local", coverage.audioFeatures.local], ["API", coverage.audioFeatures.api], ["Estimated", coverage.audioFeatures.estimated]]} />
            <CoverageCard title="Popularity Scores" rows={[["Values", coverage.popularity.values], ["Attempted", coverage.popularity.attempted], ["No data", coverage.popularity.noData]]} />
            <CoverageCard title="Track Genres" rows={[["Values", coverage.genres.values], ["Attempted", coverage.genres.attempted], ["No data", coverage.genres.noData]]} />
            <CoverageCard title="BPM / Tempo" rows={[["Values", coverage.bpm.values], ["Attempted", coverage.bpm.attempted], ["Pending", coverage.bpm.pending]]} />
          </div>
          <div className={styles.scopeGrid}>
            <div>
              <h4><ShieldCheck size={15} /> Included</h4>
              <ul>{coverage.included.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
            <div>
              <h4><AlertTriangle size={15} /> Never included</h4>
              <ul>{coverage.excluded.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          </div>
        </section>
      )}

      {/* Create backup */}
      <section className={`glass-panel ${styles.section}`} aria-labelledby="create-h">
        <h3 id="create-h">Create backup</h3>
        <p className={styles.warn}><AlertTriangle size={15} /> {coverage?.storage.warning}</p>
        <label className={styles.label} htmlFor="backup-notes">Optional notes</label>
        <input id="backup-notes" className={styles.input} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Before rebuilding the database volume" />
        {backupRunning ? (
          <div className={styles.progress} role="status" aria-live="polite">
            <Loader2 size={16} className={styles.spin} />
            <span>{PHASE_LABELS[backupJob!.phase] || backupJob!.phase} — {backupJob!.processed}/{backupJob!.totalEstimate || "?"} tracks</span>
          </div>
        ) : (
          <button className={styles.primaryBtn} onClick={() => void createBackup()} disabled={creating || (coverage?.totalTracks ?? 0) === 0}>
            {creating ? <Loader2 size={16} className={styles.spin} /> : <FileArchive size={16} />} Create Backup
          </button>
        )}
      </section>

      {/* Backup history */}
      <section className={`glass-panel ${styles.section}`} aria-labelledby="history-h">
        <h3 id="history-h">Backup history</h3>
        {archives.length === 0 ? <p className={styles.muted}>No backups yet.</p> : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th>Name</th><th>Created</th><th>Version</th><th>Tracks</th><th>Size</th><th>Verified</th><th>Actions</th></tr></thead>
              <tbody>
                {archives.map((a) => (
                  <tr key={a.id}>
                    <td className={styles.wrapCell}>{a.fileName}</td>
                    <td>{new Date(a.createdAt).toLocaleString()}</td>
                    <td>v{a.mixarrVersion}</td>
                    <td>{a.counts.tracks.toLocaleString()}</td>
                    <td>{formatBytes(a.fileSizeBytes)}</td>
                    <td>{a.verificationStatus === "verified" ? <CheckCircle2 size={15} color="var(--success, green)" aria-label="Verified" /> : a.verificationStatus}</td>
                    <td className={styles.rowActions}>
                      <a className={styles.iconBtn} href={`/api/library-backups/${a.id}/download`} aria-label={`Download ${a.fileName}`}><Download size={15} /></a>
                      <button className={styles.iconBtn} onClick={() => void deleteArchive(a.id)} aria-label={`Delete ${a.fileName}`}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Restore */}
      <section className={`glass-panel ${styles.section}`} aria-labelledby="restore-h">
        <h3 id="restore-h">Restore backup</h3>
        <p className={styles.muted}>Upload a .mixarr-library-backup archive. It is validated before anything is written, and a preview shows what would change.</p>

        <label className={styles.uploadBox}>
          <input ref={fileRef} type="file" accept=".mixarr-library-backup,application/octet-stream,application/zip" className={styles.visuallyHidden}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadForRestore(f); }} disabled={uploading} />
          {uploading ? <Loader2 size={20} className={styles.spin} /> : <UploadCloud size={20} />}
          <span>{uploading ? "Validating…" : "Choose or drop a backup file"}</span>
        </label>

        {restore && (
          <div className={styles.restorePanel}>
            <div className={styles.restoreHead}>
              <strong>{restore.archiveFileName}</strong>
              <span className={styles.badge}>{PHASE_LABELS[restore.status] || restore.status}</span>
              {restore.compatibility && <span className={styles.badgeMuted}>{restore.compatibility.replace(/_/g, " ")}</span>}
            </div>

            <fieldset className={styles.policyFieldset}>
              <legend>Conflict policy</legend>
              {(["fill_missing", "prefer_backup", "keep_current"] as Policy[]).map((p) => (
                <label key={p} className={styles.radio}>
                  <input type="radio" name="policy" value={p} checked={policy === p} onChange={() => setPolicy(p)} />
                  <span>{p === "fill_missing" ? "Fill Missing Only (recommended)" : p === "prefer_backup" ? "Prefer Backup (overwrite)" : "Keep Current"}</span>
                </label>
              ))}
            </fieldset>

            <div className={styles.restoreActions}>
              <button className={styles.secondaryBtn} onClick={() => void runPreview()} disabled={["restoring", "matching"].includes(restore.status)}>Preview changes</button>
              <button className={styles.primaryBtn} onClick={() => void applyRestore()} disabled={!restore.preview || ["restoring", "matching"].includes(restore.status)}>Apply restore</button>
              {["restoring", "matching"].includes(restore.status) && <button className={styles.secondaryBtn} onClick={() => void cancelRestore()}>Cancel</button>}
              {restore.status === "interrupted" && <button className={styles.secondaryBtn} onClick={() => void fetch(`/api/library-backups/restore/${restore.id}/retry`, { method: "POST" })}>Resume</button>}
            </div>

            {restore.preview && <RestorePreviewView preview={restore.preview} />}

            {["restoring", "matching"].includes(restore.status) && (
              <div className={styles.progress} role="status" aria-live="polite"><Loader2 size={16} className={styles.spin} /> {PHASE_LABELS[restore.phase]} — applied {restore.appliedCount}/{restore.archiveTrackCount}</div>
            )}

            {restore.report && (
              <div className={styles.report}>
                <h4>Restore report</h4>
                <RestoreReportView report={restore.report} />
                <a className={styles.secondaryBtn} href={`/api/library-backups/restore/${restore.id}/report`}>Download report</a>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function CoverageCard({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className={styles.card}>
      <h4>{title}</h4>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value.toLocaleString()}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function RestorePreviewView({ preview }: { preview: RestorePreview }) {
  const cats = ["audio_features", "bpm", "popularity", "genres"] as const;
  const label: Record<string, string> = { audio_features: "Audio features", bpm: "BPM", popularity: "Popularity", genres: "Genres" };
  return (
    <div className={styles.previewGrid}>
      <div className={styles.matchSummary}>
        <span><strong>{preview.tracksInBackup}</strong> in backup</span>
        <span><strong>{preview.tracksInLibrary}</strong> in library</span>
        <span><strong>{preview.matches.exact}</strong> exact</span>
        <span><strong>{preview.matches.highConfidence}</strong> high-confidence</span>
        <span><strong>{preview.matches.ambiguous}</strong> ambiguous</span>
        <span><strong>{preview.matches.unmatched}</strong> unmatched</span>
      </div>
      {preview.warnings.map((w) => <p key={w} className={styles.warn}><AlertTriangle size={14} /> {w}</p>)}
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead><tr><th>Category</th><th>Existing</th><th>Would add</th><th>Overwrite</th><th>Skipped</th><th>No-data</th></tr></thead>
          <tbody>
            {cats.map((c) => {
              const v = preview.categories[c] || { existing: 0, wouldAdd: 0, wouldOverwrite: 0, skipped: 0, noDataRestored: 0 };
              return <tr key={c}><td>{label[c]}</td><td>{v.existing}</td><td>{v.wouldAdd}</td><td>{v.wouldOverwrite}</td><td>{v.skipped}</td><td>{v.noDataRestored}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RestoreReportView({ report }: { report: Record<string, unknown> }) {
  const fields: [string, string][] = [
    ["Matched", "matched"], ["Unmatched", "unmatched"], ["Ambiguous", "ambiguous"],
    ["Audio features", "audioFeaturesRestored"], ["BPM", "bpmRestored"], ["Popularity", "popularityRestored"],
    ["Genres", "genresRestored"], ["No-data restored", "noDataRestored"],
    ["Preserved", "existingPreserved"], ["Overwritten", "existingOverwritten"],
  ];
  return (
    <dl className={styles.reportGrid}>
      {fields.map(([label, key]) => (
        <div key={key}><dt>{label}</dt><dd>{String(report[key] ?? 0)}</dd></div>
      ))}
    </dl>
  );
}
