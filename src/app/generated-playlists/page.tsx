"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Activity, AlertTriangle, Ban, CheckCircle2, FlaskConical, History, ListRestart, RefreshCw, Repeat2, ShieldCheck, Sparkles, Trash2, Wand2 } from "lucide-react";
import TrackPreviewButton from "@/components/TrackPreviewButton";
import TrackFeedbackMenu from "@/components/TrackFeedbackMenu";
import AdaptiveScoreBreakdown from "@/components/AdaptiveScoreBreakdown";
import SmartMixExplanation from "@/components/SmartMixExplanation";
import SmartMixGenerationInsights from "@/components/SmartMixGenerationInsights";
import AdvancedRegenerationWorkspace from "@/components/AdvancedRegenerationWorkspace";
import PlaylistIdentityPanel from "@/components/PlaylistIdentityPanel";
import PlaylistCoordinationPanel from "@/components/PlaylistCoordinationPanel";
import PlaylistCollectionsButton from "@/components/PlaylistCollectionsButton";
import PlaylistRolePanel from "@/components/PlaylistRolePanel";
import SmartRefreshPanel from "@/components/SmartRefreshPanel";
import { orderTracksByBpmFlow, summarizeBpmFlow, type BpmFlowMode } from "@/lib/smartMixEngine/v2/bpmFlow";
import { normalizeSmartMixTuningConfig } from "@/lib/smartMixEngine/v2/tuning";
import styles from "./generated-playlists.module.css";

type GeneratedPlaylist = {
  id: string;
  plexPlaylistRatingKey?: string | null;
  plexPlaylistTitle: string;
  sourceType: string;
  engineVersion?: "v1" | "v2" | null;
  qualityScoreJson?: PlaylistQualityScore | null;
  recipeName?: string | null;
  smartPresetName?: string | null;
  moodPresetName?: string | null;
  bpmPresetName?: string | null;
  tuningPresetName?: string | null;
  contextProfileName?: string | null;
  contextInfluence?: string | null;
  contextOverridesJson?: string[] | null;
  discoveryConfigJson?: any;
  discoveryResultJson?: any;
  filtersJson?: {
    moodBlendMode?: "off" | "smooth_transition" | "strict_matching" | "mixed_mood";
    selectedMoodPath?: string[];
    allowedMoods?: string[];
  } | null;
  tuningConfigJson?: {
    recommendationStrength?: number;
    familiarityDiscoveryBalance?: number;
    bpmWeight?: number;
    energyWeight?: number;
    artistVariety?: number;
    albumVariety?: number;
  } | null;
  trackCount: number;
  lastGeneratedAt: string;
  lastRegeneratedAt?: string | null;
  _count?: { tracks: number };
  smartRefreshSettings?: { refreshMode: string } | null;
  smartRefreshEvaluations?: Array<{ status: string; recommendation: string; shouldRefresh: boolean; estimatedImprovement?: number | null }>;
};

type PreviewState = {
  previewId: string;
  trackIds: string[];
  tracks: any[];
  warnings: string[];
  generationInsights?: any;
  rejectedCandidates?: any[];
  qualityScore?: PlaylistQualityScore | null;
  summary: {
    targetTrackCount: number;
    matchingTrackCount: number;
    finalTrackCount: number;
    manualExclusionsRemoved?: number;
    removedBySafetyRules?: number;
    safetyRuleSummary?: string;
    engineVersion?: "v1" | "v2";
    engineLabel?: string;
    qualityScore?: PlaylistQualityScore | null;
    moodBlendMode?: "off" | "smooth_transition" | "strict_matching" | "mixed_mood";
    moodBlendLabel?: string;
    moodCurve?: any;
    moodCoverage?: any;
    moodFallbackCount?: number;
    moodConflictCount?: number;
    missingMoodCount?: number;
    bpmFlow?: ReturnType<typeof summarizeBpmFlow> | null;
    bpmFlowScore?: number | null;
    bpmFlowMode?: BpmFlowMode;
    bpmFlowWarnings?: string[];
  };
  regeneration: {
    mode: "replace_all" | "keep_some";
    currentPlaylistTrackCount: number;
    previousSnapshotTrackCount: number;
    newPreviewTrackCount: number;
    tracksKept: number;
    tracksReplaced: number;
    tracksReused: number;
    newTracks: number;
    newTracksAdded?: number;
    removedTracks: number;
    keepPercent?: number | null;
    previousTracksAvoided?: number;
    preferDifferentTracks?: boolean;
    manualExclusionsRemoved?: number;
    snapshotAvailable: boolean;
    recipeName?: string | null;
    smartPresetName?: string | null;
    moodPresetName?: string | null;
    bpmPresetName?: string | null;
    tuningPresetName?: string | null;
  };
};

type PlaylistQualityScore = {
  overallScore: number;
  bpmConsistencyScore: number;
  bpmFlowScore?: number | null;
  bpmFlow?: ReturnType<typeof summarizeBpmFlow> | null;
  energyFlowScore: number;
  moodConsistencyScore: number;
  discoveryBalanceScore: number;
  discoveryTargetMatch?: number;
  discoveryMetrics?: any;
  weakSpotCount: number;
  warnings?: string[];
  scoreVersion?: string;
  labels?: {
    overall?: string;
    bpmConsistency?: string;
    bpmFlow?: string;
    energyFlow?: string;
    moodConsistency?: string;
    discoveryBalance?: string;
    discoveryTargetMatch?: string;
  };
};

