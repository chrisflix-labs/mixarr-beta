"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AudioWaveform, BarChart3, Gauge, Loader2, Music2, RefreshCw, Settings, Tags, TrendingUp } from "lucide-react";
import WorkerHealthCard from "@/components/WorkerHealthCard";
import styles from "./data-enrichment.module.css";

type Action =
  | "sync_bpm"
  | "retry_missing_bpm"
  | "analyze_local_bpm"
  | "force_local_bpm_reprocess"
  | "sync_audio_features"
  | "retry_partial_audio_features"
  | "retry_pending_audio_features"
  | "retry_missing_mood_energy"
  | "retry_partial_mood_energy"
  | "force_local_mood_energy_reprocess"
  | "run_local_analysis"
  | "force_local_audio_reprocess"
  | "sync_genres"
  | "retry_missing_genres"
  | "sync_popularity"
  | "retry_missing_popularity";

type Preflight = {
  action: Action;
  title: string;
  enrichmentType: string;
  filter: string;
  matched: number;
  eligible: number;
  queued: number;
  skipped: number;
  skipReasons: Record<string, number>;
  skipReasonLabels?: Record<string, string>;
  providerMode: string;
  estimatedAction: string;
  canRun: boolean;
  disabledReason: string | null;
  summary: string;
  advanced?: boolean;
};

type Job = {
  name?: string;
  status?: string;
  running?: boolean;
  startedAt?: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  processed?: number | null;
  skipped?: number | null;
  failed?: number | null;
  summary?: string | null;
  metadata?: any;
  progress?: any;
};

