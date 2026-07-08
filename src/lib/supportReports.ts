import { APP_VERSION } from "./appVersion";
import { sanitizeErrorText } from "./supportRedaction";

type ReportContext = {
  route?: string | null;
  timestamp?: string | null;
  library?: { id?: string | null; name?: string | null } | null;
  recentJob?: {
    name?: string | null;
    type?: string | null;
    status?: string | null;
    summary?: string | null;
  } | null;
  worker?: {
    status?: string | null;
    runningJobs?: number | null;
    queueDepth?: number | null;
    staleJobs?: number | null;
  } | null;
};

function line(label: string, value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return `- ${label}: ${value}`;
}

function contextLines(context: ReportContext = {}) {
  return [
    line("Timestamp", context.timestamp || new Date().toISOString()),
    line("Page", context.route),
    context.library?.id || context.library?.name
      ? line("Selected library", `${context.library.name || "Unknown"} (${context.library.id || "no id"})`)
      : null,
    context.recentJob?.name || context.recentJob?.status
      ? line("Recent job", `${context.recentJob.name || context.recentJob.type || "Unknown"} - ${context.recentJob.status || "unknown"}${context.recentJob.summary ? ` - ${sanitizeErrorText(context.recentJob.summary, 260)}` : ""}`)
      : null,
    context.worker?.status
      ? line("Worker", `${context.worker.status} (running=${context.worker.runningJobs ?? 0}, queued=${context.worker.queueDepth ?? 0}, stale=${context.worker.staleJobs ?? 0})`)
      : null,
  ].filter(Boolean).join("\n");
}

export function buildBugReportTemplate(context: ReportContext = {}) {
  const extra = contextLines(context);
  return `## Mixarr Beta Bug Report

### Summary
Describe what happened.

### Expected Behavior
What did you expect Mixarr to do?

### Actual Behavior
What did Mixarr do instead?

### Steps to Reproduce
1.
2.
3.

### Mixarr Version
${APP_VERSION}

### Context
${extra || "- Timestamp: " + new Date().toISOString()}

### Page / Feature
Example: Library Health, Data Enrichment, Playlist Builder, Smart Builder, Plex Sync

### Recent Job
Paste recent job summary if relevant.

### Diagnostics
Attach exported diagnostics JSON if requested.

### Screenshots
Attach screenshots if helpful.

### Notes
Anything else that may help.
`;
}

export function buildFeedbackTemplate(context: ReportContext = {}) {
  const extra = contextLines(context);
  return `## Mixarr Beta Feedback

### What I like

### What feels confusing

### What I would improve

### Feature request

### Mixarr Version
${APP_VERSION}
${extra ? `\n### Context\n${extra}\n` : ""}
`;
}

type JobReportInput = {
  name?: string | null;
  type?: string | null;
  status?: string | null;
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
  durationMs?: number | null;
  attempted?: number | null;
  processed?: number | null;
  skipped?: number | null;
  failed?: number | null;
  summary?: string | null;
  error?: string | null;
  workerStatus?: string | null;
};

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "unknown";
  return value instanceof Date ? value.toISOString() : value;
}

function formatDuration(ms?: number | null) {
  if (ms == null) return "unknown";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function buildJobFailureReport(job: JobReportInput) {
  return `## Mixarr Job Failure Report

### Job
${job.name || job.type || "unknown"}

### Status
${job.status || "unknown"}

### Timing
- Started: ${formatDate(job.startedAt)}
- Completed: ${formatDate(job.finishedAt)}
- Duration: ${formatDuration(job.durationMs)}

### Summary
${job.summary || `Processed ${job.processed ?? 0} tracks, failed ${job.failed ?? 0}.`}

### Counts
- Attempted: ${job.attempted ?? 0}
- Processed: ${job.processed ?? 0}
- Skipped: ${job.skipped ?? 0}
- Failed: ${job.failed ?? 0}

### Error
${sanitizeErrorText(job.error) || "No error text recorded."}

### Version
${APP_VERSION}

### Worker
${job.workerStatus || "unknown"}
`;
}

type HealthReportInput = {
  activeTracks?: number | null;
  categories?: Record<string, number | null | undefined> | null;
  providerMode?: string | null;
  lastHealthRefresh?: string | null;
  workerStatus?: string | null;
};

export function buildHealthReport(input: HealthReportInput) {
  const categories = input.categories || {};
  return `## Mixarr Library Health Report

### Summary
- Active tracks: ${input.activeTracks ?? 0}
- Missing BPM: ${categories.missing_bpm ?? 0}
- Low confidence BPM: ${categories.low_confidence_bpm ?? 0}
- BPM conflicts: ${categories.bpm_source_conflict ?? 0}
- Missing audio features: ${categories.missing_audio_features ?? 0}
- Partial audio features: ${categories.partial_audio_features ?? 0}
- Pending audio features: ${categories.pending_audio_features ?? 0}
- Missing mood: ${categories.missing_mood ?? 0}
- Missing energy: ${categories.missing_energy ?? 0}
- Missing local files: ${categories.missing_local_file ?? 0}
- Failed analysis: ${categories.failed_analysis ?? 0}

### Runtime
- Worker: ${input.workerStatus || "unknown"}
- Last health refresh: ${input.lastHealthRefresh || "unknown"}
- Provider mode: ${input.providerMode || "unknown"}
- Version: ${APP_VERSION}
`;
}
