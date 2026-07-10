"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, HeartPulse, Loader2, RefreshCw, Settings, X } from "lucide-react";
import WorkerHealthCard from "@/components/WorkerHealthCard";
import CopySupportButton from "@/components/CopySupportButton";
import styles from "./library-health.module.css";

type Category =
  | "all_tracks"
  | "missing_bpm"
  | "api_bpm"
  | "local_bpm"
  | "imported_bpm"
  | "pending_bpm"
  | "low_confidence_bpm"
  | "bpm_source_conflict"
  | "missing_audio_features"
  | "partial_audio_features"
  | "pending_audio_features"
  | "complete_audio_features"
  | "missing_mood"
  | "missing_energy"
  | "missing_mood_energy"
  | "partial_mood_energy"
  | "complete_mood_energy"
  | "pending_mood_energy"
  | "mood_energy_failed"
  | "failed_analysis"
  | "failed_bpm_analysis"
  | "failed_audio_feature_analysis"
  | "missing_from_plex"
  | "duplicate_candidates"
  | "match_conflicts"
  | "recently_added_tracks"
  | "recently_updated_tracks"
  | "moved_files"
  | "renamed_tracks"
  | "too_short"
  | "skipped"
  | "healthy_tracks";

type LibraryOption = { id: string; name: string; server: { id: string; name: string } };
type AudioFeatureGapAudit = {
  incompleteExpected: number;
  unclassifiedGap: number;
  classifiedAsMissing: number;
  noAudioFeatureRecord: number;
  gapDetected: boolean;
};
type HealthAccuracyDiagnostics = {
  ok: boolean;
  providerMode: { audio: string };
  invariants: Array<{
    section: string;
    ok: boolean;
    message: string;
    counts: Record<string, number>;
  }>;
  mismatches: Array<{ category: string; cardCount: number; detailCount: number }>;
  lastAudioFeatureRetry?: {
    filter: string | null;
    mode: string | null;
    providerMode: string | null;
    matched: number | null;
    queued: number | null;
    skipped: number | null;
    processed: number | null;
    failed: number | null;
    completedAt: string | null;
  } | null;
  localAnalysisDiagnostics?: {
    analyzer: string;
    analyzerAvailable: boolean | null;
    localEnabled: boolean;
    scope: string;
    scopeLabel: string;
    lastRunAt: string | null;
    matched: number | null;
    processed: number | null;
    skipped: number | null;
    failed: number | null;
    skipReasons: Record<string, number>;
  };
  plexSyncDiagnostics?: {
    lastSyncTime: string | null;
    lastStatus: string;
    lastScannedCount: number | null;
    activeTrackCount: number;
    missingFromPlexCount: number;
    duplicateCandidateCount: number;
    matchConflictCount: number;
    lastError: string | null;
    summary: string | null;
  };
};
type Summary = {
  totalTracks: number;
  categories: Partial<Record<Category, number>>;
  libraries: LibraryOption[];
  audioFeatureProviderLabel?: string;
  audioFeatureGapAudit?: AudioFeatureGapAudit;
  diagnostics?: HealthAccuracyDiagnostics;
};
type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  library: { id: string; name: string };
  ratingKey: string;
  duration: number | null;
  mediaPath: string | null;
  bpm: number | null;
  apiBpm: number | null;
  localBpm: number | null;
  importedBpm: number | null;
  bpmSource: string | null;
  bpmSourceKey?: string | null;
  bpmConfidence?: string | null;
  bpmConfidenceValue?: number | null;
  bpmConflictStatus?: string | null;
  bpmConflictReason?: string | null;
  bpmReason?: string | null;
  energy: number | null;
  mood: number | null;
  energySource?: string | null;
  energyConfidence?: string | null;
  moodSource?: string | null;
  moodConfidence?: string | null;
  moodEnergyStatus?: string | null;
  danceability: number | null;
  audioFeatureStatus: string;
  audioFeatureSource?: string | null;
  audioFeatureAnalysisScope?: string | null;
  audioFeatureConfidence?: number | null;
  lastAnalyzed: string | null;
  failureReason: string | null;
  reason: string;
};

const categoryLabels: Record<Category, string> = {
  all_tracks: "All Tracks",
  missing_bpm: "Missing BPM",
  api_bpm: "API BPM Only",
  local_bpm: "Local BPM Available",
  imported_bpm: "Imported BPM",
  pending_bpm: "Pending BPM",
  low_confidence_bpm: "Low Confidence BPM",
  bpm_source_conflict: "BPM Source Conflicts",
  missing_audio_features: "Missing Audio Features",
  partial_audio_features: "Partial Audio Features",
  pending_audio_features: "Pending Audio Features",
  complete_audio_features: "Complete Audio Features",
  missing_mood: "Missing Mood",
  missing_energy: "Missing Energy",
  missing_mood_energy: "Missing Mood & Energy",
  partial_mood_energy: "Partial Mood/Energy",
  complete_mood_energy: "Complete Mood/Energy",
  pending_mood_energy: "Pending Mood/Energy Analysis",
  mood_energy_failed: "Mood/Energy Failed",
  failed_analysis: "Failed Analysis",
  failed_bpm_analysis: "Failed BPM Analysis",
  failed_audio_feature_analysis: "Failed Audio Feature Analysis",
  missing_from_plex: "Missing from Plex",
  duplicate_candidates: "Duplicate Candidates",
  match_conflicts: "Match Conflicts",
  recently_added_tracks: "Recently Added Tracks",
  recently_updated_tracks: "Recently Updated Tracks",
  moved_files: "Moved Files",
  renamed_tracks: "Renamed Tracks",
  too_short: "Too Short To Analyze",
  skipped: "Skipped",
  healthy_tracks: "Healthy Tracks",
};