type Summary = {
  totalTracks: number;
  libraries: Array<{ id: string; name: string; server: { id: string; name: string } }>;
  providerModes: Record<string, string>;
  bpm: Record<string, number>;
  audioFeatures: Record<string, number>;
  genres: Record<string, number>;
  popularity: Record<string, number>;
  localAudioAnalysis: {
    enabled: boolean;
    analyzer: string;
    analyzerAvailable: boolean;
    analyzerError: string | null;
    scope: string;
    scopeLabel: string;
    lastDiagnostics?: any;
  };
  running: {
    bpm?: Job | null;
    audioFeatures?: Job | null;
    genres?: Job | null;
    popularity?: Job | null;
  };
  lastRuns: {
    bpm?: Job | null;
    audioFeatures?: Job | null;
    genres?: Job | null;
    popularity?: Job | null;
    localAudioAnalysis?: any;
  };
};

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatDuration(value: number | null | undefined) {
  if (!value) return "";
  const seconds = Math.max(1, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function formatSkipReasons(preflight?: Preflight | null) {
  const entries = Object.entries(preflight?.skipReasons || {}).filter(([, value]) => value > 0);
  return entries.map(([reason, value]) => `${preflight?.skipReasonLabels?.[reason] || reason.replace(/_/g, " ")}=${formatNumber(value)}`).join(", ");
}

function completionStatus(complete: number, total: number) {
  if (total > 0 && complete >= total) return "complete";
  return "incomplete";
}

function LastRun({ job, running }: { job?: Job | any | null; running?: Job | null }) {
  const progress = running?.progress || {};
  if (running?.running) {
    return (
      <div className={styles.lastRun}>
        <strong>Running now: processed {formatNumber(progress.processed)} / {formatNumber(progress.matched || progress.eligible)}</strong>
        <small>Skipped {formatNumber(progress.skipped)} · failed {formatNumber(progress.failed)} · {progress.scopeLabel || progress.providerMode || "current mode"}</small>
      </div>
    );
  }
  if (!job) {
    return <div className={styles.lastRun}><strong>Last run: Never</strong></div>;
  }
  const finished = job.finishedAt || job.lastRunAt || null;
  const processed = job.processed ?? job.metadata?.processed ?? 0;
  const skipped = job.skipped ?? job.metadata?.skipped ?? 0;
  const failed = job.failed ?? job.metadata?.failed ?? 0;
  const duration = formatDuration(job.durationMs);
  return (
    <div className={styles.lastRun}>
      <strong>Last run: {formatDate(finished)}{job.status ? ` · ${job.status}` : ""}</strong>
      <small>processed {formatNumber(processed)} · skipped {formatNumber(skipped)} · failed {formatNumber(failed)}{duration ? ` · ${duration}` : ""}</small>
      {job.summary && <small>{job.summary}</small>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string | null | undefined }) {
  return (
    <div className={styles.metric}>
      <span title={label}>{label}</span>
      <strong>{typeof value === "number" ? formatNumber(value) : value || "-"}</strong>
    </div>
  );
}

function ActionButton({
  action,
  label,
  variant = "secondary",
  disabled,
  onRun,
}: {
  action: Action;
  label: string;
  variant?: "primary" | "secondary" | "advanced";
  disabled?: boolean;
  onRun: (action: Action) => void;
}) {
  const className = variant === "primary" ? styles.primaryButton : variant === "advanced" ? styles.advancedButton : styles.secondaryButton;
  return (
    <button className={className} type="button" disabled={disabled} onClick={() => onRun(action)}>
      <RefreshCw size={14} />
      {label}
    </button>
  );
}

export default function DataEnrichmentPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [libraryId, setLibraryId] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);

  const loadSummary = useCallback(async () => {
    const params = new URLSearchParams();
    if (libraryId) params.set("libraryId", libraryId);
    const response = await fetch(`/api/data-enrichment/summary?${params}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load Data Enrichment.");
    setSummary(data);
  }, [libraryId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSummary()
      .catch((caught) => !cancelled && setError(caught instanceof Error ? caught.message : "Unable to load Data Enrichment."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [loadSummary]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (working || summary?.running?.bpm?.running || summary?.running?.audioFeatures?.running || summary?.running?.genres?.running || summary?.running?.popularity?.running) {
        void loadSummary().catch(() => undefined);
      }
    }, working ? 5000 : 15000);
    return () => window.clearInterval(interval);
  }, [loadSummary, working, summary]);

  const totals = useMemo(() => ({
    total: summary?.totalTracks || 0,
    bpmComplete: summary?.bpm.tracksWithBpm || 0,
    audioComplete: summary?.audioFeatures.complete || 0,
    genresComplete: summary?.genres.tracksWithGenres || 0,
    popularityComplete: summary?.popularity.tracksWithPopularity || 0,
  }), [summary]);

  async function startBackgroundJob(start: any) {
    if (!start?.endpoint) return "";
    const response = await fetch(start.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(start.body || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to start enrichment job.");
    return data.status === "already_running"
      ? ` ${data.message || "An enrichment job is already running."}`
      : " Background job started.";
  }

  async function runAction(action: Action) {
    setWorking(action);
    setError(null);
    setMessage(null);
    try {
      const payload = { action, libraryId: libraryId || undefined };
      const preflightResponse = await fetch("/api/data-enrichment/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const nextPreflight: Preflight = await preflightResponse.json();
      if (!preflightResponse.ok) throw new Error((nextPreflight as any).error || "Failed to preflight enrichment action.");
      setPreflight(nextPreflight);
      if (!nextPreflight.canRun) {
        setMessage(nextPreflight.disabledReason || nextPreflight.summary || "No matching tracks need this enrichment action.");
        return;
      }

      const skipped = formatSkipReasons(nextPreflight);
      const needsConfirmation = nextPreflight.advanced || nextPreflight.skipped > 0 || nextPreflight.matched !== nextPreflight.eligible;
      if (needsConfirmation) {
        const confirmed = window.confirm(
          `${nextPreflight.title}\n\nMatched: ${formatNumber(nextPreflight.matched)}\nEligible: ${formatNumber(nextPreflight.eligible)}\nSkipped: ${formatNumber(nextPreflight.skipped)}${skipped ? `\nSkipped reasons: ${skipped}` : ""}\nMode: ${nextPreflight.providerMode}\n\n${nextPreflight.estimatedAction}`,
        );
        if (!confirmed) return;
      }

      const runResponse = await fetch("/api/data-enrichment/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await runResponse.json();
      if (!runResponse.ok) throw new Error(result.error || "Failed to run enrichment action.");
      if (result.status === "noop") {
        setMessage(result.message || result.summary || "No matching tracks need this enrichment action.");
        return;
      }
      const startSuffix = await startBackgroundJob(result.start);
      setMessage(`${result.message || result.summary || nextPreflight.summary}${startSuffix}`);
      await loadSummary();
      window.setTimeout(() => void loadSummary().catch(() => undefined), 6000);
      window.setTimeout(() => void loadSummary().catch(() => undefined), 22000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to run enrichment action.");
    } finally {
      setWorking(null);
    }
  }

  if (loading) {
    return <main className={styles.page}><div className={`glass-panel ${styles.message}`}><Loader2 className="animate-spin" size={16} /> Loading Data Enrichment...</div></main>;
  }

  if (!summary) {
    return <main className={styles.page}><div className={styles.error}>{error || "Data Enrichment is unavailable."}</div></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h2><AudioWaveform size={26} color="var(--accent)" /> Data Enrichment</h2>
          <p>Keep BPM, audio features, genres, and popularity metadata updated for smarter playlists.</p>
        </div>
        <div className={styles.toolbar}>
          <select value={libraryId} onChange={(event) => setLibraryId(event.target.value)} aria-label="Library">
            <option value="">All libraries</option>
            {summary.libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
          </select>
          <Link href="/settings" className={styles.secondaryButton}><Settings size={14} /> Settings</Link>
        </div>
      </header>

      <WorkerHealthCard compact />

      <section className={styles.modePanel} aria-label="Current provider settings">
        <div><span>BPM mode</span><strong>{summary.providerModes.bpm}</strong></div>
        <div><span>Audio feature mode</span><strong>{summary.providerModes.audioFeatures}</strong></div>
        <div><span>BPM preference</span><strong>{summary.providerModes.preferLocalBpm}</strong></div>
        <div><span>Audio preference</span><strong>{summary.providerModes.preferLocalAudioFeatures}</strong></div>
        <div><span>API enrichment</span><strong>{summary.providerModes.apiAudioFeatures}</strong></div>
        <div><span>Local Essentia</span><strong>{summary.providerModes.localAudioFeatures}</strong></div>
      </section>

      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}
      {preflight && (
        <section className={styles.preflightPanel} aria-label="Last preflight summary">
          <strong>{preflight.title}</strong>
          <div className={styles.preflightGrid}>
            <Metric label="Matched" value={preflight.matched} />
            <Metric label="Eligible" value={preflight.eligible} />
            <Metric label="Skipped" value={preflight.skipped} />
            <Metric label="Mode" value={preflight.providerMode} />
          </div>
          <p className={styles.muted}>{preflight.summary}</p>
          {formatSkipReasons(preflight) && <p className={styles.muted}>Skipped: {formatSkipReasons(preflight)}</p>}
        </section>
      )}

      <section className={styles.grid} aria-label="Data Enrichment cards">
        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.icon}><Gauge size={19} /></span>
            <div>
              <h3>BPM / Tempo</h3>
              <p className={styles.muted}>Adds or updates BPM values used for tempo filters, BPM presets, and playlist matching.</p>
            </div>
            <span className={styles.statusBadge} data-status={completionStatus(totals.bpmComplete, totals.total)}>{completionStatus(totals.bpmComplete, totals.total)}</span>
          </div>
          <div className={styles.metricGrid}>
            <Metric label="Tracks with BPM" value={summary.bpm.tracksWithBpm} />
            <Metric label="Missing BPM" value={summary.bpm.missingBpm} />
            <Metric label="API BPM" value={summary.bpm.apiBpm} />
            <Metric label="Local BPM" value={summary.bpm.localBpm} />
            <Metric label="Imported BPM" value={summary.bpm.importedBpm} />
            <Metric label="Low confidence" value={summary.bpm.lowConfidenceBpm} />
            <Metric label="Conflicts" value={summary.bpm.bpmSourceConflicts} />
            <Metric label="Failed" value={summary.bpm.bpmFailed} />
          </div>
          <p className={styles.helperText}>Provider mode: {summary.providerModes.bpm}</p>
          <div className={styles.linkRow}>
            <Link href="/library-health?filter=missing_bpm">View missing BPM</Link>
            <Link href="/library-health?filter=api_bpm">View API BPM only</Link>
            <Link href="/library-health?filter=local_bpm">View local BPM</Link>
            <Link href="/library-health?filter=low_confidence_bpm">View low confidence</Link>
            <Link href="/library-health?filter=bpm_source_conflict">View conflicts</Link>
            <Link href="/library-health?filter=failed_bpm_analysis">View failed BPM</Link>
          </div>
          <div className={styles.actions}>
            <div className={styles.actionSection}>
              <span className={styles.sectionLabel}>Primary actions</span>
              <div className={styles.actionGroup}><ActionButton action="sync_bpm" label="Sync BPM" variant="primary" disabled={!!working} onRun={runAction} /></div>
            </div>
            <div className={styles.actionSection}>
              <span className={styles.sectionLabel}>Retry incomplete</span>
              <div className={styles.actionGroup}>
                <ActionButton action="retry_missing_bpm" label="Retry missing BPM" disabled={!!working} onRun={runAction} />
                <ActionButton action="analyze_local_bpm" label="Analyze local BPM" disabled={!!working} onRun={runAction} />
              </div>
            </div>
            <div className={styles.actionSection}>
              <span className={styles.sectionLabel}>Advanced actions</span>
              <p className={styles.helperText}>Force local reprocess recalculates local values even when metadata already exists. This may take a while.</p>
              <div className={styles.actionGroup}><ActionButton action="force_local_bpm_reprocess" label="Force local BPM reprocess" variant="advanced" disabled={!!working} onRun={runAction} /></div>
            </div>
          </div>
          <LastRun job={summary.lastRuns.bpm} running={summary.running.bpm} />
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.icon}><BarChart3 size={19} /></span>
            <div>
              <h3>Audio Features</h3>
              <p className={styles.muted}>Adds energy, mood, danceability, and related audio features used by Smart Builder and playlist scoring.</p>
            </div>
            <span className={styles.statusBadge} data-status={completionStatus(totals.audioComplete, totals.total)}>{completionStatus(totals.audioComplete, totals.total)}</span>
          </div>
          <div className={styles.metricGrid}>
            <Metric label="Complete" value={summary.audioFeatures.complete} />
            <Metric label="Partial" value={summary.audioFeatures.partial} />
            <Metric label="Missing" value={summary.audioFeatures.missing} />
            <Metric label="Pending" value={summary.audioFeatures.pending} />
            <Metric label="API" value={summary.audioFeatures.api} />
            <Metric label="Local Essentia" value={summary.audioFeatures.local} />
            <Metric label="Estimated" value={summary.audioFeatures.heuristic} />
            <Metric label="Failed" value={summary.audioFeatures.failed} />
            <Metric label="Too short" value={summary.audioFeatures.tooShort} />
          </div>
          <div className={styles.metricGrid}>
            <Metric label="Tracks with energy" value={(summary.audioFeatures as any).moodEnergy?.tracksWithEnergy} />
            <Metric label="Missing energy" value={(summary.audioFeatures as any).moodEnergy?.tracksMissingEnergy} />
            <Metric label="Tracks with mood" value={(summary.audioFeatures as any).moodEnergy?.tracksWithMood} />
            <Metric label="Missing mood" value={(summary.audioFeatures as any).moodEnergy?.tracksMissingMood} />
            <Metric label="Missing both" value={(summary.audioFeatures as any).moodEnergy?.tracksMissingBoth} />
            <Metric label="Local mood/energy" value={(summary.audioFeatures as any).moodEnergy?.localMoodEnergyCount} />
            <Metric label="API/imported mood/energy" value={(summary.audioFeatures as any).moodEnergy?.apiImportedMoodEnergyCount} />
            <Metric label="Estimated mood/energy" value={(summary.audioFeatures as any).moodEnergy?.estimatedMoodEnergyCount} />
          </div>
          <p className={styles.helperText}>Provider mode: {summary.providerModes.audioFeatures}</p>
          <p className={styles.helperText}>Mood and energy are recalculated through local audio feature analysis when using Local Essentia.</p>
          <div className={styles.linkRow}>
            <Link href="/library-health?filter=partial_audio_features">View partial tracks</Link>
            <Link href="/library-health?filter=missing_audio_features">View missing tracks</Link>
            <Link href="/library-health?filter=pending_audio_features">View pending tracks</Link>
            <Link href="/library-health?filter=missing_mood">View missing mood</Link>
            <Link href="/library-health?filter=missing_energy">View missing energy</Link>
            <Link href="/library-health?filter=missing_mood_energy">View missing both</Link>
          </div>
          <div className={styles.actions}>
            <div className={styles.actionSection}>
              <span className={styles.sectionLabel}>Primary actions</span>
              <div className={styles.actionGroup}><ActionButton action="sync_audio_features" label="Sync Audio Features" variant="primary" disabled={!!working} onRun={runAction} /></div>
            </div>
            <div className={styles.actionSection}>
              <span className={styles.sectionLabel}>Retry incomplete</span>
              <div className={styles.actionGroup}>
                <ActionButton action="retry_partial_audio_features" label="Retry partial audio features" disabled={!!working} onRun={runAction} />
                <ActionButton action="retry_pending_audio_features" label="Retry pending audio features" disabled={!!working} onRun={runAction} />
                <ActionButton action="retry_missing_mood_energy" label="Retry missing mood/energy" disabled={!!working} onRun={runAction} />
                <ActionButton action="retry_partial_mood_energy" label="Retry partial mood/energy" disabled={!!working} onRun={runAction} />
              </div>
            </div>
            <div className={styles.actionSection}>
              <span className={styles.sectionLabel}>Advanced actions</span>
              <p className={styles.helperText}>Force local reprocess recalculates local values even when metadata already exists. This may take a while.</p>
              <div className={styles.actionGroup}>
                <ActionButton action="force_local_audio_reprocess" label="Force local audio reprocess" variant="advanced" disabled={!!working} onRun={runAction} />
                <ActionButton action="force_local_mood_energy_reprocess" label="Force local mood/energy reprocess" variant="advanced" disabled={!!working} onRun={runAction} />
              </div>
            </div>
          </div>
          <LastRun job={summary.lastRuns.audioFeatures} running={summary.running.audioFeatures} />
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.icon}><Tags size={19} /></span>
            <div>
              <h3>Genres</h3>
              <p className={styles.muted}>Adds genre metadata used for genre-aware filters and playlist recipes.</p>
            </div>
            <span className={styles.statusBadge} data-status={completionStatus(totals.genresComplete, totals.total)}>{completionStatus(totals.genresComplete, totals.total)}</span>
          </div>
          <div className={styles.metricGrid}>
            <Metric label="Tracks with genres" value={summary.genres.tracksWithGenres} />
            <Metric label="Missing genres" value={summary.genres.missingGenres} />
            <Metric label="No data" value={summary.genres.genreNoData} />
            <Metric label="Failed" value={summary.genres.genreFailed} />
            <Metric label="Pending backfill" value={summary.genres.pendingGenreBackfill} />
          </div>
          <p className={styles.helperText}>Provider mode: API/imported provider metadata</p>
          <div className={styles.linkRow}><Link href="/library-health?filter=missing_genres">View missing genres</Link></div>
          <div className={styles.actions}>
            <div className={styles.actionSection}>
              <span className={styles.sectionLabel}>Primary actions</span>
              <div className={styles.actionGroup}><ActionButton action="sync_genres" label="Sync Genres" variant="primary" disabled={!!working} onRun={runAction} /></div>
            </div>
            <div className={styles.actionSection}>
              <span className={styles.sectionLabel}>Retry incomplete</span>
              <div className={styles.actionGroup}><ActionButton action="retry_missing_genres" label="Retry missing genres" disabled={!!working} onRun={runAction} /></div>
            </div>
          </div>
          <LastRun job={summary.lastRuns.genres} running={summary.running.genres} />
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.icon}><TrendingUp size={19} /></span>
            <div>
              <h3>Popularity</h3>
              <p className={styles.muted}>Adds popularity scores used for popular favorites, deep cuts, and discovery playlists.</p>
            </div>
            <span className={styles.statusBadge} data-status={completionStatus(totals.popularityComplete, totals.total)}>{completionStatus(totals.popularityComplete, totals.total)}</span>
          </div>
          <div className={styles.metricGrid}>
            <Metric label="Tracks with popularity" value={summary.popularity.tracksWithPopularity} />
            <Metric label="Missing popularity" value={summary.popularity.missingPopularity} />
            <Metric label="No data" value={summary.popularity.popularityNoData} />
            <Metric label="Failed" value={summary.popularity.popularityFailed} />
          </div>
          <p className={styles.helperText}>Provider mode: API/imported provider metadata</p>
          <div className={styles.linkRow}><Link href="/library-health?filter=missing_popularity">View missing popularity</Link></div>
          <div className={styles.actions}>
            <div className={styles.actionSection}>
              <span className={styles.sectionLabel}>Primary actions</span>
              <div className={styles.actionGroup}><ActionButton action="sync_popularity" label="Sync Popularity" variant="primary" disabled={!!working} onRun={runAction} /></div>
            </div>
            <div className={styles.actionSection}>
              <span className={styles.sectionLabel}>Retry incomplete</span>
              <div className={styles.actionGroup}><ActionButton action="retry_missing_popularity" label="Retry missing popularity" disabled={!!working} onRun={runAction} /></div>
            </div>
          </div>
          <LastRun job={summary.lastRuns.popularity} running={summary.running.popularity} />
        </article>

        <article className={`${styles.card} ${styles.fullWidth}`}>
          <div className={styles.cardHeader}>
            <span className={styles.icon}><Music2 size={19} /></span>
            <div>
              <h3>Local Audio Analysis</h3>
              <p className={styles.muted}>Uses local files and Essentia to calculate BPM and audio features without relying only on API/imported data.</p>
            </div>
            <span className={styles.statusBadge} data-status={summary.localAudioAnalysis.enabled ? "enabled" : "disabled"}>{summary.localAudioAnalysis.enabled ? "enabled" : "disabled"}</span>
          </div>
          <div className={styles.metricGrid}>
            <Metric label="Analyzer" value={`Essentia ${summary.localAudioAnalysis.analyzerAvailable ? "available" : "unavailable"}`} />
            <Metric label="Analysis scope" value={summary.localAudioAnalysis.scopeLabel} />
            <Metric label="Last processed" value={summary.lastRuns.localAudioAnalysis?.processed ?? summary.localAudioAnalysis.lastDiagnostics?.processed ?? 0} />
            <Metric label="Last skipped" value={summary.lastRuns.localAudioAnalysis?.skipped ?? summary.localAudioAnalysis.lastDiagnostics?.skipped ?? 0} />
            <Metric label="Last failed" value={summary.lastRuns.localAudioAnalysis?.failed ?? summary.localAudioAnalysis.lastDiagnostics?.failed ?? 0} />
          </div>
          {summary.localAudioAnalysis.analyzerError && <p className={styles.helperText}>Analyzer status: {summary.localAudioAnalysis.analyzerError}</p>}
          <div className={styles.linkRow}><Link href="/settings">Settings</Link><Link href="/library-health?filter=partial_audio_features">View local analysis candidates</Link></div>
          <div className={styles.actions}>
            <div className={styles.actionSection}>
              <span className={styles.sectionLabel}>Advanced actions</span>
              <p className={styles.helperText}>Whole-library local analysis can be slow. The preflight shows matched, eligible, skipped, and provider mode before anything starts.</p>
              <div className={styles.actionGroup}>
                <ActionButton action="run_local_analysis" label="Run local analysis" variant="advanced" disabled={!!working || !summary.localAudioAnalysis.enabled} onRun={runAction} />
                <ActionButton action="force_local_audio_reprocess" label="Force local reprocess" variant="advanced" disabled={!!working || !summary.localAudioAnalysis.enabled} onRun={runAction} />
              </div>
            </div>
          </div>
          <LastRun job={summary.lastRuns.localAudioAnalysis} running={summary.running.audioFeatures} />
        </article>
      </section>
    </main>
  );
}
