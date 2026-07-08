"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Activity, AlertTriangle, CheckCircle2, Clock3, RotateCcw } from "lucide-react";

type WorkerHealth = {
  status: string;
  version: string;
  workerCount: number;
  activeWorkerId: string | null;
  lastHeartbeat: string | null;
  heartbeatAgeSeconds: number | null;
  currentJob: null | {
    id?: string;
    name?: string;
    type?: string;
    phase?: string | null;
    currentItemLabel?: string | null;
    lastProgressAt?: string | null;
  };
  queueDepth: number;
  runningJobs: number;
  failedRecentJobs: number;
  staleJobs: number;
  activeLocks: Array<{ name: string; lockKey?: string; startedAt: string; phase?: string | null }>;
  lastCompletedJob: null | {
    name: string;
    status: string;
    finishedAt: string | null;
    summary: string | null;
  };
  lastError: string | null;
  scheduler: {
    enabled: boolean;
    cron: string | null;
    runtime?: { pipelineRunning?: boolean; schedulerEnabled?: boolean } | null;
    lastRecovery?: { requeued: number; interrupted: number; needsReview: number; blocked: number } | null;
  };
  diagnostics: {
    heartbeat: string;
    staleWorker: boolean;
    staleJobs: Array<{ id: string; name: string; recoveryHint: string }>;
  };
};

function formatRelativeSeconds(seconds: number | null | undefined) {
  if (seconds == null) return "Unknown";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "None";
  return new Date(value).toLocaleString();
}

function statusColor(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "stale" || normalized === "stopped") return "#ffb0b0";
  if (normalized === "processing" || normalized === "recovering") return "#b9e9ff";
  if (normalized === "idle" || normalized === "running") return "#5ee58a";
  return "var(--muted)";
}