const emptyMessages: Record<Category, string> = {
  all_tracks: "No active tracks found.",
  missing_bpm: "No tracks are missing BPM. Nice!",
  api_bpm: "No tracks are relying on API-only BPM.",
  local_bpm: "No tracks have locally analyzed BPM yet.",
  imported_bpm: "No tracks are relying on imported BPM.",
  pending_bpm: "No tracks are pending BPM analysis.",
  low_confidence_bpm: "No low-confidence BPM values found.",
  bpm_source_conflict: "No BPM source conflicts found.",
  missing_audio_features: "No tracks are missing required audio features for the current provider mode.",
  partial_audio_features: "No tracks have partial audio feature data.",
  pending_audio_features: "No tracks are pending audio feature analysis.",
  complete_audio_features: "No tracks have complete audio features yet.",
  missing_mood: "No tracks are missing mood values.",
  missing_energy: "No tracks are missing energy values.",
  missing_mood_energy: "No tracks are missing both mood and energy values.",
  partial_mood_energy: "No tracks have partial mood/energy data.",
  complete_mood_energy: "No tracks have complete mood/energy data yet.",
  pending_mood_energy: "No tracks are pending mood/energy analysis.",
  mood_energy_failed: "No mood/energy analysis failures found.",
  failed_analysis: "No failed analysis jobs found.",
  failed_bpm_analysis: "No failed BPM analysis jobs found.",
  failed_audio_feature_analysis: "No failed audio feature analysis jobs found.",
  missing_from_plex: "No tracks are missing from Plex.",
  duplicate_candidates: "No duplicate candidates found.",
  match_conflicts: "No match conflicts found.",
  recently_added_tracks: "No recently added tracks from the latest sync.",
  recently_updated_tracks: "No recently updated tracks from the latest sync.",
  moved_files: "No moved files from the latest sync.",
  renamed_tracks: "No renamed tracks from the latest sync.",
  too_short: "No tracks are too short to analyze.",
  skipped: "No skipped analysis tracks found.",
  healthy_tracks: "No fully healthy tracks found yet.",
};

const categoryOrder: Category[] = [
  "all_tracks",
  "missing_bpm",
  "api_bpm",
  "local_bpm",
  "imported_bpm",
  "pending_bpm",
  "low_confidence_bpm",
  "bpm_source_conflict",
  "missing_audio_features",
  "partial_audio_features",
  "pending_audio_features",
  "missing_mood",
  "missing_energy",
  "missing_mood_energy",
  "partial_mood_energy",
  "complete_mood_energy",
  "pending_mood_energy",
  "mood_energy_failed",
  "failed_analysis",
  "failed_bpm_analysis",
  "failed_audio_feature_analysis",
  "missing_from_plex",
  "duplicate_candidates",
  "match_conflicts",
  "recently_added_tracks",
  "recently_updated_tracks",
  "moved_files",
  "renamed_tracks",
  "too_short",
  "skipped",
  "complete_audio_features",
];

const actionableCategories: Category[] = [
  "missing_bpm",
  "api_bpm",
  "missing_audio_features",
  "partial_audio_features",
  "pending_audio_features",
  "complete_audio_features",
  "missing_mood",
  "missing_energy",
  "missing_mood_energy",
  "partial_mood_energy",
  "pending_mood_energy",
  "mood_energy_failed",
  "failed_bpm_analysis",
  "failed_audio_feature_analysis",
  "too_short",
  "skipped",
];

type AudioRetryMode = "configured_providers" | "api_only" | "local_only" | "force_local_reprocess";

type AudioRetryResult = {
  filter: string;
  mode: AudioRetryMode;
  providerMode: string;
  matched: number;
  eligible: number;
  queued: number;
  skipped: number;
  processed?: number;
  failed?: number;
  skipReasons: Record<string, number>;
  skipReasonLabels?: Record<string, string>;
  summary: string;
  message?: string;
  disabledReason?: string | null;
  canRun?: boolean;
  analyzer?: string;
  analysisScope?: string;
  analysisScopeLabel?: string;
  expectedAction?: string;
  jobId?: string | null;
};

type LocalAnalysisProgress = {
  running?: boolean;
  analyzer?: string;
  scopeLabel?: string;
  providerMode?: string;
  matched?: number;
  eligible?: number;
  processed?: number;
  skipped?: number;
  failed?: number;
  remaining?: number;
  elapsedSeconds?: number;
  updatedAt?: string;
};

const defaultFilters = {
  libraryId: "",
  search: "",
  artist: "",
  album: "",
  bpmSource: "all",
  bpmConfidence: "all",
  bpmConflict: "all",
  apiImportedOnly: false,
  noLocalBpm: false,
  audioFeatureStatus: "all",
  failedOnly: false,
  missingDataOnly: false,
  sort: "",
  direction: "desc",
};

function isCategory(value: string | null): value is Category {
  return !!value && Object.prototype.hasOwnProperty.call(categoryLabels, value);
}

