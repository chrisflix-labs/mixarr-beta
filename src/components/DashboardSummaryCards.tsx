"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, AudioWaveform, Database, HeartPulse, RefreshCw } from "lucide-react";
import styles from "@/app/page.module.css";
import type { DashboardSummary } from "@/lib/dashboardSummary";

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function percentage(complete: number, total: number) {
  if (total <= 0) return 0;
  const rawPercent = Math.max(0, Math.min(100, (complete / total) * 100));
  if (complete < total) return Math.min(99.9, Number(rawPercent.toFixed(1)));
  return Math.round(rawPercent);
}

function hasLiveWork(summary: DashboardSummary | null) {
  return !!summary && (
    summary.polling.active
    || Object.values(summary.dataEnrichment.running).some(Boolean)
    || summary.libraryHealth.status === "refreshing"
  );
}

function readiness(summary: DashboardSummary) {
  const health = summary.libraryHealth;
  if (hasLiveWork(summary)) return { label: "Analysis running", status: "running" };
  if (health.status === "failed" || health.status === "stale") return { label: "Attention required", status: "error" };
  if (health.activeTracks === 0 || !summary.plexSync.lastJob) return { label: "Sync recommended", status: "warning" };
  const coverage = [
    summary.dataEnrichment.bpmComplete,
    summary.dataEnrichment.audioComplete,
    summary.dataEnrichment.genresComplete,
    summary.dataEnrichment.popularityComplete,
  ];
  if (coverage.some((value) => value < health.activeTracks)) return { label: "Enrichment incomplete", status: "warning" };
  if (health.status === "needs_attention") return { label: "Attention required", status: "error" };
  return { label: "Ready", status: "ready" };
}

function LoadingState() {
  return (
    <article className={`${styles.readinessPanel} ${styles.skeletonPanel}`} aria-busy="true">
      <div className={styles.readinessHeading}><HeartPulse size={22} /><div><h3>Library Readiness</h3><p>Loading library status…</p></div></div>
      <div className={styles.coverageGrid}>{["BPM", "Audio features", "Genres", "Popularity"].map((label) => <div key={label} className={styles.coverageMetric}><span>{label}</span><b>—</b><i /></div>)}</div>
    </article>
  );
}

export default function DashboardSummaryCards({ initialSummary }: { initialSummary: DashboardSummary | null }) {
  const [summary, setSummary] = useState<DashboardSummary | null>(initialSummary);
  const [loading, setLoading] = useState(!initialSummary);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/dashboard/summary", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load dashboard summary.");
      setSummary(data);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load dashboard summary.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!initialSummary) void loadSummary();
  }, [initialSummary, loadSummary]);

  useEffect(() => {
    if (!summary || !hasLiveWork(summary)) return;
    const timer = setTimeout(() => void loadSummary(), 7_500);
    return () => clearTimeout(timer);
  }, [loadSummary, summary]);

  if (loading && !summary) return <LoadingState />;

  if (!summary) {
    return (
      <article className={`${styles.readinessPanel} ${styles.widgetError}`} role="status">
        <div className={styles.readinessHeading}><HeartPulse size={22} /><div><h3>Library Readiness</h3><p>{error || "Library summary is unavailable."}</p></div></div>
        <div className={styles.inlineActions}><Link href="/library-health" className={styles.secondaryAction}>Open Diagnostics</Link><button type="button" onClick={() => void loadSummary(true)}>Try Again</button></div>
      </article>
    );
  }

  const state = readiness(summary);
  const total = summary.libraryHealth.activeTracks;
  const metrics = [
    { label: "BPM", value: summary.dataEnrichment.bpmComplete, href: "/library-health?filter=missing_bpm" },
    { label: "Audio features", value: summary.dataEnrichment.audioComplete, href: "/library-health?filter=missing_audio_features" },
    { label: "Genres", value: summary.dataEnrichment.genresComplete, href: "/data-enrichment" },
    { label: "Popularity", value: summary.dataEnrichment.popularityComplete, href: "/data-enrichment" },
  ];

  return (
    <article className={styles.readinessPanel}>
      <div className={styles.readinessTopline}>
        <div className={styles.readinessHeading}>
          <HeartPulse size={22} />
          <div><h3>Library Readiness</h3><p>{summary.libraryHealth.message}</p></div>
        </div>
        <span className={styles.statusBadge} data-status={state.status}>{state.label}</span>
      </div>

      <div className={styles.readinessSummary}>
        <div><Database size={17} /><span>Plex sync</span><b>{summary.plexSync.lastJob ? summary.plexSync.lastJob.status.replaceAll("_", " ") : "Not run"}</b></div>
        <div><AudioWaveform size={17} /><span>Active tracks</span><b>{formatNumber(total)}</b></div>
        <div><Activity size={17} /><span>Last successful sync</span><b>{formatDate(summary.libraryHealth.lastSyncAt)}</b></div>
      </div>

      <div className={styles.coverageGrid}>
        {metrics.map((metric) => {
          const percent = percentage(metric.value, total);
          return (
            <Link key={metric.label} href={metric.href} className={styles.coverageMetric} aria-label={`${metric.label} coverage ${percent}%`}>
              <span>{metric.label}</span><b>{percent}%</b>
              <i aria-hidden="true"><em style={{ width: `${percent}%` }} /></i>
            </Link>
          );
        })}
      </div>

      <div className={styles.readinessFooter}>
        <span>Updated {formatDate(summary.loadedAt)}{error ? ` · ${error}` : ""}</span>
        <div className={styles.inlineActions}>
          <a href="#plex-servers" className={styles.primaryAction}>Start Sync</a>
          <Link href="/data-enrichment" className={styles.secondaryAction}>Manage Enrichment</Link>
          <Link href="/library-health" className={styles.secondaryAction}>Open Diagnostics</Link>
          <button type="button" className={styles.iconAction} onClick={() => void loadSummary(true)} disabled={refreshing} aria-label="Refresh library readiness"><RefreshCw size={15} className={refreshing ? "animate-spin" : undefined} /> Refresh</button>
        </div>
      </div>
    </article>
  );
}