export default function WorkerHealthCard({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [health, setHealth] = useState<WorkerHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [message, setMessage] = useState("");
  const previousBusy = useRef(false);
  const busyRef = useRef(false);

  const fetchHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/worker/health", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setHealth(data);
      const busy = ["processing", "recovering", "stale"].includes(String(data.status || "").toLowerCase()) || data.runningJobs > 0 || data.staleJobs > 0;
      busyRef.current = busy;
      if (previousBusy.current && !busy) router.refresh();
      previousBusy.current = busy;
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      await fetchHealth();
      if (cancelled) return;
      timer = setTimeout(poll, busyRef.current ? 10_000 : 45_000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchHealth]);

  async function recoverStaleJobs() {
    const confirmed = window.confirm("Recover stale jobs?\n\nMixarr will requeue safe interrupted enrichment jobs and mark unsafe jobs as interrupted.");
    if (!confirmed) return;
    setRecovering(true);
    setMessage("");
    try {
      const response = await fetch("/api/worker/recover-stale-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requeueSafe: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Recovery failed.");
      setMessage(data.message || "Recovery complete.");
      await fetchHealth();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Recovery failed.");
    } finally {
      setRecovering(false);
    }
  }

  if (loading && !health) {
    return (
      <section style={cardStyle} aria-label="Background Worker">
        <h3 style={titleStyle}><Activity size={18} /> Background Worker</h3>
        <p style={mutedStyle}>Loading worker status...</p>
      </section>
    );
  }

  if (!health) return null;
  const stale = health.status === "Stale" || health.staleJobs > 0 || health.diagnostics?.staleWorker;
  const currentJob = health.currentJob?.name || health.currentJob?.phase || "None";
  const lastCompleted = health.lastCompletedJob
    ? `${health.lastCompletedJob.name} · ${formatDate(health.lastCompletedJob.finishedAt)}`
    : "None";

  return (
    <section style={cardStyle} aria-label="Background Worker">
      <div style={headerStyle}>
        <h3 style={titleStyle}>
          {stale ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          Background Worker
        </h3>
        <span style={{ ...badgeStyle, color: statusColor(health.status), borderColor: `${statusColor(health.status)}55` }}>{health.status}</span>
      </div>

      {stale && (
        <div style={warningStyle}>
          Background worker heartbeat is stale. Jobs may not be processing.
        </div>
      )}

      <div style={gridStyle}>
        <div style={metricStyle}>
          <span>Last heartbeat</span>
          <strong>{formatRelativeSeconds(health.heartbeatAgeSeconds)}</strong>
        </div>
        <div style={metricStyle}>
          <span>Current job</span>
          <strong>{currentJob}</strong>
        </div>
        <div style={metricStyle}>
          <span>Queue</span>
          <strong>{health.queueDepth} pending</strong>
        </div>
        <div style={metricStyle}>
          <span>Running</span>
          <strong>{health.runningJobs}</strong>
        </div>
        <div style={metricStyle}>
          <span>Failed</span>
          <strong>{health.failedRecentJobs}</strong>
        </div>
        <div style={metricStyle}>
          <span>Stale</span>
          <strong>{health.staleJobs}</strong>
        </div>
      </div>

      {!compact && (
        <div style={detailsStyle}>
          <div><Clock3 size={14} /> Last completed: {lastCompleted}</div>
          <div>Scheduler: {health.scheduler.enabled ? "Enabled" : "Disabled"}{health.scheduler.cron ? ` · ${health.scheduler.cron}` : ""}</div>
          <div>Active locks: {health.activeLocks.length}</div>
          {health.lastError && <div style={{ color: "#ffb0b0" }}>Last error: {health.lastError}</div>}
          {health.scheduler.lastRecovery && (
            <div>
              Last recovery: requeued {health.scheduler.lastRecovery.requeued}, interrupted {health.scheduler.lastRecovery.interrupted}, review {health.scheduler.lastRecovery.needsReview}
            </div>
          )}
        </div>
      )}

      <div style={actionsStyle}>
        <button type="button" onClick={() => void fetchHealth()} style={secondaryButtonStyle}>
          <RotateCcw size={14} />
          Refresh
        </button>
        {(stale || health.staleJobs > 0) && (
          <button type="button" onClick={recoverStaleJobs} disabled={recovering} style={primaryButtonStyle}>
            <RotateCcw size={14} />
            {recovering ? "Recovering..." : "Recover stale jobs"}
          </button>
        )}
      </div>

      {message && <p style={messageStyle}>{message}</p>}
    </section>
  );
}

const cardStyle: CSSProperties = {
  padding: "1rem",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-lg)",
  background: "var(--panel)",
  boxShadow: "var(--shadow)",
  minWidth: 0,
  marginBottom: "1rem",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  marginBottom: "0.75rem",
};

const titleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  margin: 0,
  fontSize: "1rem",
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.28rem 0.5rem",
  border: "1px solid var(--line)",
  borderRadius: "999px",
  fontSize: "0.7rem",
  fontWeight: 800,
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  gap: "0.5rem",
};

const metricStyle: CSSProperties = {
  minWidth: 0,
  padding: "0.6rem",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-md)",
  background: "rgba(255,255,255,0.025)",
};

const detailsStyle: CSSProperties = {
  display: "grid",
  gap: "0.4rem",
  marginTop: "0.75rem",
  color: "var(--muted)",
  fontSize: "0.78rem",
  lineHeight: 1.45,
};

const actionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
  marginTop: "0.75rem",
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.4rem",
  border: 0,
  borderRadius: "var(--radius-sm)",
  background: "var(--accent)",
  color: "#fff",
  padding: "0.5rem 0.65rem",
  fontSize: "0.78rem",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  border: "1px solid var(--line)",
  background: "rgba(255,255,255,0.04)",
  color: "var(--fg)",
};

const warningStyle: CSSProperties = {
  marginBottom: "0.75rem",
  padding: "0.65rem 0.75rem",
  border: "1px solid rgba(215,91,91,0.28)",
  borderRadius: "var(--radius-md)",
  background: "rgba(215,91,91,0.09)",
  color: "#ffb0b0",
  fontSize: "0.8rem",
};

const mutedStyle: CSSProperties = {
  margin: 0,
  color: "var(--muted)",
  fontSize: "0.84rem",
};

const messageStyle: CSSProperties = {
  margin: "0.75rem 0 0",
  color: "var(--muted)",
  fontSize: "0.8rem",
};