function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatDuration(value: number | null) {
  if (!value) return "-";
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatDecimal(value: number | null) {
  return value === null ? "-" : value.toFixed(2);
}

function formatScope(value?: string | null) {
  if (value === "whole_track") return "Whole track";
  if (value === "windows") return "Sample window";
  return "-";
}

function retryTypeFor(category: Category): "bpm" | "audio_features" {
  return category === "missing_audio_features" || category === "partial_audio_features" || category === "pending_audio_features" || category === "complete_audio_features" || category === "failed_audio_feature_analysis"
    || category === "missing_mood" || category === "missing_energy" || category === "missing_mood_energy" || category === "partial_mood_energy" || category === "pending_mood_energy" || category === "mood_energy_failed"
    ? "audio_features"
    : "bpm";
}

function isAudioRetryCategory(category: Category) {
  return retryTypeFor(category) === "audio_features";
}

function formatSkipReasons(reasons: Record<string, number> | undefined) {
  const entries = Object.entries(reasons || {}).filter(([, value]) => value > 0);
  return entries.map(([reason, value]) => `${reason.replace(/_/g, " ")}=${formatNumber(value)}`).join(", ");
}

function formatLabeledSkipReasons(reasons: Record<string, number> | undefined, labels?: Record<string, string>) {
  const entries = Object.entries(reasons || {}).filter(([, value]) => value > 0);
  return entries.map(([reason, value]) => `${labels?.[reason] || reason.replace(/_/g, " ")}=${formatNumber(value)}`).join(", ");
}

function formatElapsed(seconds?: number) {
  if (!seconds) return "-";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export default function LibraryHealthDetailsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [category, setCategory] = useState<Category>("missing_bpm");
  const [filters, setFilters] = useState(defaultFilters);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [countDetailMismatch, setCountDetailMismatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localProgress, setLocalProgress] = useState<LocalAnalysisProgress | null>(null);

  const selectedCount = selected.size;
  const allVisibleSelected = tracks.length > 0 && tracks.every((track) => selected.has(track.id));
  const healthSupportQuery = filters.libraryId ? `?libraryId=${encodeURIComponent(filters.libraryId)}` : "";

  const buildParams = useCallback((requestedPage: number, requestedCategory = category) => {
    const params = new URLSearchParams({ filter: requestedCategory, page: String(requestedPage), pageSize: "50" });
    Object.entries(filters).forEach(([key, value]) => {
      if (typeof value === "boolean") {
        if (value) params.set(key, "true");
      } else if (value && value !== "all") {
        params.set(key, value);
      }
    });
    return params;
  }, [category, filters]);

  const syncUrl = useCallback((requestedCategory: Category, requestedPage: number) => {
    const params = buildParams(requestedPage, requestedCategory);
    const visible = new URLSearchParams(params);
    if (requestedPage <= 1) visible.delete("page");
    window.history.replaceState({}, "", `/library-health?${visible.toString()}`);
  }, [buildParams]);

  const loadSummary = useCallback(async (libraryId = filters.libraryId) => {
    const params = new URLSearchParams();
    if (libraryId) params.set("libraryId", libraryId);
    const response = await fetch(`/api/library-health/summary?${params}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load Library Health details. Check logs or try again.");
    setSummary(data);
  }, [filters.libraryId]);

  const loadTracks = useCallback(async (requestedCategory = category, requestedPage = page) => {
    setTracksLoading(true);
    setTracksError(null);
    setError(null);
    try {
      const response = await fetch(`/api/library-health/tracks?${buildParams(requestedPage, requestedCategory)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load Library Health details. Check logs or try again.");
      setTracks(data.items || data.tracks || []);
      setPagination({ page: data.page, pageSize: data.pageSize, total: data.total, totalPages: data.totalPages });
      setCountDetailMismatch(!!data.countDetailMismatch);
      setSelected(new Set());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to load Library Health details. Retry or check the server logs.";
      setTracksError(message);
      setError(message);
    } finally {
      setTracksLoading(false);
    }
  }, [buildParams, category, page]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextCategory = isCategory(params.get("filter") || params.get("category")) ? (params.get("filter") || params.get("category")) as Category : "missing_bpm";
    const nextFilters = {
      ...defaultFilters,
      libraryId: params.get("libraryId") || "",
      search: params.get("search") || "",
      artist: params.get("artist") || "",
      album: params.get("album") || "",
      bpmSource: params.get("bpmSource") || "all",
      bpmConfidence: params.get("bpmConfidence") || "all",
      bpmConflict: params.get("bpmConflict") || "all",
      apiImportedOnly: params.get("apiImportedOnly") === "true",
      noLocalBpm: params.get("noLocalBpm") === "true",
      audioFeatureStatus: params.get("audioFeatureStatus") || "all",
      failedOnly: params.get("failedOnly") === "true",
      missingDataOnly: params.get("missingDataOnly") === "true",
      sort: params.get("sort") || "",
      direction: params.get("direction") || "desc",
    };
    const initialPage = Math.max(1, Number(params.get("page")) || 1);
    setCategory(nextCategory);
    setFilters(nextFilters);
    setPage(initialPage);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (loading) return;
    void loadSummary().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load Library Health details. Check logs or try again."));
    void loadTracks(category, page);
  }, [loading, category, page, loadSummary, loadTracks]);

  useEffect(() => {
    let cancelled = false;
    async function pollProgress() {
      try {
        const response = await fetch("/api/sync/status", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || cancelled) return;
        const lastRun = data?.audioFeatures?.lastRun;
        const progress = lastRun?.progress;
        if (lastRun?.running && progress?.phase === "local_audio_analysis") {
          setLocalProgress({ running: true, ...progress });
        } else if (progress?.phase === "local_audio_analysis") {
          setLocalProgress({ running: false, ...progress });
        } else if (!lastRun?.running) {
          setLocalProgress(null);
        }
      } catch {
        // Status polling is best-effort; the retry result and Job History remain the source of record.
      }
    }
    void pollProgress();
    const interval = window.setInterval(() => void pollProgress(), working ? 5000 : 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [working]);

  const cards = useMemo(() => {
    const counts = summary?.categories;
    const syncCardKeys = new Set(["missing_from_plex", "duplicate_candidates", "match_conflicts", "recently_added_tracks", "recently_updated_tracks", "moved_files", "renamed_tracks"]);
    return [
      { key: "total", label: "Total Tracks", count: summary?.totalTracks || 0, category: "all_tracks" as Category },
      { key: "missing_from_plex", label: "Missing from Plex", count: counts?.missing_from_plex || 0, category: "missing_from_plex" as Category },
      { key: "duplicate_candidates", label: "Duplicate Candidates", count: counts?.duplicate_candidates || 0, category: "duplicate_candidates" as Category },
      { key: "match_conflicts", label: "Match Conflicts", count: counts?.match_conflicts || 0, category: "match_conflicts" as Category },
      { key: "moved_files", label: "Moved Files", count: counts?.moved_files || 0, category: "moved_files" as Category },
      { key: "renamed_tracks", label: "Renamed Tracks", count: counts?.renamed_tracks || 0, category: "renamed_tracks" as Category },
      { key: "recently_added_tracks", label: "Recently Added", count: counts?.recently_added_tracks || 0, category: "recently_added_tracks" as Category },
      { key: "recently_updated_tracks", label: "Recently Updated", count: counts?.recently_updated_tracks || 0, category: "recently_updated_tracks" as Category },
      { key: "missing_bpm", label: "Missing BPM", count: counts?.missing_bpm || 0, category: "missing_bpm" as Category },
      { key: "api_bpm", label: "API BPM Only", count: counts?.api_bpm || 0, category: "api_bpm" as Category },
      { key: "local_bpm", label: "Local BPM", count: counts?.local_bpm || 0, category: "local_bpm" as Category },
      { key: "imported_bpm", label: "Imported BPM", count: counts?.imported_bpm || 0, category: "imported_bpm" as Category },
      { key: "low_confidence_bpm", label: "Low Confidence BPM", count: counts?.low_confidence_bpm || 0, category: "low_confidence_bpm" as Category },
      { key: "bpm_source_conflict", label: "BPM Source Conflicts", count: counts?.bpm_source_conflict || 0, category: "bpm_source_conflict" as Category },
      { key: "pending_bpm", label: "Pending BPM", count: counts?.pending_bpm || 0, category: "pending_bpm" as Category },
      { key: "missing_audio_features", label: "Missing Audio Features", count: counts?.missing_audio_features || 0, category: "missing_audio_features" as Category },
      { key: "partial_audio_features", label: "Partial Audio Features", count: counts?.partial_audio_features || 0, category: "partial_audio_features" as Category },
      { key: "pending_audio_features", label: "Pending Audio Features", count: counts?.pending_audio_features || 0, category: "pending_audio_features" as Category },
      { key: "missing_mood", label: "Missing Mood", count: counts?.missing_mood || 0, category: "missing_mood" as Category },
      { key: "missing_energy", label: "Missing Energy", count: counts?.missing_energy || 0, category: "missing_energy" as Category },
      { key: "missing_mood_energy", label: "Missing Mood & Energy", count: counts?.missing_mood_energy || 0, category: "missing_mood_energy" as Category },
      { key: "partial_mood_energy", label: "Partial Mood/Energy", count: counts?.partial_mood_energy || 0, category: "partial_mood_energy" as Category },
      { key: "complete_mood_energy", label: "Complete Mood/Energy", count: counts?.complete_mood_energy || 0, category: "complete_mood_energy" as Category },
      { key: "pending_mood_energy", label: "Pending Mood/Energy", count: counts?.pending_mood_energy || 0, category: "pending_mood_energy" as Category },
      { key: "mood_energy_failed", label: "Mood/Energy Failed", count: counts?.mood_energy_failed || 0, category: "mood_energy_failed" as Category },
      { key: "failed", label: "Failed Analysis", count: counts?.failed_analysis || 0, category: "failed_analysis" as Category },
    ].filter((card) => !syncCardKeys.has(card.key) || card.count > 0);
  }, [summary]);

  function updateCategory(nextCategory: Category) {
    setCategory(nextCategory);
    setPage(1);
    setMessage(null);
    syncUrl(nextCategory, 1);
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setMessage(null);
    syncUrl(category, 1);
    void loadSummary();
    void loadTracks(category, 1);
  }

  async function retryTracks(trackIds?: string[], mode: AudioRetryMode = "configured_providers") {
    const workingKey = trackIds?.length ? `selected-${mode}` : `filter-${mode}`;
    setWorking(workingKey);
    setError(null);
    setMessage(null);
    try {
      if (isAudioRetryCategory(category)) {
        const payload = {
          filter: trackIds?.length ? undefined : category,
          trackIds,
          libraryId: filters.libraryId || undefined,
          mode,
          force: mode === "force_local_reprocess",
        };
        const preflightResponse = await fetch("/api/library-health/audio-features/retry/preflight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const preflight: AudioRetryResult = await preflightResponse.json();
        if (!preflightResponse.ok) throw new Error((preflight as any).error || "Failed to preflight audio-feature retry");
        if (!preflight.canRun) {
          setMessage(preflight.disabledReason || preflight.summary || "No eligible audio-feature tracks were found.");
          return;
        }
        const localMode = mode === "local_only" || mode === "force_local_reprocess";
        if (preflight.skipped > 0 || localMode) {
          const skipped = formatLabeledSkipReasons(preflight.skipReasons, preflight.skipReasonLabels);
          const heading = mode === "force_local_reprocess"
            ? `Force local reprocess for ${formatNumber(preflight.matched)} track${preflight.matched === 1 ? "" : "s"}?`
            : localMode
              ? "Local analysis preflight"
              : `Retry ${formatNumber(preflight.matched)} ${categoryLabels[category]} track${preflight.matched === 1 ? "" : "s"}?`;
          const confirmed = window.confirm(
            `${heading}\n\nMatched: ${formatNumber(preflight.matched)}\nEligible: ${formatNumber(preflight.eligible)}\nSkipped: ${formatNumber(preflight.skipped)}${skipped ? `\nSkipped reasons: ${skipped}` : ""}\nAnalyzer: ${preflight.analyzer || "Essentia"}\nScope: ${preflight.analysisScopeLabel || "Sample window"}\nProvider mode: ${preflight.providerMode}\n\n${preflight.expectedAction || "Queue eligible tracks."}`,
          );
          if (!confirmed) return;
        }

        const retryResponse = await fetch("/api/library-health/audio-features/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data: AudioRetryResult = await retryResponse.json();
        if (!retryResponse.ok) throw new Error((data as any).error || "Failed to queue audio-feature retry");
        let suffix = "";
        if (data.queued > 0) {
          setLocalProgress((current) => mode === "local_only" || mode === "force_local_reprocess"
            ? {
              ...current,
              running: true,
              analyzer: data.analyzer || "Essentia",
              scopeLabel: data.analysisScopeLabel || "Sample window",
              providerMode: data.providerMode,
              matched: data.matched,
              eligible: data.eligible,
              processed: 0,
              skipped: data.skipped,
              failed: 0,
              remaining: data.queued,
            }
            : current);
          const startResponse = await fetch("/api/audio-features/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode, providerMode: mode, force: mode === "force_local_reprocess" }),
          });
          const startData = await startResponse.json().catch(() => ({}));
          suffix = startData?.status === "already_running"
            ? " The audio-feature analyzer is already running."
            : " Audio-feature analysis started.";
          window.setTimeout(() => { void loadSummary(); void loadTracks(category, page); }, 5000);
          window.setTimeout(() => { void loadSummary(); void loadTracks(category, page); }, 20000);
        }
        setMessage(`${data.message || data.summary || `Queued ${data.queued || 0} audio-feature retry jobs.`}${suffix}`);
        await Promise.all([loadSummary(), loadTracks(category, page)]);
        return;
      }

      const response = await fetch("/api/library-health/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          retryType: retryTypeFor(category),
          libraryId: filters.libraryId || undefined,
          trackIds,
          providerMode: "configured",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to queue Library Health retry");
      setMessage(data.summary || data.message || `Queued ${data.queued || 0} tracks.`);
      await Promise.all([loadSummary(), loadTracks(category, page)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to queue Library Health retry");
    } finally {
      setWorking(null);
    }
  }

  const canRetry = actionableCategories.includes(category);
  const canAudioRetry = canRetry && isAudioRetryCategory(category);
  const activeCardCount = summary?.categories?.[category] ?? (category === "all_tracks" ? summary?.totalTracks ?? 0 : 0);
  const configuredProviderLabel = summary?.audioFeatureProviderLabel || "Configured providers";
  const audioApiEnabled = configuredProviderLabel.includes("API");
  const audioLocalEnabled = configuredProviderLabel.includes("Local");
  const retryableFilterCount = canAudioRetry ? activeCardCount : pagination.total;
  const hasNarrowingFilters = !!(
    filters.search
    || filters.artist
    || filters.album
    || filters.bpmSource !== "all"
    || filters.bpmConfidence !== "all"
    || filters.bpmConflict !== "all"
    || filters.apiImportedOnly
    || filters.noLocalBpm
    || filters.audioFeatureStatus !== "all"
    || filters.failedOnly
    || filters.missingDataOnly
  );
  const detailMismatch = !tracksLoading && !tracksError && !hasNarrowingFilters && (countDetailMismatch || (pagination.total !== activeCardCount && activeCardCount > 0));
  const emptyMessage = isAudioRetryCategory(category) && tracks.length === 0
    ? "No tracks match this audio-feature health filter."
    : filters.search || filters.artist || filters.album ? "No tracks match this Library Health filter." : emptyMessages[category];

  if (loading) {
    return <main className={styles.page}><div className={`glass-panel ${styles.loading}`}><Loader2 className="animate-spin" size={18} /> Loading Library Health details...</div></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h2><HeartPulse size={24} /> Library Health Details</h2>
          <p>Inspect affected tracks, reasons, status fields, and retry options.</p>
        </div>
        <Link href="/settings/library-health" className={styles.settingsLink}><Settings size={15} /> Maintenance Tools</Link>
      </header>

      <WorkerHealthCard compact />

      {summary && summary.totalTracks === 0 && (
        <div className={`glass-panel ${styles.empty}`}>Library Health data is not available yet. Run a library sync or audio analysis job first.</div>
      )}

      {summary && (summary.categories.partial_audio_features || 0) > 0 && (summary.categories.pending_audio_features || 0) > 0 && (
        <div className={styles.message}>
          Audio feature gap detected: {formatNumber(summary.categories.partial_audio_features)} active tracks have partial audio feature data and need local audio feature processing.
        </div>
      )}

      <section className={styles.summaryGrid} aria-label="Library Health summary">
        {cards.map((card) => (
          <button key={card.key} className={`${styles.summaryCard} ${category === card.category ? styles.summaryCardActive : ""}`} type="button" onClick={() => updateCategory(card.category)}>
            <span>{card.label}</span>
            <strong>{formatNumber(card.count)}</strong>
            <small>{card.key === "total" ? "Active library tracks" : "Open filtered track list"}</small>
          </button>
        ))}
      </section>

      {summary?.diagnostics && (
        <details className={`glass-panel ${styles.diagnostics}`}>
          <summary>
            <span>Health Accuracy Diagnostics</span>
            <b className={summary.diagnostics.ok ? styles.okText : styles.badText}>{summary.diagnostics.ok ? "OK" : "Mismatch detected"}</b>
          </summary>
          <div className={styles.diagnosticRows}>
            {summary.diagnostics.invariants.map((entry) => (
              <div key={entry.section}>
                <span>{entry.section}: {entry.ok ? "OK" : "Mismatch detected"}</span>
                {!entry.ok && <small>{Object.entries(entry.counts).map(([key, value]) => `${key}: ${formatNumber(value)}`).join(" | ")}</small>}
              </div>
            ))}
            {summary.diagnostics.lastAudioFeatureRetry && (
              <div>
                <span>Last audio feature retry: {summary.diagnostics.lastAudioFeatureRetry.filter || "selected_tracks"}</span>
                <small>
                  matched: {formatNumber(summary.diagnostics.lastAudioFeatureRetry.matched)} | queued: {formatNumber(summary.diagnostics.lastAudioFeatureRetry.queued)} | skipped: {formatNumber(summary.diagnostics.lastAudioFeatureRetry.skipped)} | processed: {formatNumber(summary.diagnostics.lastAudioFeatureRetry.processed)} | failed: {formatNumber(summary.diagnostics.lastAudioFeatureRetry.failed)} | completed: {formatDate(summary.diagnostics.lastAudioFeatureRetry.completedAt)}
                </small>
              </div>
            )}
            {summary.diagnostics.localAnalysisDiagnostics && (
              <div>
                <span>Local analysis diagnostics: {summary.diagnostics.localAnalysisDiagnostics.analyzer} {summary.diagnostics.localAnalysisDiagnostics.analyzerAvailable === null ? "availability not checked" : summary.diagnostics.localAnalysisDiagnostics.analyzerAvailable ? "available" : "unavailable"} | {summary.diagnostics.localAnalysisDiagnostics.scopeLabel}</span>
                <small>
                  last run: {formatNumber(summary.diagnostics.localAnalysisDiagnostics.matched)} matched | {formatNumber(summary.diagnostics.localAnalysisDiagnostics.processed)} processed | {formatNumber(summary.diagnostics.localAnalysisDiagnostics.skipped)} skipped | {formatNumber(summary.diagnostics.localAnalysisDiagnostics.failed)} failed | completed: {formatDate(summary.diagnostics.localAnalysisDiagnostics.lastRunAt)}
                  {Object.keys(summary.diagnostics.localAnalysisDiagnostics.skipReasons || {}).length ? ` | skipped: ${formatSkipReasons(summary.diagnostics.localAnalysisDiagnostics.skipReasons)}` : ""}
                </small>
              </div>
            )}
            {summary.diagnostics.plexSyncDiagnostics && (
              <div>
                <span>Plex Sync Diagnostics: {summary.diagnostics.plexSyncDiagnostics.lastStatus}</span>
                <small>
                  last sync: {formatDate(summary.diagnostics.plexSyncDiagnostics.lastSyncTime)} | scanned: {formatNumber(summary.diagnostics.plexSyncDiagnostics.lastScannedCount)} | active: {formatNumber(summary.diagnostics.plexSyncDiagnostics.activeTrackCount)} | missing from Plex: {formatNumber(summary.diagnostics.plexSyncDiagnostics.missingFromPlexCount)} | duplicates: {formatNumber(summary.diagnostics.plexSyncDiagnostics.duplicateCandidateCount)} | conflicts: {formatNumber(summary.diagnostics.plexSyncDiagnostics.matchConflictCount)}
                  {summary.diagnostics.plexSyncDiagnostics.lastError ? ` | last error: ${summary.diagnostics.plexSyncDiagnostics.lastError}` : ""}
                </small>
              </div>
            )}
          </div>
          <div className={styles.supportActions}>
            <CopySupportButton
              url={`/api/support/health-report${healthSupportQuery}`}
              label="Copy Health Report"
              className={styles.secondaryButton}
            />
            <a className={styles.secondaryButton} href={`/api/library-health/diagnostics${filters.libraryId ? `?libraryId=${filters.libraryId}` : ""}`}>
              <Download size={15} /> Export Health Diagnostics
            </a>
            <Link className={styles.secondaryButton} href="/support">Need help? Open Beta Support</Link>
          </div>
        </details>
      )}

      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}
      {localProgress && (
        <div className={styles.message}>
          <strong>{localProgress.running ? "Local audio analysis running" : "Local audio analysis completed"}</strong>
          <br />
          Processed: {formatNumber(localProgress.processed)} / {formatNumber(localProgress.matched)}
          {" | "}Skipped: {formatNumber(localProgress.skipped)}
          {" | "}Failed: {formatNumber(localProgress.failed)}
          {" | "}Remaining: {formatNumber(localProgress.remaining)}
          {" | "}Mode: {localProgress.scopeLabel || "Sample window"}
          {" | "}Elapsed: {formatElapsed(localProgress.elapsedSeconds)}
        </div>
      )}

      <section className={`glass-panel ${styles.panel}`}>
        <form className={styles.toolbar} onSubmit={applyFilters}>
          <label>
            <span>Health category</span>
            <select value={category} onChange={(event) => updateCategory(event.target.value as Category)}>
              {category === "healthy_tracks" && <option value="healthy_tracks">Healthy Tracks</option>}
              {categoryOrder.map((item) => <option key={item} value={item}>{categoryLabels[item]}</option>)}
            </select>
          </label>
          <label>
            <span>Library</span>
            <select value={filters.libraryId} onChange={(event) => setFilters({ ...filters, libraryId: event.target.value })}>
              <option value="">All libraries</option>
              {(summary?.libraries || []).map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
            </select>
          </label>
          <label className={styles.searchField}>
            <span>Search title, artist, album, or path</span>
            <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search tracks" />
          </label>
          <label>
            <span>Artist</span>
            <input value={filters.artist} onChange={(event) => setFilters({ ...filters, artist: event.target.value })} />
          </label>
          <label>
            <span>Album</span>
            <input value={filters.album} onChange={(event) => setFilters({ ...filters, album: event.target.value })} />
          </label>
          <label>
            <span>BPM source</span>
            <select value={filters.bpmSource} onChange={(event) => setFilters({ ...filters, bpmSource: event.target.value })}>
              <option value="all">All</option>
              <option value="missing">Missing</option>
              <option value="api">API</option>
              <option value="local">Local</option>
              <option value="imported">Imported</option>
              <option value="manual">Manual</option>
              <option value="estimated">Estimated</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            <span>BPM confidence</span>
            <select value={filters.bpmConfidence} onChange={(event) => setFilters({ ...filters, bpmConfidence: event.target.value })}>
              <option value="all">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            <span>BPM conflicts</span>
            <select value={filters.bpmConflict} onChange={(event) => setFilters({ ...filters, bpmConflict: event.target.value })}>
              <option value="all">All</option>
              <option value="conflicts">Conflicts only</option>
            </select>
          </label>
          <label>
            <span>Audio feature status</span>
            <select value={filters.audioFeatureStatus} onChange={(event) => setFilters({ ...filters, audioFeatureStatus: event.target.value })}>
              <option value="all">All</option>
              <option value="missing">Missing</option>
              <option value="partial">Partial</option>
              <option value="success">Success</option>
              <option value="no_data">No data</option>
              <option value="extraction_failed">Extraction failed</option>
              <option value="analyzer_failed">Analyzer failed</option>
              <option value="too_short">Too short</option>
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}>
              <option value="">Default</option>
              <option value="artist">Artist</option>
              <option value="title">Track title</option>
              <option value="album">Album</option>
              <option value="duration">Duration</option>
              <option value="bpm">BPM</option>
              <option value="lastAnalyzed">Last analyzed</option>
              <option value="failureStatus">Failure status</option>
            </select>
          </label>
          <label>
            <span>Direction</span>
            <select value={filters.direction} onChange={(event) => setFilters({ ...filters, direction: event.target.value })}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={filters.failedOnly} onChange={(event) => setFilters({ ...filters, failedOnly: event.target.checked })} />
            Failed only
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={filters.missingDataOnly} onChange={(event) => setFilters({ ...filters, missingDataOnly: event.target.checked })} />
            Missing data only
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={filters.apiImportedOnly} onChange={(event) => setFilters({ ...filters, apiImportedOnly: event.target.checked })} />
            API/imported only
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={filters.noLocalBpm} onChange={(event) => setFilters({ ...filters, noLocalBpm: event.target.checked })} />
            No local BPM
          </label>
          <div className={styles.buttonGroup}>
            <button className={styles.primaryButton} type="submit">Apply</button>
            <button className={styles.secondaryButton} type="button" onClick={() => {
              setFilters(defaultFilters);
              setPage(1);
              window.history.replaceState({}, "", `/library-health?filter=${category}`);
              void loadSummary("");
              void loadTracks(category, 1);
            }}><X size={14} /> Clear</button>
          </div>
        </form>
      </section>

      <section className={`glass-panel ${styles.panel}`}>
        <div className={styles.tableTop}>
          <div>
            <h3>{categoryLabels[category]}</h3>
            <p className={styles.muted}>{tracksError ? "Unable to load matching tracks." : `${formatNumber(pagination.total)} matching track${pagination.total === 1 ? "" : "s"}`}</p>
          </div>
          <div className={styles.buttonGroup}>
            <button className={styles.secondaryButton} disabled={!tracks.length} onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(tracks.map((track) => track.id)))}>Select all visible</button>
            <button className={styles.secondaryButton} disabled={!selectedCount} onClick={() => setSelected(new Set())}>Clear selection</button>
            {canRetry && <button className={styles.secondaryButton} title={selectedCount ? "" : "No tracks selected."} disabled={!selectedCount || working !== null} onClick={() => void retryTracks(Array.from(selected))}><RefreshCw size={15} /> Retry selected ({selectedCount})</button>}
            {canRetry && <button className={styles.primaryButton} title={retryableFilterCount === 0 ? (canAudioRetry ? "No tracks match this audio-feature health filter." : "No tracks match this filter.") : ""} disabled={working !== null || retryableFilterCount === 0} onClick={() => void retryTracks()}>{working === "filter-configured_providers" ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} Retry all tracks matching this filter</button>}
            {canAudioRetry && <button className={styles.secondaryButton} title={`Configured providers: ${configuredProviderLabel}`} disabled={working !== null || retryableFilterCount === 0} onClick={() => void retryTracks(undefined, "configured_providers")}>Retry using configured providers</button>}
            {canAudioRetry && <button className={styles.secondaryButton} title={audioApiEnabled ? "" : "API audio features are disabled. Enable API audio features in Settings first."} disabled={working !== null || retryableFilterCount === 0 || !audioApiEnabled} onClick={() => void retryTracks(undefined, "api_only")}>Retry using API only</button>}
            {canAudioRetry && <button className={styles.secondaryButton} title={audioLocalEnabled ? "" : "Local Essentia analysis is disabled or unavailable."} disabled={working !== null || retryableFilterCount === 0 || !audioLocalEnabled} onClick={() => void retryTracks(undefined, "local_only")}>Retry using local Essentia only</button>}
            {canAudioRetry && <button className={styles.secondaryButton} title={audioLocalEnabled ? "" : "Local Essentia analysis is disabled or unavailable."} disabled={working !== null || retryableFilterCount === 0 || !audioLocalEnabled} onClick={() => void retryTracks(undefined, "force_local_reprocess")}>Force local reprocess</button>}
          </div>
        </div>
        {canAudioRetry && <p className={styles.muted}>Configured providers: {configuredProviderLabel}</p>}
        {canAudioRetry && !audioApiEnabled && <p className={styles.muted}>API audio features are disabled. Enable API audio features in Settings first.</p>}
        {canAudioRetry && !audioLocalEnabled && <p className={styles.muted}>Local Essentia analysis is disabled or unavailable.</p>}

        {tracksLoading ? (
          <div className={styles.loading}><Loader2 className="animate-spin" size={18} /> Loading tracks...</div>
        ) : tracksError ? (
          <div className={styles.error}>
            <p>Unable to load Library Health details. Retry or check the server logs.</p>
            <button className={styles.secondaryButton} type="button" onClick={() => void loadTracks(category, page)}><RefreshCw size={15} /> Retry</button>
          </div>
        ) : detailMismatch ? (
          <div className={styles.error}>Library Health count/detail mismatch detected for this category. Check logs.</div>
        ) : tracks.length === 0 ? (
          <div className={styles.empty}>{emptyMessage}</div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Select visible tracks" checked={allVisibleSelected} onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(tracks.map((track) => track.id)))} /></th>
                  <th>Track</th>
                  <th>Artist</th>
                  <th>Album</th>
                  <th>BPM</th>
                  <th>BPM source</th>
                  <th>BPM confidence</th>
                  <th>API/imported BPM</th>
                  <th>Local BPM</th>
                  <th>Energy</th>
                  <th>Energy source</th>
                  <th>Energy confidence</th>
                  <th>Mood</th>
                  <th>Mood source</th>
                  <th>Mood confidence</th>
                  <th>Danceability</th>
                  <th>Audio feature status</th>
                  <th>Last analyzed</th>
                  <th>Failure reason</th>
                  <th>Reason</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((track) => (
                  <tr key={track.id}>
                    <td data-label=""><input type="checkbox" aria-label={`Select ${track.title}`} checked={selected.has(track.id)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(track.id) ? next.delete(track.id) : next.add(track.id); return next; })} /></td>
                    <td data-label="Track" className={styles.trackCell}><strong>{track.title}</strong><small className={styles.trackMeta}>{track.library.name} | {formatDuration(track.duration)} | {track.ratingKey}</small></td>
                    <td data-label="Artist">{track.artist}</td>
                    <td data-label="Album">{track.album}</td>
                    <td data-label="BPM">{track.bpm === null ? "-" : Math.round(track.bpm * 10) / 10}</td>
                    <td data-label="BPM source">
                      <span className={styles.badge}>{track.bpmSource || "Unknown"}</span>
                      <small className={styles.trackMeta}>{track.bpmReason || "-"}</small>
                    </td>
                    <td data-label="BPM confidence">
                      <span className={track.bpmConfidence === "Low" ? `${styles.badge} ${styles.dangerBadge}` : track.bpmConfidence === "High" ? `${styles.badge} ${styles.okBadge}` : styles.badge}>{track.bpmConfidence || "Unknown"}</span>
                      {track.bpmConflictStatus && track.bpmConflictStatus !== "none" && <small className={styles.trackMeta}>{track.bpmConflictReason || "BPM source conflict"}</small>}
                    </td>
                    <td data-label="API/imported BPM">{track.apiBpm === null && track.importedBpm === null ? "-" : `API ${track.apiBpm === null ? "-" : Math.round(track.apiBpm * 10) / 10} | Imported ${track.importedBpm === null ? "-" : Math.round(track.importedBpm * 10) / 10}`}</td>
                    <td data-label="Local BPM">{track.localBpm === null ? "-" : Math.round(track.localBpm * 10) / 10}</td>
                    <td data-label="Energy">{formatDecimal(track.energy)}</td>
                    <td data-label="Energy source"><span className={styles.badge}>{track.energySource || "Unknown"}</span></td>
                    <td data-label="Energy confidence"><span className={track.energyConfidence === "Low" ? `${styles.badge} ${styles.dangerBadge}` : track.energyConfidence === "High" ? `${styles.badge} ${styles.okBadge}` : styles.badge}>{track.energyConfidence || "Unknown"}</span></td>
                    <td data-label="Mood">{formatDecimal(track.mood)}</td>
                    <td data-label="Mood source"><span className={styles.badge}>{track.moodSource || "Unknown"}</span></td>
                    <td data-label="Mood confidence"><span className={track.moodConfidence === "Low" ? `${styles.badge} ${styles.dangerBadge}` : track.moodConfidence === "High" ? `${styles.badge} ${styles.okBadge}` : styles.badge}>{track.moodConfidence || "Unknown"}</span></td>
                    <td data-label="Danceability">{formatDecimal(track.danceability)}</td>
                    <td data-label="Audio status">
                      <span className={track.audioFeatureStatus === "complete" ? `${styles.badge} ${styles.okBadge}` : styles.badge}>{track.audioFeatureStatus}</span>
                      <small className={styles.trackMeta}>Source: {track.audioFeatureSource || "-"} | Scope: {formatScope(track.audioFeatureAnalysisScope)} | Confidence: {track.audioFeatureConfidence == null ? "-" : track.audioFeatureConfidence.toFixed(2)}</small>
                    </td>
                    <td data-label="Last analyzed">{formatDate(track.lastAnalyzed)}</td>
                    <td data-label="Failure reason">{track.failureReason || "-"}</td>
                    <td data-label="Reason" className={styles.reason}>{track.bpmConflictReason || track.reason}</td>
                    <td data-label="Actions">{canRetry ? <button className={styles.tableAction} disabled={working !== null} onClick={() => void retryTracks([track.id])}>Retry</button> : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.pagination}>
          <span>Page {pagination.page} of {pagination.totalPages}</span>
          <div className={styles.buttonGroup}>
            <button aria-label="Previous page" disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); syncUrl(category, next); }}><ChevronLeft size={16} /></button>
            <button aria-label="Next page" disabled={page >= pagination.totalPages} onClick={() => { const next = page + 1; setPage(next); syncUrl(category, next); }}><ChevronRight size={16} /></button>
          </div>
        </div>
      </section>
    </main>
  );
}
