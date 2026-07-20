"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Ban, BookMarked, CheckCircle2, ListChecks, Network, Play, RefreshCw, Save, Sparkles, Trash2, Undo2, Upload } from "lucide-react";
import BpmPresetPicker from "@/components/BpmPresetPicker";
import MoodPresetPicker from "@/components/MoodPresetPicker";
import MoodBlendingBetaPanel, {
  DEFAULT_MOOD_BLEND_BETA_SETTINGS,
  type MoodBlendBetaSettings,
} from "@/components/MoodBlendingBetaPanel";
import { moodBlendValidationMessage } from "@/lib/moodBlendingUi";
import { BPM_PRESET_VERSION, bpmPresetLabel, bpmPresetRangeLabel, getBpmPreset, type BpmPreset } from "@/lib/bpmPresets";
import TrackPreviewButton from "@/components/TrackPreviewButton";
import TrackFeedbackMenu from "@/components/TrackFeedbackMenu";
import AdaptiveScoreBreakdown from "@/components/AdaptiveScoreBreakdown";
import SmartMixExplanation from "@/components/SmartMixExplanation";
import SmartMixGenerationInsights from "@/components/SmartMixGenerationInsights";
import PlaylistGenerationProgress from "@/components/PlaylistGenerationProgress";
import HouseholdPlaylistSettings, { defaultHouseholdPlaylistDraft, type HouseholdPlaylistDraft } from "@/components/HouseholdPlaylistSettings";
import { cancelPlaylistGeneration, generatePlaylistPreviewInBackground, type PlaylistGenerationJobView } from "@/lib/playlistGenerationClient";
import { getMoodPreset, moodPresetLabel, MOOD_PRESET_VERSION, type MoodPreset } from "@/lib/moodPresets";
import { buildSmartPresetConfig, SMART_PRESET_VERSION, smartPlaylistPresets, type SmartPlaylistPreset } from "@/lib/smartPlaylistPresets";
import styles from "./smart-builder.module.css";

type Rule = {
  field: string;
  operator: string;
  value: string;
};

type SafetyRules = {
  avoidSameArtistBackToBack: boolean;
  limitTracksPerArtist: boolean;
  maxTracksPerArtist: string;
  limitTracksPerAlbum: boolean;
  maxTracksPerAlbum: string;
  warnIfFewerThan: boolean;
  minimumTrackCount: string;
};

type MoodBlendMode = MoodBlendBetaSettings["moodBlendMode"];

type RangeState = {
  bpmMin: string;
  bpmMax: string;
  energyMin: string;
  energyMax: string;
  moodMin: string;
  moodMax: string;
  popularityMin: string;
  popularityMax: string;
};

type ServerOption = {
  id: string;
  name: string;
  libraries: Array<{ id: string; name: string }>;
};

type PlaylistPreviewSummary = {
  targetTrackCount: number;
  matchingTrackCount: number;
  finalTrackCount: number;
  estimatedDurationMinutes: number;
  manualExclusionsRemoved?: number;
  removedBySafetyRules?: number;
  safetyRuleSummary?: string;
  smartPresetName?: string | null;
  moodPresetName?: string | null;
  moodPresetModified?: boolean;
  bpmPresetName?: string | null;
  bpmPresetModified?: boolean;
  engineVersion?: "v1" | "v2";
  engineLabel?: string;
  moodBlendMode?: MoodBlendMode;
  moodBlendLabel?: string;
  selectedMoodPath?: string[];
  allowedMoods?: string[];
  moodCurve?: any;
  moodCoverage?: any;
  moodWarnings?: string[];
  moodFallbackCount?: number;
  moodConflictCount?: number;
  missingMoodCount?: number;
  bpmRange: string;
  energyRange: string;
  moodRange: string;
  popularityRange: string;
};

type MoodPresetMetadata = {
  moodPresetId?: string;
  moodPresetName?: string;
  moodPresetVersion?: string;
  moodPresetModified?: boolean;
};

type BpmPresetMetadata = {
  bpmPresetId?: string;
  bpmPresetName?: string;
  bpmPresetVersion?: string;
  bpmPresetModified?: boolean;
};

type PlaylistPreviewState = {
  previewId: string;
  trackIds: string[];
  totalPreviewTrackCount: number;
  summary: PlaylistPreviewSummary;
  filterSummary: Array<{ label: string; value: string }>;
  warnings: string[];
  signature: string;
  generationInsights?: any;
  rejectedCandidates?: any[];
};

const emptyRanges: RangeState = {
  bpmMin: "",
  bpmMax: "",
  energyMin: "",
  energyMax: "",
  moodMin: "",
  moodMax: "",
  popularityMin: "",
  popularityMax: "",
};