type RegenerationOptions = {
  mode: "replace_all" | "keep_some";
  keepPercent: 25 | 50;
  preferDifferentTracks: boolean;
};

const defaultRegenerationOptions: RegenerationOptions = {
  mode: "replace_all",
  keepPercent: 25,
  preferDifferentTracks: false,
};

function formatDate(value?: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function formatDuration(ms?: number | null) {
  if (!ms) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function sourceLabel(sourceType: string) {
  if (sourceType === "recipe") return "Recipe";
  if (sourceType === "smart_builder") return "Smart Builder";
  if (sourceType === "manual_builder") return "Builder";
  if (sourceType === "chain_master") return "Master Journey";
  return "Unknown";
}

function engineLabel(engineVersion?: string | null) {
  return engineVersion === "v2" ? "Smart Mix Engine: v2 Foundation" : "Smart Mix Engine: v1 Legacy";
}

function moodBlendLabel(filters?: GeneratedPlaylist["filtersJson"]) {
  if (!filters || !filters.moodBlendMode || filters.moodBlendMode === "off") return "";
  if (filters.moodBlendMode === "smooth_transition") return `Mood Blend: Smooth (${(filters.selectedMoodPath || []).join(" -> ")})`;
  if (filters.moodBlendMode === "strict_matching") return `Mood Blend: Strict (${(filters.selectedMoodPath || []).join(" -> ")})`;
  if (filters.moodBlendMode === "mixed_mood") return `Mood Blend: Mixed (${(filters.allowedMoods || []).join(", ")})`;
  return "";
}

function isPlaylistQualityScore(value: unknown): value is PlaylistQualityScore {
  return Boolean(value && typeof value === "object" && typeof (value as PlaylistQualityScore).overallScore === "number");
}

function qualityScoreForDisplay(value: unknown) {
  return isPlaylistQualityScore(value) ? value : null;
}

function roundedValue(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function moodCurveLines(curve: any): string[] {
  if (!curve) return [];
  if (curve.mode === "mixed_mood") {
    return [
      `Primary moods: ${(curve.primaryMoods || []).join(", ") || "None"}`,
      `Dominant mood: ${curve.dominantMood || "None"}`,
      `Secondary mood coverage: ${(curve.secondaryMoodCoverage || []).join(", ") || "None"}`,
    ];
  }
  return (curve.sections || []).map((section: any) => (
    `${section.start}-${section.end}: ${section.mood}${typeof section.matchedTrackCount === "number" ? ` (${section.matchedTrackCount} matched)` : ""}`
  ));
}

function moodCoverageLines(coverage: any): string[] {
  const preview = coverage?.preview;
  if (!preview || typeof preview !== "object") return [];
  return Object.entries(preview).map(([mood, value]) => {
    const counts = value as { exact?: number; alias?: number; adjacent?: number; related?: number; fallbackCompatible?: number };
    const related = (counts.alias || 0) + (counts.adjacent || 0) + (counts.related || 0);
    return `${mood}: ${counts.exact || 0} exact / ${related} related / ${counts.fallbackCompatible || 0} fallback-compatible`;
  });
}

function bpmModeLabel(mode?: string) {
  if (mode === "RAMP_UP") return "Ramp Up";
  if (mode === "RAMP_DOWN") return "Ramp Down";
  if (mode === "STEADY") return "Keep Steady";
  if (mode === "NATURAL") return "Natural Flow";
  return "No BPM Ordering";
}

function transitionBadgeText(transition: any) {
  if (!transition) return "";
  if (transition.difficulty === "Unknown") return "BPM unknown";
  const direction = transition.normalizedToBpm != null && transition.normalizedFromBpm != null
    ? transition.normalizedToBpm - transition.normalizedFromBpm
    : null;
  const signedGap = direction == null ? `${transition.effectiveGap ?? "-"} BPM` : `${direction >= 0 ? "+" : ""}${Math.round(direction)} BPM`;
  if (transition.relationship !== "direct" && transition.relationship !== "unknown") {
    return `${transition.relationship} match - ${Math.round(transition.fromBpm)} -> ${Math.round(transition.toBpm)} BPM`;
  }
  return `${transition.difficulty} transition - ${signedGap}`;
}

function PlaylistQualityCard({ score }: { score?: PlaylistQualityScore | null }) {
  if (!score) {
    return (
      <div className={styles.qualityPanel}>
        <div className={styles.qualityHeader}>
          <ShieldCheck size={15} />
          <strong>Playlist Quality</strong>
        </div>
        <p className={styles.qualityUnavailable}>Scoring unavailable for this playlist.</p>
      </div>
    );
  }

  return (
    <div className={styles.qualityPanel}>
      <div className={styles.qualityHeader}>
        <ShieldCheck size={15} />
        <strong>Playlist Quality</strong>
        {score.scoreVersion && <span>v{score.scoreVersion}</span>}
      </div>
      <dl className={styles.qualityGrid}>
        <div><dt>Playlist Score</dt><dd>{score.overallScore}% {score.labels?.overall ? `(${score.labels.overall})` : ""}</dd></div>
        <div><dt>BPM Consistency</dt><dd>{score.labels?.bpmConsistency || `${score.bpmConsistencyScore}%`}</dd></div>
        <div><dt>BPM Flow</dt><dd>{score.bpmFlowScore != null ? `${score.bpmFlowScore}% ${score.labels?.bpmFlow ? `(${score.labels.bpmFlow})` : ""}` : "Not scored"}</dd></div>
        <div><dt>Mood Match</dt><dd>{score.labels?.moodConsistency || `${score.moodConsistencyScore}%`}</dd></div>
        <div><dt>Energy Curve</dt><dd>{score.labels?.energyFlow || `${score.energyFlowScore}%`}</dd></div>
        <div><dt>Discovery Balance</dt><dd>{score.labels?.discoveryBalance || `${score.discoveryBalanceScore}%`}</dd></div>
        {score.discoveryTargetMatch != null && <div><dt>Discovery Target Match</dt><dd>{score.discoveryTargetMatch}% {score.labels?.discoveryTargetMatch ? `(${score.labels.discoveryTargetMatch})` : ""}</dd></div>}
        <div><dt>Weak Spots</dt><dd>{score.weakSpotCount} track{score.weakSpotCount === 1 ? "" : "s"}</dd></div>
      </dl>
      {score.warnings && score.warnings.length > 0 && (
        <div className={styles.qualityWarnings}>
          {score.warnings.map((warning) => (
            <p key={warning}>
              <AlertTriangle size={14} />
              {warning}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function BpmFlowCard({ bpmFlow }: { bpmFlow?: ReturnType<typeof summarizeBpmFlow> | null }) {
  if (!bpmFlow) return null;
  return (
    <div className={styles.qualityPanel}>
      <div className={styles.qualityHeader}>
        <Activity size={15} />
        <strong>BPM Flow</strong>
        <span>{bpmModeLabel(bpmFlow.config.mode)}</span>
      </div>
      <dl className={styles.qualityGrid}>
        <div><dt>Score</dt><dd>{bpmFlow.bpmFlowScore != null ? `${bpmFlow.bpmFlowScore}%` : "Unknown"}</dd></div>
        <div><dt>Start / End</dt><dd>{bpmFlow.startingBpm ? Math.round(bpmFlow.startingBpm) : "-"} / {bpmFlow.endingBpm ? Math.round(bpmFlow.endingBpm) : "-"}</dd></div>
        <div><dt>Range</dt><dd>{bpmFlow.lowestBpm ? Math.round(bpmFlow.lowestBpm) : "-"}-{bpmFlow.highestBpm ? Math.round(bpmFlow.highestBpm) : "-"}</dd></div>
        <div><dt>Avg Gap</dt><dd>{bpmFlow.averageEffectiveGap ?? "-"} BPM</dd></div>
        <div><dt>Largest Gap</dt><dd>{bpmFlow.largestEffectiveGap ?? "-"} BPM</dd></div>
        <div><dt>Easy / Moderate</dt><dd>{bpmFlow.easyTransitionCount} / {bpmFlow.moderateTransitionCount}</dd></div>
        <div><dt>Difficult / Hard</dt><dd>{bpmFlow.difficultTransitionCount} / {bpmFlow.hardTransitionCount}</dd></div>
        <div><dt>Unknown</dt><dd>{bpmFlow.unknownTransitionCount}</dd></div>
        <div><dt>Half/Double</dt><dd>{bpmFlow.halfDoubleTimeMatchCount}</dd></div>
        <div><dt>Conflicts</dt><dd>{bpmFlow.directionConflictCount}</dd></div>
      </dl>
      <p className={styles.qualityUnavailable}>{bpmFlow.explanation}</p>
    </div>
  );
}

export default function GeneratedPlaylistsPage() {
  const [playlists, setPlaylists] = useState<GeneratedPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [optionsByPlaylist, setOptionsByPlaylist] = useState<Record<string, RegenerationOptions>>({});
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [advancedPlaylist, setAdvancedPlaylist] = useState<GeneratedPlaylist | null>(null);
  const [smartRefreshFilter, setSmartRefreshFilter] = useState("all");

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedId) || null,
    [playlists, selectedId],
  );
  const visiblePlaylists = useMemo(() => playlists.filter((playlist) => {
    if (smartRefreshFilter === "all") return true;
    const mode = playlist.smartRefreshSettings?.refreshMode || "MANUAL_ONLY";
    const latest = playlist.smartRefreshEvaluations?.[0];
    if (smartRefreshFilter === "recommended") return latest?.status === "RECOMMENDED";
    if (smartRefreshFilter === "deferred") return latest?.status === "DEFERRED";
    if (smartRefreshFilter === "blocked") return latest?.status === "BLOCKED";
    if (smartRefreshFilter === "healthy") return latest?.status === "HEALTHY";
    if (smartRefreshFilter === "recent") return latest?.status === "EXECUTED";
    if (smartRefreshFilter === "fixed") return mode === "FIXED_SCHEDULE";
    if (smartRefreshFilter === "manual") return mode === "MANUAL_ONLY";
    return true;
  }), [playlists, smartRefreshFilter]);

  const fetchPlaylists = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/api/generated-playlists");
      setPlaylists(res.data.playlists || []);
    } catch (requestError) {
      console.error(requestError);
      setError("Unable to load generated playlists.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlaylists();
    const requestedFilter = new URLSearchParams(window.location.search).get("smartRefresh");
    if (["recommended", "deferred", "blocked", "healthy", "recent", "fixed", "manual"].includes(requestedFilter || "")) setSmartRefreshFilter(requestedFilter!);
  }, []);

  const getRegenerationOptions = (playlistId: string) => optionsByPlaylist[playlistId] || defaultRegenerationOptions;

  const updateRegenerationOptions = (playlistId: string, nextOptions: Partial<RegenerationOptions>) => {
    setOptionsByPlaylist((current) => ({
      ...current,
      [playlistId]: {
        ...(current[playlistId] || defaultRegenerationOptions),
        ...nextOptions,
      },
    }));
    if (selectedId === playlistId) {
      setPreview(null);
    }
  };

  const previewRegeneration = async (playlist: GeneratedPlaylist) => {
    const options = getRegenerationOptions(playlist.id);
    setBusyId(playlist.id);
    setSelectedId(playlist.id);
    setPreview(null);
    setMessage("");
    setError("");
    try {
      const res = await axios.post(`/api/generated-playlists/${playlist.id}/preview-regeneration`, {
        mode: options.mode,
        keepPercent: options.keepPercent,
        preferDifferentTracks: options.preferDifferentTracks,
      });
      setPreview(res.data.preview);
      setMessage(`Previewed regeneration for "${playlist.plexPlaylistTitle}".`);
    } catch (requestError: any) {
      console.error(requestError);
      setError(requestError.response?.data?.error || "Failed to preview regeneration.");
    } finally {
      setBusyId("");
    }
  };

  const regeneratePlaylist = async () => {
    if (!selectedPlaylist || !preview) return;
    if (!window.confirm(`Regenerate "${selectedPlaylist.plexPlaylistTitle}"? This will replace the tracks in the existing Plex playlist.`)) return;

    const options = getRegenerationOptions(selectedPlaylist.id);
    setBusyId(selectedPlaylist.id);
    setMessage("");
    setError("");
    try {
      const res = await axios.post(`/api/generated-playlists/${selectedPlaylist.id}/regenerate`, {
        mode: preview.regeneration.mode || options.mode,
        keepPercent: preview.regeneration.keepPercent || options.keepPercent,
        preferDifferentTracks: Boolean(preview.regeneration.preferDifferentTracks ?? options.preferDifferentTracks),
        previewId: preview.previewId,
        trackIds: preview.trackIds,
        warnings: preview.warnings,
        regeneration: preview.regeneration,
      });
      setMessage(`Regenerated "${selectedPlaylist.plexPlaylistTitle}" with ${res.data.trackCount} tracks.`);
      setPreview(null);
      await fetchPlaylists();
    } catch (requestError: any) {
      console.error(requestError);
      setError(requestError.response?.data?.error || "Failed to regenerate playlist.");
    } finally {
      setBusyId("");
    }
  };

  const sortPreviewByBpmFlow = (mode: BpmFlowMode = "NATURAL") => {
    if (!selectedPlaylist || !preview || preview.tracks.length < 2) return;
    if (!window.confirm("Sort this regeneration preview by BPM flow? This preserves the same tracks but changes their order.")) return;
    const tuning = normalizeSmartMixTuningConfig({
      ...(selectedPlaylist.tuningConfigJson || {}),
      bpmFlow: {
        ...(selectedPlaylist.tuningConfigJson as any)?.bpmFlow,
        enabled: true,
        mode,
      },
    });
    const sorted = orderTracksByBpmFlow({ tracks: preview.tracks, tuningConfig: tuning, baseScore: (track) => Number(track.score) || 0 });
    const bpmFlow = summarizeBpmFlow(sorted, tuning.bpmFlow);
    const tracksWithTransitions = sorted.map((track, index) => ({
      ...track,
      bpmTransitionFromPrevious: index === 0 ? null : bpmFlow.transitionAnalyses[index - 1] || null,
    }));
    setPreview({
      ...preview,
      tracks: tracksWithTransitions,
      trackIds: tracksWithTransitions.map((track) => track.id),
      qualityScore: {
        ...(preview.qualityScore || preview.summary.qualityScore || {}),
        bpmFlow,
        bpmFlowScore: bpmFlow.bpmFlowScore,
      } as PlaylistQualityScore,
      summary: {
        ...preview.summary,
        bpmFlow,
        bpmFlowScore: bpmFlow.bpmFlowScore,
        bpmFlowMode: mode,
        bpmFlowWarnings: bpmFlow.warnings,
        qualityScore: {
          ...(preview.summary.qualityScore || preview.qualityScore || {}),
          bpmFlow,
          bpmFlowScore: bpmFlow.bpmFlowScore,
        } as PlaylistQualityScore,
      },
      warnings: [...preview.warnings, ...bpmFlow.warnings].filter((warning, index, list) => list.indexOf(warning) === index),
    });
  };

  const removeGeneratedPlaylist = async (playlist: GeneratedPlaylist) => {
    const confirmed = window.confirm(`Remove "${playlist.plexPlaylistTitle}" from Generated Playlists? This only removes Mixarr tracking. The Plex playlist will remain unchanged.`);
    if (!confirmed) return;

    setBusyId(playlist.id);
    setMessage("");
    setError("");
    try {
      await axios.delete(`/api/generated-playlists/${playlist.id}`);
      setMessage(`Removed "${playlist.plexPlaylistTitle}" from Generated Playlists.`);
      if (selectedId === playlist.id) {
        setSelectedId("");
        setPreview(null);
      }
      await fetchPlaylists();
    } catch (requestError: any) {
      console.error(requestError);
      setError(requestError.response?.data?.error || "Failed to remove generated playlist tracking.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>
            <ListRestart size={14} />
            Playlist Regeneration
          </span>
          <h2>Generated Playlists</h2>
          <p>View playlists created by Mixarr and regenerate them using saved settings.</p>
        </div>
        <Link href="/builder" className={styles.secondaryButton}>
          <Wand2 size={16} />
          Build Playlist
        </Link>
      </header>

      {message && (
        <div className={styles.successNotice}>
          <CheckCircle2 size={16} />
          {message}
        </div>
      )}
      {error && (
        <div className={styles.errorNotice}>
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {loading ? (
        <div className={styles.statePanel}>Loading generated playlists...</div>
      ) : playlists.length === 0 ? (
        <section className={styles.emptyState}>
          <ListRestart size={30} />
          <h3>No Mixarr-generated playlists have been tracked yet.</h3>
          <p>Create a playlist from the builder, Smart Builder, or a recipe to enable regeneration.</p>
          <div>
            <Link href="/builder" className={styles.primaryButton}>Open Builder</Link>
            <Link href="/smart-builder" className={styles.secondaryButton}>Open Smart Builder</Link>
          </div>
        </section>
      ) : (
        <>
        <nav className={styles.smartRefreshFilters} aria-label="Filter playlists by Smart Refresh status">
          <label>Smart Refresh filter<select value={smartRefreshFilter} onChange={(event) => setSmartRefreshFilter(event.target.value)}><option value="all">All playlists</option><option value="recommended">Refresh recommended</option><option value="deferred">Deferred</option><option value="blocked">Blocked</option><option value="healthy">Healthy</option><option value="recent">Recently refreshed</option><option value="fixed">Fixed schedule</option><option value="manual">Manual only</option></select></label>
          <span>{visiblePlaylists.length} of {playlists.length} playlists</span>
        </nav>
        {visiblePlaylists.length === 0 ? <div className={styles.statePanel}>No playlists match this Smart Refresh filter.</div> : <section className={styles.playlistGrid} aria-label="Generated playlists">
          {visiblePlaylists.map((playlist) => {
            const isSelected = selectedId === playlist.id;
            const isBusy = busyId === playlist.id;
            const regenerationOptions = getRegenerationOptions(playlist.id);
            const presets = [
              engineLabel(playlist.engineVersion),
              playlist.recipeName ? `Recipe: ${playlist.recipeName}` : "",
              playlist.smartPresetName ? `Smart: ${playlist.smartPresetName}` : "",
              playlist.moodPresetName ? `Mood: ${playlist.moodPresetName}` : "",
              playlist.bpmPresetName ? `BPM: ${playlist.bpmPresetName}` : "",
              playlist.tuningPresetName ? `Tuning Preset: ${playlist.tuningPresetName}` : "",
              playlist.contextProfileName ? `Context: ${playlist.contextProfileName} (${(playlist.contextInfluence || "BALANCED").toLowerCase()})` : "",
              moodBlendLabel(playlist.filtersJson),
            ].filter(Boolean);

            return (
              <article id={`playlist-${playlist.id}`} key={playlist.id} className={`${styles.playlistCard} ${isSelected ? styles.selectedCard : ""}`}>
                <div className={styles.cardTop}>
                  <div>
                    <h3>{playlist.plexPlaylistTitle}</h3>
                    <p>{sourceLabel(playlist.sourceType)}</p>
                  </div>
                  <span>{playlist.trackCount} tracks</span>
                </div>
                <dl className={styles.metaGrid}>
                  <div>
                    <dt>Last generated</dt>
                    <dd>{formatDate(playlist.lastRegeneratedAt || playlist.lastGeneratedAt)}</dd>
                  </div>
                  <div>
                    <dt>Snapshot</dt>
                    <dd>{playlist._count?.tracks || 0} tracks</dd>
                  </div>
                </dl>
                <div className={styles.badgeRow}>
                  {presets.length ? presets.map((preset) => <span key={preset}>{preset}</span>) : <span>Saved filters</span>}
                </div>
                {playlist.engineVersion === "v2" && playlist.tuningConfigJson && (
                  <details className={styles.tuningDetails}>
                    <summary>Tuning values</summary>
                    <div>
                      <span>Strength {roundedValue(playlist.tuningConfigJson.recommendationStrength) ?? "-"}</span>
                      <span>Discovery {roundedValue(playlist.tuningConfigJson.familiarityDiscoveryBalance) ?? "-"}</span>
                      <span>BPM {roundedValue(playlist.tuningConfigJson.bpmWeight) ?? "-"}</span>
                      <span>Energy {roundedValue(playlist.tuningConfigJson.energyWeight) ?? "-"}</span>
                      <span>Artist variety {roundedValue(playlist.tuningConfigJson.artistVariety) ?? "-"}</span>
                      <span>Album variety {roundedValue(playlist.tuningConfigJson.albumVariety) ?? "-"}</span>
                    </div>
                  </details>
                )}
                {playlist.contextProfileName && <p className={styles.contextSummary}>Generated with {playlist.contextProfileName} · {(playlist.contextInfluence || "BALANCED").toLowerCase()} influence · {playlist.contextOverridesJson?.length || 0} manual override{playlist.contextOverridesJson?.length === 1 ? "" : "s"}</p>}
                <PlaylistQualityCard score={qualityScoreForDisplay(playlist.qualityScoreJson)} />
                {playlist.engineVersion === "v2" && <SmartRefreshPanel
                  playlistId={playlist.id}
                  onOpenAdvanced={() => setAdvancedPlaylist(playlist)}
                  onChanged={(nextMessage) => { setMessage(nextMessage); setError(""); void fetchPlaylists(); }}
                />}
                <PlaylistRolePanel playlistId={playlist.id} />
                <PlaylistIdentityPanel playlistId={playlist.id} playlistName={playlist.plexPlaylistTitle} onClone={fetchPlaylists} />
                <PlaylistCoordinationPanel playlist={playlist} />
                <PlaylistCollectionsButton playlistId={playlist.id} />
                {playlist.discoveryResultJson?.explanations?.length > 0 && (
                  <div className={styles.discoverySummary} aria-label="Discovery explanation labels">
                    {playlist.discoveryResultJson.explanations.map((item: any) => <span key={item.label} title={item.explanation}>{item.label}</span>)}
                  </div>
                )}
                {playlist.engineVersion !== "v2" && <div className={styles.controls} aria-label={`Legacy regeneration options for ${playlist.plexPlaylistTitle}`}>
                  <div className={styles.modeGroup}>
                    <label className={styles.radioOption}>
                      <input
                        type="radio"
                        name={`mode-${playlist.id}`}
                        checked={regenerationOptions.mode === "replace_all"}
                        onChange={() => updateRegenerationOptions(playlist.id, { mode: "replace_all" })}
                      />
                      <span>
                        <strong>Replace all tracks</strong>
                        <small>Build a fresh version using the saved filters and replace the playlist contents.</small>
                      </span>
                    </label>
                    <label className={styles.radioOption}>
                      <input
                        type="radio"
                        name={`mode-${playlist.id}`}
                        checked={regenerationOptions.mode === "keep_some"}
                        onChange={() => updateRegenerationOptions(playlist.id, { mode: "keep_some" })}
                      />
                      <span>
                        <strong>Keep some existing tracks</strong>
                        <small>Keep 25% or 50% of the current playlist and refill the rest.</small>
                      </span>
                    </label>
                  </div>
                  {regenerationOptions.mode === "keep_some" && (
                    <label className={styles.selectOption}>
                      <span>Keep amount</span>
                      <select
                        value={regenerationOptions.keepPercent}
                        onChange={(event) => updateRegenerationOptions(playlist.id, { keepPercent: Number(event.target.value) as 25 | 50 })}
                      >
                        <option value={25}>25%</option>
                        <option value={50}>50%</option>
                      </select>
                    </label>
                  )}
                  <label className={styles.checkOption}>
                    <input
                      type="checkbox"
                      checked={regenerationOptions.preferDifferentTracks}
                      onChange={(event) => updateRegenerationOptions(playlist.id, { preferDifferentTracks: event.target.checked })}
                    />
                    <span>Prefer different tracks than last time</span>
                  </label>
                </div>}
                <div className={styles.actions}>
                  {playlist.engineVersion === "v2" && (
                    <button type="button" onClick={() => setAdvancedPlaylist(playlist)} disabled={Boolean(busyId)} className={styles.primaryButton}>
                      <Sparkles size={15} />
                      Regenerate Playlist <span className={styles.betaBadge}>BETA</span>
                    </button>
                  )}
                  {playlist.engineVersion === "v2" && <button type="button" onClick={() => previewRegeneration(playlist)} disabled={Boolean(busyId)} className={styles.secondaryButton}><Repeat2 size={15} />Preview full regeneration</button>}
                  {playlist.engineVersion !== "v2" && <>
                    <button type="button" onClick={() => previewRegeneration(playlist)} disabled={Boolean(busyId)} className={styles.primaryButton}>
                      {isBusy ? <RefreshCw size={15} className="animate-spin" /> : <Repeat2 size={15} />}
                      Preview Regeneration
                    </button>
                    <button type="button" disabled={!isSelected || !preview || Boolean(busyId)} onClick={regeneratePlaylist} className={styles.dangerButton}>
                      Regenerate
                    </button>
                  </>}
                  <Link href={`/generated-playlists/${playlist.id}/versions`} className={styles.secondaryButton}>
                    <History size={15} />
                    History &amp; Restore
                  </Link>
                  {playlist.engineVersion === "v2" && <Link href={`/experiments?new=1&playlistId=${playlist.id}`} className={styles.secondaryButton}>
                    <FlaskConical size={15} /> Start experiment
                  </Link>}
                  <button type="button" disabled={Boolean(busyId)} onClick={() => removeGeneratedPlaylist(playlist)} className={styles.secondaryDangerButton}>
                    <Trash2 size={15} />
                    Remove from Generated Playlists
                  </button>
                </div>
              </article>
            );
          })}
        </section>}
        </>
      )}

      {selectedPlaylist && preview && (
        <section className={styles.previewPanel} aria-labelledby="regeneration-preview">
          <div className={styles.previewHeader}>
            <div>
              <span className={styles.kicker}>
                <ShieldCheck size={14} />
                Preview Required
              </span>
              <h3 id="regeneration-preview">Regeneration Preview: {selectedPlaylist.plexPlaylistTitle}</h3>
              <p>The tracks below are the exact order Mixarr will write to Plex after confirmation.</p>
            </div>
            <button type="button" onClick={regeneratePlaylist} disabled={Boolean(busyId) || preview.trackIds.length === 0} className={styles.dangerButton}>
              {busyId === selectedPlaylist.id ? <RefreshCw size={15} className="animate-spin" /> : <Repeat2 size={15} />}
              Regenerate Playlist
            </button>
            <button type="button" onClick={() => sortPreviewByBpmFlow((preview.summary.bpmFlowMode as BpmFlowMode) || "NATURAL")} disabled={Boolean(busyId) || preview.trackIds.length < 2} className={styles.secondaryButton}>
              <Activity size={15} />
              Sort by BPM Flow
            </button>
          </div>

          <div className={styles.statsGrid}>
            <div><span>Current count</span><strong>{preview.regeneration.currentPlaylistTrackCount}</strong></div>
            <div><span>New preview</span><strong>{preview.regeneration.newPreviewTrackCount}</strong></div>
            {preview.regeneration.mode === "keep_some" ? (
              <>
                <div><span>Tracks kept</span><strong>{preview.regeneration.tracksKept}</strong></div>
                <div><span>Tracks replaced</span><strong>{preview.regeneration.tracksReplaced}</strong></div>
                <div><span>Keep amount</span><strong>{preview.regeneration.keepPercent}%</strong></div>
                <div><span>New tracks added</span><strong>{preview.regeneration.newTracksAdded ?? preview.regeneration.newTracks}</strong></div>
              </>
            ) : (
              <>
                <div><span>Tracks reused</span><strong>{preview.regeneration.snapshotAvailable ? preview.regeneration.tracksReused : "N/A"}</strong></div>
                <div><span>New tracks</span><strong>{preview.regeneration.snapshotAvailable ? preview.regeneration.newTracks : "N/A"}</strong></div>
              </>
            )}
            <div><span>Removed tracks</span><strong>{preview.regeneration.snapshotAvailable ? preview.regeneration.removedTracks : "N/A"}</strong></div>
            <div><span>Manual exclusions</span><strong>{preview.summary.manualExclusionsRemoved || 0}</strong></div>
            <div><span>Safety removed</span><strong>{preview.summary.removedBySafetyRules || 0}</strong></div>
            {preview.regeneration.preferDifferentTracks && (
              <div><span>Previous tracks avoided</span><strong>{preview.regeneration.snapshotAvailable ? preview.regeneration.previousTracksAvoided || 0 : "N/A"}</strong></div>
            )}
          </div>

          {preview.regeneration.mode === "keep_some" && (
            <p className={styles.previewSummary}>
              Keeping {preview.regeneration.keepPercent}%: {preview.regeneration.tracksKept} tracks kept, {preview.regeneration.tracksReplaced} tracks replaced, {preview.regeneration.newPreviewTrackCount} total preview tracks.
            </p>
          )}

          <div className={styles.contextRow}>
            {preview.regeneration.recipeName && <span>Recipe: {preview.regeneration.recipeName}</span>}
            {preview.regeneration.smartPresetName && <span>Smart preset: {preview.regeneration.smartPresetName}</span>}
            {preview.regeneration.moodPresetName && <span>Mood preset: {preview.regeneration.moodPresetName}</span>}
            {preview.regeneration.bpmPresetName && <span>BPM preset: {preview.regeneration.bpmPresetName}</span>}
            {preview.regeneration.tuningPresetName && <span>Tuning Preset: {preview.regeneration.tuningPresetName}</span>}
            <span>{preview.summary.engineLabel || engineLabel(preview.summary.engineVersion)}</span>
            <span>{preview.summary.safetyRuleSummary || "Safety rules: off"}</span>
          </div>

          <PlaylistQualityCard score={qualityScoreForDisplay(preview.qualityScore || preview.summary.qualityScore)} />
          <BpmFlowCard bpmFlow={(preview.qualityScore || preview.summary.qualityScore)?.bpmFlow || preview.summary.bpmFlow} />

          {preview.summary.moodBlendMode && preview.summary.moodBlendMode !== "off" && (
            <div className={styles.qualityPanel}>
              <div className={styles.qualityHeader}>
                <Sparkles size={15} />
                <strong>Mood Curve</strong>
                <span>{preview.summary.moodBlendLabel}</span>
              </div>
              <div className={styles.moodCurveList}>
                {moodCurveLines(preview.summary.moodCurve).map((line) => <p key={line}>{line}</p>)}
                {moodCoverageLines(preview.summary.moodCoverage).map((line) => <p key={line}>{line}</p>)}
                <p>Fallbacks {preview.summary.moodFallbackCount || 0} | Conflicts {preview.summary.moodConflictCount || 0} | Missing tags {preview.summary.missingMoodCount || 0}</p>
              </div>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className={styles.warningPanel}>
              <div><AlertTriangle size={16} /> Warnings</div>
              {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}

          <SmartMixGenerationInsights insights={preview.generationInsights} generationId={preview.previewId} rejectedCandidates={preview.rejectedCandidates} />

          <div className={styles.trackList}>
            {preview.tracks.length === 0 ? (
              <div className={styles.statePanel}>No tracks matched this regeneration preview.</div>
            ) : preview.tracks.map((track, index) => (
              <article key={track.id} className={styles.trackCard}>
                <span className={styles.trackIndex}>{index + 1}</span>
                <div>
                  <h4>{track.title || "-"}</h4>
                  <p>{track.artist?.title || "-"} - {track.album?.title || "-"}</p>
                  {index > 0 && track.bpmTransitionFromPrevious && (
                    <p className={styles.transitionText} title={track.bpmTransitionFromPrevious.reason}>
                      {transitionBadgeText(track.bpmTransitionFromPrevious)}
                    </p>
                  )}
                  <div className={styles.trackMeta}>
                    <span>{formatDuration(track.duration)}</span>
                    <span>BPM {(track.effectiveBpm ?? track.bpm ?? track.audioFeature?.tempo)?.toFixed(0) || "-"}</span>
                    <span>Energy {(track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy)?.toFixed(2) || "-"}</span>
                    <span>Mood {(track.audioFeature?.effectiveMood ?? track.audioFeature?.valence)?.toFixed(2) || "-"}</span>
                    <span>Popularity {track.popularity?.score?.toFixed(0) || "-"}</span>
                  </div>
                  <AdaptiveScoreBreakdown score={track.adaptiveScore} playback={track.playbackScore} coordination={track.coordinationScore} />
                </div>
                <div className={styles.trackActions}>
                  <TrackPreviewButton trackId={track.id} />
                  <SmartMixExplanation compact trackId={track.id} generationId={preview.previewId} playlistId={selectedPlaylist.id} initialExplanation={track.decisionExplanation} />
                  <TrackFeedbackMenu
                    trackId={track.id} artistId={track.artistId || track.artist?.id} trackTitle={track.title}
                    playlistId={selectedPlaylist.id} generationId={preview.previewId} sourceSurface="REGENERATION_PREVIEW"
                    initialTrackState={track.personalizationScore?.exclusionReason === "NEVER_RECOMMEND" ? "NEVER_RECOMMEND" : track.personalizationScore?.components?.trackFeedbackAdjustment > 0 ? "LIKED" : track.personalizationScore?.components?.trackFeedbackAdjustment < 0 ? "DISLIKED" : null}
                    initialArtistState={track.personalizationScore?.components?.artistFeedbackAdjustment > 0 ? "PREFER" : track.personalizationScore?.components?.artistFeedbackAdjustment < 0 ? "RECOMMEND_LESS" : null}
                    initialFitState={track.personalizationScore?.components?.playlistFitAdjustment > 0 ? "GOOD_FIT" : track.personalizationScore?.components?.playlistFitAdjustment < 0 ? "POOR_FIT" : null}
                    previousTrack={index > 0 ? { id: preview.tracks[index - 1].id, title: preview.tracks[index - 1].title, bpm: preview.tracks[index - 1].bpm, effectiveBpm: preview.tracks[index - 1].effectiveBpm, mood: preview.tracks[index - 1].audioFeature?.effectiveMood ?? preview.tracks[index - 1].audioFeature?.valence, energy: preview.tracks[index - 1].audioFeature?.effectiveEnergy ?? preview.tracks[index - 1].audioFeature?.energy } : null}
                    currentTrack={{ bpm: track.bpm, effectiveBpm: track.effectiveBpm, mood: track.audioFeature?.effectiveMood ?? track.audioFeature?.valence, energy: track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy }}
                  />
                  <span title="Manual exclusions apply during regeneration"><Ban size={14} /></span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {advancedPlaylist && (
        <AdvancedRegenerationWorkspace
          playlistId={advancedPlaylist.id}
          playlistName={advancedPlaylist.plexPlaylistTitle}
          onClose={() => setAdvancedPlaylist(null)}
          onApplied={(nextMessage) => {
            setMessage(nextMessage);
            setError("");
            fetchPlaylists();
          }}
        />
      )}
    </main>
  );
}
