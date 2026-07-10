"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioWaveform, HeartPulse, ListMusic, RefreshCw } from "lucide-react";
import styles from "@/app/page.module.css";
import type { DashboardSummary } from "@/lib/dashboardSummary";

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function healthStatusData(status: string) {
  if (status === "healthy") return "healthy";
  if (status === "failed" || status === "stale") return "error";
  return "warning";
}

function hasRunningEnrichment(summary: DashboardSummary | null) {
  if (!summary) return false;
  return summary.polling.active
    || Object.values(summary.dataEnrichment.running).some(Boolean)
    || summary.libraryHealth.status === "refreshing"
    || summary.libraryHealth.status === "stale";
}

function DashboardToolbar({
  onRefresh,
  refreshing,
  summary,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  summary: DashboardSummary | null;
}) {
  return (
    <div className={styles.dashboardSummaryToolbar}>
      <span>{summary ? `Summary updated ${formatDate(summary.loadedAt)}` : "Loading summary..."}</span>
      <button type="button" onClick={onRefresh} disabled={refreshing} title="Refresh dashboard summary" aria-label="Refresh dashboard summary">
        <RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />
        Refresh
      </button>
    </div>
  );
}

function LoadingCards() {
  return (
    <>
      <article className={`glass-panel ${styles.healthWidget}`}>
        <HeartPulse size={22} />
        <div><strong>Library Health</strong><span>Loading summary...</span></div>
        <b data-status="warning">Loading</b>
      </article>
      <div className={styles.compactCardsGrid}>
        <article className={styles.card}>
          <AudioWaveform size={22} className={styles.cardIcon} />
          <h3>Data Enrichment</h3>
          <p>Loading summary...</p>
        </article>
      </div>
    </>
  );
}

function ErrorCards({ error }: { error: string }) {
  return (
    <>
      <article className={`glass-panel ${styles.healthWidget}`}>
        <HeartPulse size={22} />
        <div><strong>Library Health</strong><span>Unable to load Library Health summary.</span></div>
        <b data-status="error">Error</b>
      </article>
      <div className={styles.compactCardsGrid}>
        <article className={styles.card}>
          <AudioWaveform size={22} className={styles.cardIcon} />
          <h3>Data Enrichment</h3>
          <p>{error || "Unable to load Data Enrichment summary."}</p>
        </article>
      </div>
    </>
  );
}

function LibraryHealthCards({ summary }: { summary: DashboardSummary }) {
  const health = summary.libraryHealth;
  const active = health.activeTracks;
  const audioPercent = active > 0 ? (health.completeAudioFeatures / active) * 100 : 0;
  const audioPercentLabel = health.audioIncomplete > 0 ? `${audioPercent.toFixed(1)}%` : `${Math.round(audioPercent)}%`;

  return (
    <>
      <Link href="/library-health" className={`glass-panel ${styles.healthWidget}`}>
        <HeartPulse size={22} />
        <div>
          <strong>Library Health</strong>
          <span>
            Active: {formatNumber(active)} &middot; Audio incomplete: {formatNumber(health.audioIncomplete)} &middot; Last sync: {formatDate(health.lastSyncAt)} &middot; Updated: {formatDate(health.updatedAt)}
          </span>
          {health.status !== "healthy" && <span>{health.message}</span>}
        </div>
        <b data-status={healthStatusData(health.status)}>{health.statusLabel}</b>
      </Link>

      <div className={styles.cardsGrid} style={{ marginBottom: "1.5rem" }}>
        <article className={styles.card}>
          <h3>BPM / Tempo</h3>
          <p>{formatNumber(summary.dataEnrichment.bpmComplete)} / {formatNumber(active)} with BPM</p>
          <p>Missing: {formatNumber(health.missingBpm)} &middot; Failed: {formatNumber(summary.dataEnrichment.details.bpm.bpmFailed)}</p>
          <p>Local: {formatNumber(summary.dataEnrichment.details.bpm.localBpm)} &middot; Imported/API: {formatNumber(summary.dataEnrichment.details.bpm.apiBpm + summary.dataEnrichment.details.bpm.importedBpm)} &middot; Low confidence: {formatNumber(summary.dataEnrichment.details.bpm.lowConfidenceBpm)}</p>
          {summary.dataEnrichment.details.bpm.bpmSourceConflicts > 0 && <p>{formatNumber(summary.dataEnrichment.details.bpm.bpmSourceConflicts)} possible BPM source conflict{summary.dataEnrichment.details.bpm.bpmSourceConflicts === 1 ? "" : "s"}</p>}
          <div className={styles.healthMetricLinks}>
            <Link href="/library-health?filter=missing_bpm">Missing BPM</Link>
            <Link href="/library-health?filter=api_bpm">API BPM Only</Link>
            <Link href="/library-health?filter=low_confidence_bpm">Low Confidence</Link>
            <Link href="/library-health?filter=bpm_source_conflict">Conflicts</Link>
            <Link href="/library-health?filter=failed_bpm_analysis">Failed</Link>
          </div>
        </article>
        <article className={styles.card}>
          <h3>Audio Features</h3>
          <p>{formatNumber(health.completeAudioFeatures)} / {formatNumber(active)} complete</p>
          <p>{audioPercentLabel} complete{health.audioIncomplete > 0 ? ` - ${formatNumber(health.audioIncomplete)} incomplete` : ""}</p>
          <p>API: {formatNumber(summary.dataEnrichment.details.audioFeatures.api)} &middot; Local Essentia: {formatNumber(summary.dataEnrichment.details.audioFeatures.local)}</p>
          <p>Estimated: {formatNumber(summary.dataEnrichment.details.audioFeatures.heuristic)} &middot; Partial: {formatNumber(health.partialAudioFeatures)} &middot; Missing: {formatNumber(health.missingAudioFeatures)} &middot; Pending: {formatNumber(health.pendingAudioFeatures)} &middot; Failed: {formatNumber(summary.dataEnrichment.details.audioFeatures.failed)}</p>
          <div className={styles.healthMetricLinks}>
            <Link href="/library-health?filter=missing_audio_features">Missing Features</Link>
            <Link href="/library-health?filter=partial_audio_features">Partial Features</Link>
            <Link href="/library-health?filter=pending_audio_features">Pending Features</Link>
            <Link href="/library-health?filter=failed_audio_feature_analysis">Failed</Link>
          </div>
        </article>
      </div>
    </>
  );
}

