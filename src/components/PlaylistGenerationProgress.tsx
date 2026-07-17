"use client";

import Link from "next/link";
import { AlertTriangle, Check, Loader2, Square } from "lucide-react";
import type { PlaylistGenerationJobView } from "@/lib/playlistGenerationClient";
import styles from "./PlaylistGenerationProgress.module.css";

const stages = [
  ["loading", "Loading library metadata"],
  ["filtering", "Applying filters"],
  ["scoring", "Scoring candidates"],
  ["selecting", "Selecting tracks"],
  ["optimizing", "Optimizing BPM and mood flow"],
  ["persisting", "Saving generation diagnostics"],
] as const;

export default function PlaylistGenerationProgress({ job, requestedTracks, librarySize, onCancel }: { job: PlaylistGenerationJobView; requestedTracks: number; librarySize?: number | null; onCancel: () => void }) {
  const progress = job.progress || {};
  const currentIndex = stages.findIndex(([key]) => key === progress.stage);
  const terminal = ["completed", "completed_with_warnings", "failed", "cancelled", "interrupted", "stale"].includes(job.status);
  const elapsed = Math.max(0, Math.floor((progress.elapsedMs || 0) / 1000));
  return <section className={styles.panel} aria-live="polite">
    <div className={styles.header}><div><strong>Generating playlist</strong><span>{job.status.replaceAll("_", " ")} · {elapsed}s elapsed</span></div>{!terminal && <button type="button" onClick={onCancel}><Square size={14} /> Cancel</button>}</div>
    {(job.largeRequest || requestedTracks >= 500) && <div className={styles.warning}><AlertTriangle size={16} /><span>Large playlist request: generating {requestedTracks.toLocaleString()} tracks{librarySize ? ` from a library of ${librarySize.toLocaleString()} tracks` : ""} may take longer than normal. Mixarr is processing it in the background.</span></div>}
    <div className={styles.stages}>{stages.map(([key, label], index) => {
      const complete = currentIndex > index || terminal && ["completed", "completed_with_warnings"].includes(job.status);
      const active = currentIndex === index && !terminal;
      return <div key={key} data-active={active} data-complete={complete}>{complete ? <Check size={15} /> : active ? <Loader2 className={styles.spin} size={15} /> : <span className={styles.dot} />}<span>{label}</span>{key === "selecting" && <em>{progress.selectedTracks || 0} / {requestedTracks}</em>}</div>;
    })}</div>
    <div className={styles.metrics}><span>Candidates: {(progress.eligibleCandidates ?? progress.initialCandidates ?? 0).toLocaleString()}</span><span>Selected: {(progress.selectedTracks || 0).toLocaleString()}</span><span>DB queries: {progress.databaseQueries || 0}</span><span>Heap: {progress.heapUsedMb || 0} MB</span></div>
    {job.summary && <p className={styles.summary}>{job.summary} <Link href="/jobs?type=playlist">Open Job History</Link></p>}
  </section>;
}