function formatDuration(ms?: number | null) {
  if (!ms) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatEstimatedDuration(minutes?: number | null) {
  if (!minutes) return "0 min";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function rangeFromRules(rules: Rule[], field: string) {
  const min = rules.find((rule) => rule.field === field && (rule.operator === "gte" || rule.operator === "gt"))?.value || "";
  const max = rules.find((rule) => rule.field === field && (rule.operator === "lte" || rule.operator === "lt"))?.value || "";
  return { min, max };
}

function rangesFromPreset(preset: SmartPlaylistPreset): RangeState {
  const bpm = rangeFromRules(preset.filters.rules, "tempo");
  const energy = rangeFromRules(preset.filters.rules, "energy");
  const mood = rangeFromRules(preset.filters.rules, "valence");
  const popularity = rangeFromRules(preset.filters.rules, "popularity");
  return {
    bpmMin: bpm.min,
    bpmMax: bpm.max,
    energyMin: energy.min,
    energyMax: energy.max,
    moodMin: mood.min,
    moodMax: mood.max,
    popularityMin: popularity.min,
    popularityMax: popularity.max,
  };
}

function safetyFromPreset(preset: SmartPlaylistPreset): SafetyRules {
  return {
    avoidSameArtistBackToBack: preset.filters.safetyRules.avoidSameArtistBackToBack,
    limitTracksPerArtist: preset.filters.safetyRules.limitTracksPerArtist,
    maxTracksPerArtist: String(preset.filters.safetyRules.maxTracksPerArtist),
    limitTracksPerAlbum: preset.filters.safetyRules.limitTracksPerAlbum,
    maxTracksPerAlbum: String(preset.filters.safetyRules.maxTracksPerAlbum),
    warnIfFewerThan: preset.filters.safetyRules.warnIfFewerThan,
    minimumTrackCount: String(preset.filters.safetyRules.minimumTrackCount),
  };
}

function rangeRules(field: string, min: string, max: string): Rule[] {
  return [
    ...(min.trim() ? [{ field, operator: "gte", value: min.trim() }] : []),
    ...(max.trim() ? [{ field, operator: "lte", value: max.trim() }] : []),
  ];
}

function presetRangeValues(range?: [number, number] | null) {
  return {
    min: range ? String(range[0]) : "",
    max: range ? String(range[1]) : "",
  };
}

function bpmRangeMatchesPreset(ranges: RangeState, preset?: BpmPreset | null) {
  if (!preset) return true;
  const min = preset.minBpm == null ? "" : String(preset.minBpm);
  const max = preset.maxBpm == null ? "" : String(preset.maxBpm);
  return ranges.bpmMin === min && ranges.bpmMax === max;
}

function moodBlendLabel(mode?: MoodBlendMode) {
  if (mode === "smooth_transition") return "Smooth Transition";
  if (mode === "strict_matching") return "Strict Matching";
  if (mode === "mixed_mood") return "Mixed Mood";
  return "Off";
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

export default function SmartBuilderPage() {
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const selectedPreset = useMemo(
    () => smartPlaylistPresets.find((preset) => preset.id === selectedPresetId) || null,
    [selectedPresetId],
  );
  const [playlistName, setPlaylistName] = useState("");
  const [limit, setLimit] = useState(50);
  const [genres, setGenres] = useState("");
  const [ranges, setRanges] = useState<RangeState>(emptyRanges);
  const [moodPresetMetadata, setMoodPresetMetadata] = useState<MoodPresetMetadata>({});
  const [bpmPresetMetadata, setBpmPresetMetadata] = useState<BpmPresetMetadata>({});
  const [moodBlendSettings, setMoodBlendSettings] = useState<MoodBlendBetaSettings>(DEFAULT_MOOD_BLEND_BETA_SETTINGS);
  const [safetyRules, setSafetyRules] = useState<SafetyRules>({
    avoidSameArtistBackToBack: true,
    limitTracksPerArtist: true,
    maxTracksPerArtist: "3",
    limitTracksPerAlbum: false,
    maxTracksPerAlbum: "2",
    warnIfFewerThan: true,
    minimumTrackCount: "10",
  });
  const [serverId, setServerId] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [tracks, setTracks] = useState<any[]>([]);
  const [removedTrack, setRemovedTrack] = useState<{ track: any; index: number; previous: any | null; feedback?: { type: string; id?: string } } | null>(null);
  const [playlistPreview, setPlaylistPreview] = useState<PlaylistPreviewState | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [generationJob, setGenerationJob] = useState<PlaylistGenerationJobView | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [generatedPlaylists, setGeneratedPlaylists] = useState<Array<{ id: string; plexPlaylistTitle: string; trackCount: number }>>([]);
  const [coordination, setCoordination] = useState({ enabled: false, relationshipType: "SISTER", relatedPlaylistIds: [] as string[], maximumSharedTrackPercentage: 20, overlapEnforcement: "SOFT_TARGET", allowSharedCoreTracks: true, preferGloballyUnusedTracks: true, unusedTrackPreferenceStrength: 0.5, crossPlaylistArtistBalancingEnabled: true, keepDistinct: true });
  const [personalizationMode, setPersonalizationMode] = useState<"INDIVIDUAL" | "HOUSEHOLD">("INDIVIDUAL");
  const [householdCollaboration, setHouseholdCollaboration] = useState<HouseholdPlaylistDraft>({ ...defaultHouseholdPlaylistDraft });

  useEffect(() => {
    const loadDefaults = async () => {
      try {
        const res = await axios.get("/api/settings/library-selection");
        setServerId(res.data.defaultServerId || "");
        setLibraryId(res.data.defaultLibraryId || "");
        setServers(res.data.servers || []);
      } catch (error) {
        console.error("Failed to load library defaults", error);
      }
    };

    loadDefaults();
    axios.get("/api/generated-playlists").then((response) => setGeneratedPlaylists(response.data.playlists || [])).catch(() => setGeneratedPlaylists([]));
  }, []);

  const clearPreview = () => {
    setTracks([]);
    setPlaylistPreview(null);
    setPreviewError("");
    setNotice("");
  };

  const updateMoodBlendSettings = (patch: Partial<MoodBlendBetaSettings>) => {
    setMoodBlendSettings((current) => ({ ...current, ...patch }));
    clearPreview();
  };

  const selectPreset = (preset: SmartPlaylistPreset) => {
    const config = buildSmartPresetConfig(preset);
    setSelectedPresetId(preset.id);
    setPlaylistName(preset.suggestedPlaylistName);
    setLimit(config.limit);
    setGenres("");
    setRanges(rangesFromPreset(preset));
    setMoodPresetMetadata((current) => current.moodPresetId ? { ...current, moodPresetModified: true } : current);
    setSafetyRules(safetyFromPreset(preset));
    clearPreview();
  };

  const selectedMoodPreset = getMoodPreset(moodPresetMetadata.moodPresetId);
  const displayedMoodPreset = moodPresetLabel(moodPresetMetadata.moodPresetName, moodPresetMetadata.moodPresetModified);
  const selectedBpmPreset = getBpmPreset(bpmPresetMetadata.bpmPresetId);
  const bpmPresetModified = !bpmRangeMatchesPreset(ranges, selectedBpmPreset);
  const displayedBpmPresetBase = selectedBpmPreset
    ? `${bpmPresetLabel(bpmPresetMetadata.bpmPresetName)} · ${bpmPresetRangeLabel(selectedBpmPreset)}`
    : "Custom";
  const displayedBpmPreset = selectedBpmPreset && bpmPresetModified
    ? `${bpmPresetLabel(bpmPresetMetadata.bpmPresetName)} modified`
    : displayedBpmPresetBase;

  const markMoodPresetModified = () => {
    setMoodPresetMetadata((current) => (
      current.moodPresetId && !current.moodPresetModified
        ? { ...current, moodPresetModified: true }
        : current
    ));
  };

  const clearMoodPresetMetadata = () => {
    setMoodPresetMetadata({});
    clearPreview();
  };

  const applyMoodPreset = (preset: MoodPreset) => {
    const bpm = presetRangeValues(preset.bpmRange);
    const energy = presetRangeValues(preset.energyRange);
    const mood = presetRangeValues(preset.moodRange);
    setRanges((current) => ({
      ...current,
      bpmMin: bpm.min,
      bpmMax: bpm.max,
      energyMin: energy.min,
      energyMax: energy.max,
      moodMin: mood.min,
      moodMax: mood.max,
    }));
    setMoodPresetMetadata({
      moodPresetId: preset.id,
      moodPresetName: preset.name,
      moodPresetVersion: MOOD_PRESET_VERSION,
      moodPresetModified: false,
    });
    if (!playlistName.trim()) setPlaylistName(selectedPreset ? `${preset.name} ${selectedPreset.name} Mix` : `${preset.name} Mix`);
    clearPreview();
  };

  const clearBpmPresetMetadata = () => {
    setBpmPresetMetadata({});
    clearPreview();
  };

  const applyBpmPreset = (preset: BpmPreset) => {
    setRanges((current) => ({
      ...current,
      bpmMin: preset.minBpm == null ? "" : String(preset.minBpm),
      bpmMax: preset.maxBpm == null ? "" : String(preset.maxBpm),
    }));
    setBpmPresetMetadata({
      bpmPresetId: preset.id,
      bpmPresetName: preset.name,
      bpmPresetVersion: BPM_PRESET_VERSION,
      bpmPresetModified: false,
    });
    if (!playlistName.trim()) setPlaylistName(`${preset.name} Mix`);
    clearPreview();
  };

  const selectedServer = servers.find((server) => server.id === serverId) || null;
  const availableLibraries = selectedServer?.libraries || servers.flatMap((server) => server.libraries || []);

  const buildRules = () => [
    ...rangeRules("tempo", ranges.bpmMin, ranges.bpmMax),
    ...rangeRules("energy", ranges.energyMin, ranges.energyMax),
    ...rangeRules("valence", ranges.moodMin, ranges.moodMax),
    ...rangeRules("popularity", ranges.popularityMin, ranges.popularityMax),
  ];

  const buildGenreRules = () => genres
    .split(",")
    .map((genre) => genre.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((genre) => ({ field: "genre", operator: "contains", value: genre }));

  const buildRuleTree = () => {
    const baseRules = buildRules();
    const genreRules = buildGenreRules();
    const children: any[] = [];
    if (baseRules.length > 0) {
      children.push({ type: "group", combinator: "AND", children: baseRules.map((rule) => ({ type: "rule", ...rule })) });
    }
    if (genreRules.length > 0) {
      children.push({ type: "group", combinator: "OR", children: genreRules.map((rule) => ({ type: "rule", ...rule })) });
    }
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return { type: "group", combinator: "AND", children };
  };

  const selectedPresetDetails = [
    ...(selectedPreset ? [`Smart Builder preset: ${selectedPreset.name}`] : []),
    ...(moodPresetMetadata.moodPresetName ? [`Mood preset: ${displayedMoodPreset}`] : []),
    ...(bpmPresetMetadata.bpmPresetName ? [`BPM preset: ${displayedBpmPreset}`] : []),
  ];
  const selectedPresetDescription = selectedPresetDetails.join("; ");

  const playlistPayload = () => {
    const rules = [...buildRules(), ...buildGenreRules()];
    return {
      rules,
      ruleTree: buildRuleTree(),
      limit,
      serverId: serverId || undefined,
      libraryId: libraryId || undefined,
      duplicateStrategy: "song_artist",
      preferNonLive: true,
      excludeRemasters: false,
      negativeFilters: {
        excludeHoliday: false,
        excludeLive: false,
        excludeRemasters: false,
        excludeExplicit: false,
        excludeIntroOutro: false,
      },
      safetyRules: {
        avoidSameArtistBackToBack: safetyRules.avoidSameArtistBackToBack,
        limitTracksPerArtist: safetyRules.limitTracksPerArtist,
        maxTracksPerArtist: safetyRules.maxTracksPerArtist || undefined,
        limitTracksPerAlbum: safetyRules.limitTracksPerAlbum,
        maxTracksPerAlbum: safetyRules.maxTracksPerAlbum || undefined,
        warnIfFewerThan: safetyRules.warnIfFewerThan,
        minimumTrackCount: safetyRules.minimumTrackCount || undefined,
      },
      engineVersion: "v2" as const,
      moodBlendMode: moodBlendSettings.moodBlendMode,
      selectedMoodPath: moodBlendSettings.moodBlendMode === "mixed_mood" ? [] : moodBlendSettings.selectedMoodPath,
      allowedMoods: moodBlendSettings.moodBlendMode === "mixed_mood" ? moodBlendSettings.allowedMoods : [],
      moodStrength: moodBlendSettings.moodStrength,
      transitionSmoothness: moodBlendSettings.transitionSmoothness,
      moodStrictness: moodBlendSettings.moodStrictness,
      fallbackTolerance: moodBlendSettings.fallbackTolerance,
      bridgeTrackPreference: moodBlendSettings.bridgeTrackPreference,
      moodVariety: moodBlendSettings.moodVariety,
      conflictSensitivity: moodBlendSettings.conflictSensitivity,
      selectedMoodPreset: moodBlendSettings.selectedMoodPreset,
      ...(selectedPreset
        ? {
            smartPresetId: selectedPreset.id,
            smartPresetName: selectedPreset.name,
            smartPresetVersion: SMART_PRESET_VERSION,
          }
        : {}),
      ...moodPresetMetadata,
      ...bpmPresetMetadata,
      ...(bpmPresetMetadata.bpmPresetId ? { bpmPresetModified } : {}),
      pinnedTrackIds: [],
      excludedTrackIds: [],
      ...(coordination.enabled ? { coordinationSetup: coordination } : {}),
      personalizationMode,
      ...(personalizationMode === "HOUSEHOLD" ? { householdCollaboration } : {}),
    };
  };

  const previewSignature = () => JSON.stringify(playlistPayload());
  const isPreviewCurrent = Boolean(playlistPreview && playlistPreview.signature === previewSignature());
  const playlistNameReady = playlistName.trim().length > 0;
  const moodValidationMessage = moodBlendValidationMessage(moodBlendSettings);
  const canPreview = !loading && !moodValidationMessage;
  const canCreate = Boolean(playlistNameReady && playlistPreview && isPreviewCurrent && tracks.length > 0);

  const updateRange = (key: keyof RangeState, value: string) => {
    if (key.startsWith("bpm") || key.startsWith("energy") || key.startsWith("mood")) markMoodPresetModified();
    if (key.startsWith("bpm")) setBpmPresetMetadata({});
    setRanges((current) => ({ ...current, [key]: value }));
    clearPreview();
  };

  const updateSafetyRules = (patch: Partial<SafetyRules>) => {
    setSafetyRules((current) => ({ ...current, ...patch }));
    clearPreview();
  };

  const previewPlaylist = async () => {
    if (moodValidationMessage) {
      setPreviewError(moodValidationMessage);
      return;
    }
    const payload = playlistPayload();
    if (!payload) return;
    setLoading(true);
    setPreviewError("");
    setNotice("");
    try {
      const signature = JSON.stringify(payload);
      const data = await generatePlaylistPreviewInBackground(payload, setGenerationJob);
      setTracks(data.tracks || []);
      setPlaylistPreview({
        previewId: data.previewId,
        trackIds: data.trackIds || [],
        totalPreviewTrackCount: data.totalPreviewTrackCount || 0,
        summary: data.summary,
        filterSummary: data.filterSummary || [],
        warnings: data.warnings || [],
        generationInsights: data.generationInsights || null,
        rejectedCandidates: data.rejectedCandidates || [],
        signature,
      });
    } catch (error: any) {
      console.error(error);
      setPreviewError(error?.message || "Unable to generate playlist preview. Adjust the preset settings and try again.");
    } finally {
      setLoading(false);
    }
  };

  function removePreviewTrack(track: any, index: number) {
    setTracks((current) => current.filter((item) => item.id !== track.id));
    setPlaylistPreview((current) => current ? { ...current, trackIds: current.trackIds.filter((id) => id !== track.id), summary: { ...current.summary, finalTrackCount: Math.max(0, current.summary.finalTrackCount - 1) } } : current);
    setRemovedTrack({ track, index, previous: index > 0 ? tracks[index - 1] : null });
  }

  async function giveRemovalReason(reason: string) {
    if (!removedTrack || !playlistPreview) return;
    const common = { trackId: removedTrack.track.id, generationId: playlistPreview.previewId, reason, sourceSurface: "PLAYLIST_PREVIEW" };
    try {
      let result: any; let type = "";
      if (reason === "DISLIKED_TRACK") { result = await fetch("/api/feedback/tracks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...common, state: "DISLIKED" }) }).then((response) => response.json()); type = "track"; }
      else if (reason === "BAD_BPM_TRANSITION" && removedTrack.previous) { result = await fetch("/api/feedback/transitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...common, previousTrackId: removedTrack.previous.id, currentTrackId: removedTrack.track.id }) }).then((response) => response.json()); type = "transitions"; }
      else { result = await fetch("/api/feedback/playlist-fit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...common, state: "POOR_FIT" }) }).then((response) => response.json()); type = "fits"; }
      setRemovedTrack((current) => current ? { ...current, feedback: result.unchanged ? undefined : { type, id: result.feedback?.id } } : null);
    } catch { setNotice("Track removed. Optional feedback could not be saved."); }
  }

  async function undoRemoval() {
    if (!removedTrack) return;
    setTracks((current) => { const next = [...current]; next.splice(Math.min(removedTrack.index, next.length), 0, removedTrack.track); return next; });
    setPlaylistPreview((current) => { if (!current) return current; const ids = [...current.trackIds]; ids.splice(Math.min(removedTrack.index, ids.length), 0, removedTrack.track.id); return { ...current, trackIds: ids, summary: { ...current.summary, finalTrackCount: current.summary.finalTrackCount + 1 } }; });
    if (removedTrack.feedback?.type === "track") await fetch("/api/feedback/tracks", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackId: removedTrack.track.id, sourceSurface: "PLAYLIST_PREVIEW" }) });
    else if (removedTrack.feedback?.id) await fetch("/api/feedback/management", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: removedTrack.feedback.type, id: removedTrack.feedback.id }) });
    setRemovedTrack(null);
  }

  const saveRecipe = async () => {
    const payload = playlistPayload();
    if (!payload || !playlistName.trim()) {
      alert("Enter a playlist name before saving a recipe.");
      return;
    }

    setSavingRecipe(true);
    try {
      await axios.post("/api/playlist-recipes", {
        name: playlistName.trim(),
        description: selectedPresetDescription || "Smart Builder custom setup",
        filters: payload,
      });
      setNotice(`Saved "${playlistName.trim()}" as a playlist recipe.`);
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.error || "Failed to save playlist recipe");
    } finally {
      setSavingRecipe(false);
    }
  };

  const createPlaylist = async () => {
    const payload = playlistPayload();
    if (!payload || !playlistPreview || !isPreviewCurrent) {
      alert("Preview this Smart Builder setup before creating the playlist.");
      return;
    }
    if (!playlistName.trim() || tracks.length === 0) {
      alert("Enter a playlist name and preview at least one track.");
      return;
    }

    setCreating(true);
    try {
      await axios.post("/api/playlists/create-from-preview", {
        name: playlistName.trim(),
        trackIds: playlistPreview.trackIds,
        rulesSnapshot: payload.ruleTree || payload.rules,
        optionsSnapshot: payload,
        previewId: playlistPreview.previewId,
        sourceType: "smart_builder",
        filters: payload,
        manualExclusionsApplied: playlistPreview.summary.manualExclusionsRemoved || 0,
        removedBySafetyRules: playlistPreview.summary.removedBySafetyRules || 0,
        safetyRulesApplied: Boolean(playlistPreview.summary.safetyRuleSummary && playlistPreview.summary.safetyRuleSummary !== "Safety rules: off"),
      });
      setNotice(`Created "${playlistName.trim()}" in Plex${selectedPresetDetails.length ? ` with ${selectedPresetDetails.join(", ")}` : ""}.`);
    } catch (error: any) {
      console.error(error);
      alert(error.response?.data?.error || "Failed to create playlist in Plex");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>
            <Sparkles size={14} />
            Smart Playlist Builder v1
          </span>
          <h2>What kind of playlist do you want to build?</h2>
          <p>Start with a playlist goal like Workout, Chill, Party, Focus, or Discovery, then preview before creating.</p>
        </div>
        <Link href="/builder" className={styles.secondaryButton}>
          <ArrowLeft size={16} />
          Standard Builder
        </Link>
      </header>

      <section className={styles.presetGrid} aria-label="Smart playlist presets">
        {smartPlaylistPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => selectPreset(preset)}
            className={`${styles.presetCard} ${selectedPresetId === preset.id ? styles.selectedPreset : ""}`}
          >
            <div className={styles.presetTop}>
              <h3>{preset.name}</h3>
              {selectedPresetId === preset.id && <CheckCircle2 size={18} />}
            </div>
            <p>{preset.description}</p>
            <div className={styles.badgeRow}>
              {preset.badges.map((badge) => (
                <span key={badge}>{badge}</span>
              ))}
            </div>
          </button>
        ))}
      </section>

      <MoodPresetPicker
        title="Choose a mood"
        description="Tune your smart playlist with mood, energy, and BPM presets."
        selectedLabel={displayedMoodPreset}
        selectedPresetId={moodPresetMetadata.moodPresetId}
        selectedPreset={selectedMoodPreset}
        onSelect={applyMoodPreset}
        onClear={clearMoodPresetMetadata}
        classes={{
          section: styles.moodPresetSection,
          header: styles.moodPresetHeader,
          grid: styles.moodPresetGrid,
          card: styles.moodPresetCard,
          activeCard: styles.moodPresetActive,
          badgeRow: styles.moodBadgeRow,
          footer: styles.moodPresetFooter,
          clearButton: styles.ghostButton,
        }}
      />

      <BpmPresetPicker
        selectedLabel={displayedBpmPreset}
        selectedPresetId={bpmPresetMetadata.bpmPresetId}
        selectedPreset={selectedBpmPreset}
        onSelect={applyBpmPreset}
        onClear={clearBpmPresetMetadata}
        classes={{
          section: styles.moodPresetSection,
          header: styles.moodPresetHeader,
          grid: styles.moodPresetGrid,
          card: styles.moodPresetCard,
          activeCard: styles.moodPresetActive,
          badgeRow: styles.moodBadgeRow,
          footer: styles.moodPresetFooter,
          clearButton: styles.ghostButton,
        }}
      />

      <section className={styles.selectionSummary} aria-label="Selected Smart Builder setup">
        {selectedPreset && <span>Smart preset: <strong>{selectedPreset.name}</strong></span>}
        {moodPresetMetadata.moodPresetName && <span>Mood preset: <strong>{displayedMoodPreset}</strong></span>}
        {bpmPresetMetadata.bpmPresetName && <span>BPM preset: <strong>{displayedBpmPreset}</strong></span>}
        {selectedPresetDetails.length === 0 && <span>Selected: <strong>None</strong></span>}
        <p>Choose any Smart, Mood, or BPM preset, or adjust filters manually before previewing.</p>
      </section>

      <section className={styles.workspace}>
        <div className={styles.customizeColumn}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h3>Customize your Smart Playlist</h3>
                <p>Choose a playlist goal, tune the mood, adjust filters, then preview before creating.</p>
              </div>
              {selectedPreset && (
                <button type="button" onClick={() => { setSelectedPresetId(""); clearPreview(); }} className={styles.ghostButton}>
                  Clear Smart preset
                </button>
              )}
            </div>
            {selectedPreset ? (
              <div className={styles.explanation}>
                <strong>Selected Smart preset: {selectedPreset.name}</strong>
                <span>{selectedPreset.explanation}</span>
              </div>
            ) : (
              <div className={styles.helperNotice}>
                Smart presets are optional. Choose a Mood preset, BPM preset, Smart preset, or adjust filters manually.
              </div>
            )}

            <div className={styles.formGrid}>
              <label className={styles.fieldLabel}>
                Playlist name
                <input value={playlistName} onChange={(event) => { setPlaylistName(event.target.value); clearPreview(); }} className={styles.input} />
              </label>
              <label className={styles.fieldLabel}>
                Track limit
                <input type="number" min="1" value={limit} onChange={(event) => { setLimit(Number(event.target.value)); clearPreview(); }} className={styles.input} />
              </label>
              <label className={styles.fieldLabel}>
                Server
                <select value={serverId} onChange={(event) => { setServerId(event.target.value); setLibraryId(""); clearPreview(); }} className={styles.select}>
                  <option value="">Any connected server</option>
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>{server.name}</option>
                  ))}
                </select>
              </label>
              <label className={styles.fieldLabel}>
                Library
                <select value={libraryId} onChange={(event) => { setLibraryId(event.target.value); clearPreview(); }} className={styles.select}>
                  <option value="">Any music library</option>
                  {availableLibraries.map((library) => (
                    <option key={library.id} value={library.id}>{library.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className={styles.fieldLabel}>
              Optional genres
              <input value={genres} onChange={(event) => { setGenres(event.target.value); clearPreview(); }} placeholder="rock, pop, synthwave" className={styles.input} />
            </label>

            <div className={styles.rangeGrid}>
              <label className={styles.fieldLabel}>BPM min<input value={ranges.bpmMin} onChange={(event) => updateRange("bpmMin", event.target.value)} className={styles.input} /></label>
              <label className={styles.fieldLabel}>BPM max<input value={ranges.bpmMax} onChange={(event) => updateRange("bpmMax", event.target.value)} className={styles.input} /></label>
              <label className={styles.fieldLabel}>Energy min<input value={ranges.energyMin} onChange={(event) => updateRange("energyMin", event.target.value)} className={styles.input} /></label>
              <label className={styles.fieldLabel}>Energy max<input value={ranges.energyMax} onChange={(event) => updateRange("energyMax", event.target.value)} className={styles.input} /></label>
              <label className={styles.fieldLabel}>Mood min<input value={ranges.moodMin} onChange={(event) => updateRange("moodMin", event.target.value)} className={styles.input} /></label>
              <label className={styles.fieldLabel}>Mood max<input value={ranges.moodMax} onChange={(event) => updateRange("moodMax", event.target.value)} className={styles.input} /></label>
              <label className={styles.fieldLabel}>Popularity min<input value={ranges.popularityMin} onChange={(event) => updateRange("popularityMin", event.target.value)} className={styles.input} /></label>
              <label className={styles.fieldLabel}>Popularity max<input value={ranges.popularityMax} onChange={(event) => updateRange("popularityMax", event.target.value)} className={styles.input} /></label>
            </div>
            <MoodBlendingBetaPanel
              settings={moodBlendSettings}
              onChange={updateMoodBlendSettings}
              serverId={serverId}
              libraryId={libraryId}
            />
            </div>

            <HouseholdPlaylistSettings
              mode={personalizationMode}
              value={householdCollaboration}
              onModeChange={(nextMode) => { setPersonalizationMode(nextMode); clearPreview(); }}
              onChange={(nextValue) => { setHouseholdCollaboration(nextValue); clearPreview(); }}
            />

            <div className={styles.panel}>
              <div className={styles.panelHeader}><div><h3><Network size={16} /> Playlist Coordination</h3><p>Coordinate this mix with existing Smart Mix playlists after it is created.</p></div></div>
              <label className={styles.checkLabel}><input type="checkbox" checked={coordination.enabled} onChange={(event) => { setCoordination({ ...coordination, enabled: event.target.checked }); clearPreview(); }} /> Coordinate with other playlists</label>
              {coordination.enabled && <>
                <div className={styles.formGrid}>
                  <label className={styles.fieldLabel}>Relationship<select className={styles.select} value={coordination.relationshipType} onChange={(event) => setCoordination({ ...coordination, relationshipType: event.target.value })}><option value="SISTER">Sister playlist</option><option value="RELATED">Related playlist</option><option value="DISTINCT_FROM">Keep distinct from selected</option></select></label>
                  <label className={styles.fieldLabel}>Enforcement<select className={styles.select} value={coordination.overlapEnforcement} onChange={(event) => setCoordination({ ...coordination, overlapEnforcement: event.target.value })}><option value="WARNING_ONLY">Warning</option><option value="SOFT_TARGET">Soft target</option><option value="HARD_MAXIMUM">Hard maximum</option></select></label>
                  <label className={styles.fieldLabel}>Maximum shared tracks: {coordination.maximumSharedTrackPercentage}%<input type="range" min="0" max="100" value={coordination.maximumSharedTrackPercentage} onChange={(event) => setCoordination({ ...coordination, maximumSharedTrackPercentage: Number(event.target.value) })} /></label>
                  <label className={styles.fieldLabel}>Unused track preference: {Math.round(coordination.unusedTrackPreferenceStrength * 100)}%<input type="range" min="0" max="1" step="0.05" value={coordination.unusedTrackPreferenceStrength} onChange={(event) => setCoordination({ ...coordination, unusedTrackPreferenceStrength: Number(event.target.value) })} /></label>
                </div>
                <div className={styles.safetyGrid}>
                  <label className={styles.checkLabel}><input type="checkbox" checked={coordination.allowSharedCoreTracks} onChange={(event) => setCoordination({ ...coordination, allowSharedCoreTracks: event.target.checked })} /> Allow shared core tracks</label>
                  <label className={styles.checkLabel}><input type="checkbox" checked={coordination.preferGloballyUnusedTracks} onChange={(event) => setCoordination({ ...coordination, preferGloballyUnusedTracks: event.target.checked })} /> Prefer unused Smart Mix tracks</label>
                  <label className={styles.checkLabel}><input type="checkbox" checked={coordination.crossPlaylistArtistBalancingEnabled} onChange={(event) => setCoordination({ ...coordination, crossPlaylistArtistBalancingEnabled: event.target.checked })} /> Balance artists across playlists</label>
                  <label className={styles.checkLabel}><input type="checkbox" checked={coordination.keepDistinct} onChange={(event) => setCoordination({ ...coordination, keepDistinct: event.target.checked })} /> Keep identity patterns distinct</label>
                </div>
                <div className={styles.explanation}><strong>Related playlists ({coordination.relatedPlaylistIds.length})</strong><span>Select existing playlists; names are never entered manually.</span></div>
                <div className={styles.safetyGrid}>{generatedPlaylists.map((playlist) => <label className={styles.checkLabel} key={playlist.id}><input type="checkbox" checked={coordination.relatedPlaylistIds.includes(playlist.id)} onChange={(event) => setCoordination({ ...coordination, relatedPlaylistIds: event.target.checked ? coordination.relatedPlaylistIds.concat(playlist.id) : coordination.relatedPlaylistIds.filter((id) => id !== playlist.id) })} /> {playlist.plexPlaylistTitle} ({playlist.trackCount})</label>)}</div>
                <div className={styles.helperNotice}>Selected related playlists: {coordination.relatedPlaylistIds.length} · Configured maximum: {coordination.maximumSharedTrackPercentage}% · Status: evaluated during generation and before Plex writes.</div>
              </>}
            </div>

            <div className={styles.panel}>
              <h3>Safety Rules</h3>
              <div className={styles.safetyGrid}>
                <label className={styles.checkLabel}>
                  <input type="checkbox" checked={safetyRules.avoidSameArtistBackToBack} onChange={(event) => updateSafetyRules({ avoidSameArtistBackToBack: event.target.checked })} />
                  Avoid same artist back-to-back
                </label>
                <div className={styles.safetyControl}>
                  <label className={styles.checkLabel}>
                    <input type="checkbox" checked={safetyRules.limitTracksPerArtist} onChange={(event) => updateSafetyRules({ limitTracksPerArtist: event.target.checked })} />
                    Limit tracks per artist
                  </label>
                  <input type="number" min="1" value={safetyRules.maxTracksPerArtist} disabled={!safetyRules.limitTracksPerArtist} onChange={(event) => updateSafetyRules({ maxTracksPerArtist: event.target.value })} className={styles.input} />
                </div>
                <div className={styles.safetyControl}>
                  <label className={styles.checkLabel}>
                    <input type="checkbox" checked={safetyRules.limitTracksPerAlbum} onChange={(event) => updateSafetyRules({ limitTracksPerAlbum: event.target.checked })} />
                    Limit tracks per album
                  </label>
                  <input type="number" min="1" value={safetyRules.maxTracksPerAlbum} disabled={!safetyRules.limitTracksPerAlbum} onChange={(event) => updateSafetyRules({ maxTracksPerAlbum: event.target.value })} className={styles.input} />
                </div>
                <div className={styles.safetyControl}>
                  <label className={styles.checkLabel}>
                    <input type="checkbox" checked={safetyRules.warnIfFewerThan} onChange={(event) => updateSafetyRules({ warnIfFewerThan: event.target.checked })} />
                    Warn if fewer than
                  </label>
                  <input type="number" min="1" value={safetyRules.minimumTrackCount} disabled={!safetyRules.warnIfFewerThan} onChange={(event) => updateSafetyRules({ minimumTrackCount: event.target.value })} className={styles.input} />
                </div>
              </div>
              <div className={styles.actionRow}>
                <button type="button" onClick={previewPlaylist} disabled={!canPreview} className={styles.primaryButton}>
                  {loading ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                  Preview Playlist
                </button>
                <button type="button" onClick={saveRecipe} disabled={!playlistNameReady || savingRecipe} className={styles.secondaryButton}>
                  {savingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                  Save as Recipe
                </button>
              </div>
              {!playlistNameReady && <p className={styles.helperText}>Preview can run now. Add a playlist name before saving or creating.</p>}
            </div>
          </div>

          <div className={styles.previewColumn}>
            {generationJob && <PlaylistGenerationProgress job={generationJob} requestedTracks={Number(limit) || 50} onCancel={() => { const id = generationJob.id || generationJob.jobId; if (id) void cancelPlaylistGeneration(id); }} />}
            <div className={styles.panel}>
              <div className={styles.previewHeader}>
                <div>
                  <h3>Playlist Preview</h3>
                  <p>Review the exact playlist order before Mixarr writes to Plex.</p>
                </div>
                <button type="button" onClick={createPlaylist} disabled={creating || !canCreate} className={styles.primaryButton}>
                  {creating ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                  Create Playlist
                </button>
              </div>

              {!playlistNameReady && <p className={styles.helperText}>Enter a playlist name before creating the playlist.</p>}
              {playlistPreview && !isPreviewCurrent && (
                <div className={styles.warningNotice}>
                  <AlertTriangle size={16} />
                  Settings changed after this preview. Preview again before creating the playlist.
                </div>
              )}
              {notice && (
                <div className={styles.successNotice}>
                  <CheckCircle2 size={16} />
                  {notice}
                </div>
              )}

              {playlistPreview && (
                <>
                  <div className={styles.statsGrid}>
                    {(playlistPreview.summary.smartPresetName || selectedPreset?.name) && (
                      <div><span>Smart preset</span><strong>{playlistPreview.summary.smartPresetName || selectedPreset?.name}</strong></div>
                    )}
                    {(playlistPreview.summary.moodPresetName || moodPresetMetadata.moodPresetName) && (
                      <div><span>Mood preset</span><strong>{moodPresetLabel(playlistPreview.summary.moodPresetName || moodPresetMetadata.moodPresetName, playlistPreview.summary.moodPresetModified ?? moodPresetMetadata.moodPresetModified)}</strong></div>
                    )}
                    {(playlistPreview.summary.bpmPresetName || bpmPresetMetadata.bpmPresetName) && (
                      <div><span>BPM preset</span><strong>{playlistPreview.summary.bpmPresetName === bpmPresetMetadata.bpmPresetName ? displayedBpmPreset : (playlistPreview.summary.bpmPresetName ? bpmPresetLabel(playlistPreview.summary.bpmPresetName, playlistPreview.summary.bpmPresetModified) : displayedBpmPreset)}</strong></div>
                    )}
                    <div><span>Target</span><strong>{playlistPreview.summary.targetTrackCount}</strong></div>
                    <div><span>Engine</span><strong>{playlistPreview.summary.engineLabel?.replace("Smart Mix Engine: ", "") || "v2 Foundation"}</strong></div>
                    <div><span>Matched</span><strong>{playlistPreview.summary.matchingTrackCount}</strong></div>
                    <div><span>Preview</span><strong>{playlistPreview.summary.finalTrackCount}</strong></div>
                    <div><span>Duration</span><strong>{formatEstimatedDuration(playlistPreview.summary.estimatedDurationMinutes)}</strong></div>
                    <div><span>Manual exclusions</span><strong>{playlistPreview.summary.manualExclusionsRemoved || 0}</strong></div>
                  </div>
                  {playlistPreview.summary.safetyRuleSummary && <p className={styles.helperText}>{playlistPreview.summary.safetyRuleSummary}</p>}
                  <SmartMixGenerationInsights insights={playlistPreview.generationInsights} generationId={playlistPreview.previewId} rejectedCandidates={playlistPreview.rejectedCandidates} />
                  {playlistPreview.summary.moodBlendMode && playlistPreview.summary.moodBlendMode !== "off" && (
                    <div className={styles.moodCurvePanel}>
                      <div className={styles.moodCurveHeader}>
                        <strong>Mood Curve</strong>
                        <span>{playlistPreview.summary.moodBlendLabel || moodBlendLabel(playlistPreview.summary.moodBlendMode)}</span>
                      </div>
                      {moodCurveLines(playlistPreview.summary.moodCurve).map((line) => <p key={line}>{line}</p>)}
                      {moodCoverageLines(playlistPreview.summary.moodCoverage).map((line) => <p key={line}>{line}</p>)}
                      <div className={styles.moodCurveStats}>
                        <span>Fallbacks {playlistPreview.summary.moodFallbackCount || 0}</span>
                        <span>Conflicts {playlistPreview.summary.moodConflictCount || 0}</span>
                        <span>Missing tags {playlistPreview.summary.missingMoodCount || 0}</span>
                      </div>
                    </div>
                  )}
                  {playlistPreview.warnings.length > 0 && (
                    <div className={styles.warningPanel}>
                      <div><AlertTriangle size={16} /> Warnings</div>
                      {playlistPreview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                    </div>
                  )}
                </>
              )}

              <section className={styles.trackSection} aria-labelledby="smart-previewed-tracks">
                <div className={styles.trackHeader}>
                  <h4 id="smart-previewed-tracks">Previewed Tracks</h4>
                  {playlistPreview && tracks.length > 0 && <span>Create Playlist will use these {tracks.length} previewed tracks in this order.</span>}
                </div>
                {removedTrack && <div className={styles.warningNotice} role="status"><div><strong>Removed {removedTrack.track.title}.</strong> Why? <button type="button" onClick={() => void giveRemovalReason("WRONG_MOOD")}>Wrong mood</button> <button type="button" onClick={() => void giveRemovalReason("TOO_REPETITIVE")}>Too repetitive</button> <button type="button" onClick={() => void giveRemovalReason("BAD_BPM_TRANSITION")}>Bad BPM transition</button> <button type="button" onClick={() => void giveRemovalReason("ARTIST_OVERREPRESENTED")}>Artist too often</button> <button type="button" onClick={() => void giveRemovalReason("DISLIKED_TRACK")}>I dislike it</button> <button type="button" onClick={() => void giveRemovalReason("POOR_PLAYLIST_FIT")}>Poor fit</button> <button type="button" onClick={() => setRemovedTrack(null)}>Skip</button></div><button type="button" onClick={() => void undoRemoval()}><Undo2 size={14} /> Undo</button></div>}
                {loading ? (
                  <div className={styles.emptyPreview}>Generating playlist preview...</div>
                ) : previewError ? (
                  <div className={styles.errorPreview}>{previewError}</div>
                ) : tracks.length === 0 ? (
                  <div className={styles.emptyPreview}>Choose presets or filters, then preview before creating anything in Plex.</div>
                ) : (
                  <div className={styles.trackList}>
                    {tracks.map((track, index) => (
                      <article key={track.id} className={styles.trackCard}>
                        <span className={styles.trackIndex}>{index + 1}</span>
                        <div>
                          <h5>{track.title || "-"}</h5>
                          <p>{track.artist?.title || "-"} · {track.album?.title || "-"}</p>
                          <div className={styles.trackMeta}>
                            <span>{formatDuration(track.duration)}</span>
                            <span>BPM {(track.effectiveBpm ?? track.bpm ?? track.audioFeature?.tempo)?.toFixed(0) || "-"}{track.bpmSource ? ` | ${track.bpmSource}` : ""}{track.bpmConfidence === "Low" ? " | Low confidence" : ""}</span>
                            <span>Energy {(track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy)?.toFixed(2) || "-"}{track.audioFeature?.energySource ? ` | ${track.audioFeature.energySource}` : ""}{track.audioFeature?.energyConfidence ? ` | ${track.audioFeature.energyConfidence}` : ""}</span>
                            <span>Mood {(track.audioFeature?.effectiveMood ?? track.audioFeature?.valence)?.toFixed(2) || "-"}{track.audioFeature?.moodSource ? ` | ${track.audioFeature.moodSource}` : ""}{track.audioFeature?.moodConfidence ? ` | ${track.audioFeature.moodConfidence}` : ""}</span>
                            <span>Popularity {track.popularity?.score?.toFixed(0) || "-"}</span>
                          </div>
                          <AdaptiveScoreBreakdown score={track.adaptiveScore} playback={track.playbackScore} coordination={track.coordinationScore} />
                        </div>
                        <div className={styles.trackActions}>
                          <TrackPreviewButton trackId={track.id} />
                          <SmartMixExplanation compact trackId={track.id} generationId={playlistPreview?.previewId} initialExplanation={track.decisionExplanation} />
                          <TrackFeedbackMenu
                            trackId={track.id} artistId={track.artistId || track.artist?.id} trackTitle={track.title}
                            generationId={playlistPreview?.previewId} sourceSurface="PLAYLIST_PREVIEW"
                            initialTrackState={track.personalizationScore?.components?.trackFeedbackAdjustment > 0 ? "LIKED" : track.personalizationScore?.components?.trackFeedbackAdjustment < 0 ? "DISLIKED" : null}
                            initialArtistState={track.personalizationScore?.components?.artistFeedbackAdjustment > 0 ? "PREFER" : track.personalizationScore?.components?.artistFeedbackAdjustment < 0 ? "RECOMMEND_LESS" : null}
                            initialFitState={track.personalizationScore?.components?.playlistFitAdjustment > 0 ? "GOOD_FIT" : track.personalizationScore?.components?.playlistFitAdjustment < 0 ? "POOR_FIT" : null}
                            previousTrack={index > 0 ? { id: tracks[index - 1].id, title: tracks[index - 1].title, bpm: tracks[index - 1].bpm, effectiveBpm: tracks[index - 1].effectiveBpm, mood: tracks[index - 1].audioFeature?.effectiveMood ?? tracks[index - 1].audioFeature?.valence, energy: tracks[index - 1].audioFeature?.effectiveEnergy ?? tracks[index - 1].audioFeature?.energy } : null}
                            currentTrack={{ bpm: track.bpm, effectiveBpm: track.effectiveBpm, mood: track.audioFeature?.effectiveMood ?? track.audioFeature?.valence, energy: track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy }}
                          />
                          <button type="button" onClick={() => removePreviewTrack(track, index)} aria-label={`Remove ${track.title} from preview`}><Trash2 size={15} /></button>
                          <span title="Manual exclusions still apply in Smart Builder"><Ban size={14} /></span>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {playlistPreview && (
                <details className={styles.detailsPanel}>
                  <summary><ListChecks size={15} /> Filters used</summary>
                  <dl>
                    {playlistPreview.filterSummary.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}

              <div className={styles.footerActions}>
                <Link href="/recipes" className={styles.secondaryButton}>
                  <BookMarked size={16} />
                  View Recipes
                </Link>
              </div>
            </div>
          </div>
        </section>
    </main>
  );
}