function PlexSyncCard({ summary }: { summary: DashboardSummary }) {
  const health = summary.libraryHealth;
  const counts = summary.plexSync.counts;
  const duplicateCandidates = counts.duplicateCandidates;
  const conflicts = counts.matchConflicts;
  const issues = [
    duplicateCandidates > 0 ? `${formatNumber(duplicateCandidates)} duplicate candidate${duplicateCandidates === 1 ? "" : "s"}` : null,
    conflicts > 0 ? `${formatNumber(conflicts)} match conflict${conflicts === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <Link href="/library-health" className={styles.card}>
      <ListMusic size={22} className={styles.cardIcon} />
      <h3>Plex Sync</h3>
      {summary.plexSync.lastJob ? (
        <>
          <p>Last sync: {formatDate(summary.plexSync.lastJob.finishedAt || summary.plexSync.lastJob.startedAt)}</p>
          <p>Active tracks: {formatNumber(health.activeTracks)}</p>
          <p>New: {formatNumber(counts.newTracks)} &middot; Updated: {formatNumber(counts.updatedMetadata)}</p>
          {issues.length > 0 && <p>Plex Sync needs attention: {issues.join(", ")}.</p>}
        </>
      ) : (
        <p>No Plex sync has run yet. Start a library sync to import tracks.</p>
      )}
      <span className={styles.cardAction}>Open Diagnostics</span>
    </Link>
  );
}

function DataEnrichmentCard({ summary }: { summary: DashboardSummary }) {
  const total = summary.dataEnrichment.totalTracks;
  const running = Object.values(summary.dataEnrichment.running).some(Boolean);
  return (
    <Link href="/data-enrichment" className={styles.card}>
      <AudioWaveform size={22} className={styles.cardIcon} />
      <h3>Data Enrichment</h3>
      <p>{running ? "Data enrichment job running..." : "BPM, audio features, genres, and popularity metadata used by Mixarr playlists."}</p>
      <div className={styles.enrichmentStats}>
        <span>BPM <b>{formatNumber(summary.dataEnrichment.bpmComplete)} / {formatNumber(total)}</b></span>
        <span>Audio <b>{formatNumber(summary.dataEnrichment.audioComplete)} / {formatNumber(total)}</b></span>
        <span>Genres <b>{formatNumber(summary.dataEnrichment.genresComplete)} / {formatNumber(total)}</b></span>
        <span>Popularity <b>{formatNumber(summary.dataEnrichment.popularityComplete)} / {formatNumber(total)}</b></span>
      </div>
      <span className={styles.cardAction}>Manage Enrichment</span>
    </Link>
  );
}

export default function DashboardSummaryCards({ initialSummary }: { initialSummary: DashboardSummary | null }) {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(initialSummary);
  const [loading, setLoading] = useState(!initialSummary);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const wasRunning = useRef(hasRunningEnrichment(initialSummary));
  const runningRef = useRef(wasRunning.current);

  const loadSummary = useCallback(async ({ manual = false } = {}) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/dashboard/summary", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load Dashboard summary.");
      setSummary(data);
      setError("");
      const running = hasRunningEnrichment(data);
      runningRef.current = running;
      if (wasRunning.current && !running) router.refresh();
      wasRunning.current = running;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Dashboard summary.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (!cancelled) await loadSummary();
      if (cancelled) return;
      timer = setTimeout(poll, runningRef.current ? 7_500 : 60_000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadSummary]);

  return (
    <>
      <DashboardToolbar onRefresh={() => void loadSummary({ manual: true })} refreshing={refreshing} summary={summary} />
      {loading && !summary ? <LoadingCards /> : error && !summary ? <ErrorCards error={error} /> : summary ? (
        <>
          <LibraryHealthCards summary={summary} />
          <div className={styles.compactCardsGrid}>
            <PlexSyncCard summary={summary} />
            <DataEnrichmentCard summary={summary} />
          </div>
          {error && <p className={styles.dashboardSummaryError}>{error}</p>}
        </>
      ) : null}
    </>
  );
}
