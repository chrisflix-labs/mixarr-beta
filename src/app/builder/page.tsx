"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Plus, Trash2, Play, Upload, Star, Music, Shuffle, Activity, Save, RefreshCw, Pin, X, GripVertical, AlertTriangle, Clock, ListChecks, Ban, ShieldCheck, Sparkles, Info, SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import TrackPreviewButton from "@/components/TrackPreviewButton";
import MoodBlendingBetaPanel, {
  DEFAULT_MOOD_BLEND_BETA_SETTINGS,
  type MoodBlendBetaSettings,
} from "@/components/MoodBlendingBetaPanel";
import { isMoodPresetRuleField, moodPresetLabel } from "@/lib/moodPresets";
import {
  builtInSmartMixTuningPresets,
  DEFAULT_SMART_MIX_TUNING,
  normalizeSmartMixTuningConfig,
  type SmartMixTuningConfig,
  type SmartMixTuningPreset,
} from "@/lib/smartMixEngine/v2/tuning";
import styles from "./builder.module.css";

type Rule = {
  field: string;
  operator: string;
  value: string;
};

type RuleGroup = {
  id: string;
  combinator: "AND" | "OR";
  rules: Rule[];
};

type NegativeFilters = {
  excludeHoliday: boolean;
  excludeLive: boolean;
  excludeRemasters: boolean;
  excludeExplicit: boolean;
  excludeIntroOutro: boolean;
  minRating: string;
  excludePlayedWithinDays: string;
  minDurationMinutes: string;
  maxDurationMinutes: string;
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

type SmartPresetMetadata = {
  smartPresetId?: string;
  smartPresetName?: string;
  smartPresetVersion?: string;
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

type EngineVersion = "v1" | "v2";
type MoodBlendMode = MoodBlendBetaSettings["moodBlendMode"];
type TuningSliderKey = Exclude<keyof SmartMixTuningConfig, "avoidRecentlyUsedTracks" | "presetName" | "tuningVersion">;

type SavedRule = {
  id: string;
  name: string;
  rules: Rule[];
  ruleTree?: any;
  options?: any;
  limit: number;
  autoRefresh: boolean;
  serverId?: string | null;
  libraryId?: string | null;
  plexPlaylistId?: string | null;
  lastRefreshedAt?: string | null;
  lastRefreshStatus?: string | null;
  lastRefreshError?: string | null;
};

type PlaylistPreviewSummary = {
  targetTrackCount: number;
  matchingTrackCount: number;
  finalTrackCount: number;
  displayedTrackCount: number;
  estimatedDurationMs: number;
  estimatedDurationMinutes: number;
  bpmRange: string;
  energyRange: string;
  moodRange: string;
  popularityRange: string;
  smartPresetName?: string | null;
  moodPresetName?: string | null;
  moodPresetModified?: boolean;
  bpmPresetName?: string | null;
  bpmPresetModified?: boolean;
  manualExclusionsRemoved?: number;
  safetyRulesApplied?: boolean;
  removedBySafetyRules?: number;
  safetyRearrangedTrackCount?: number;
  safetyRuleSummary?: string;
  engineVersion?: EngineVersion;
  engineLabel?: string;
  tuningPresetName?: string | null;
  tuningConfig?: SmartMixTuningConfig;
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
  artistLimitApplied?: boolean;
  albumLimitApplied?: boolean;
  artistSpacingApplied?: boolean;
  genreFilters: string;
  sortMode: string;
  duplicateStrategy: string;
  diversity: {
    artistCount: number;
    albumCount: number;
    repeatedArtistTracks: number;
  };
  missing: {
    bpm: number;
    audioFeatures: number;
    popularity: number;
  };
};

type PlaylistPreviewState = {
  previewId: string;
  trackIds: string[];
  totalPreviewTrackCount: number;
  summary: PlaylistPreviewSummary;
  filterSummary: Array<{ label: string; value: string }>;
  warnings: string[];
  messages: Array<{ severity: "info" | "warning" | "error"; message: string }>;
  signature: string;
};

type PlaylistRecipe = {
  id: string;
  name: string;
  description?: string | null;
  filters: any;
  filterSummary: string;
};

function formatDuration(ms?: number | null) {
  if (!ms) return "—";
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

function tuningPresetSelectValue(preset: SmartMixTuningPreset) {
  return `${preset.builtIn ? "builtin" : "custom"}:${preset.id}`;
}

function presetValueForConfig(config: SmartMixTuningConfig, customPresets: SmartMixTuningPreset[]) {
  const preset = [...builtInSmartMixTuningPresets, ...customPresets].find((item) => item.name === config.presetName);
  return preset ? tuningPresetSelectValue(preset) : "custom";
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

export default function BuilderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rules, setRules] = useState<Rule[]>([{ field: "popularity", operator: "gt", value: "50" }]);
  const [rootCombinator, setRootCombinator] = useState<"AND" | "OR">("AND");
  const [ruleGroups, setRuleGroups] = useState<RuleGroup[]>([]);
  const [limit, setLimit] = useState(50);
  const [playlistName, setPlaylistName] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [serverId, setServerId] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [duplicateStrategy, setDuplicateStrategy] = useState<"allow" | "song_artist">("song_artist");
  const [preferNonLive, setPreferNonLive] = useState(true);
  const [excludeRemasters, setExcludeRemasters] = useState(false);
  const [negativeFilters, setNegativeFilters] = useState<NegativeFilters>({
    excludeHoliday: false,
    excludeLive: false,
    excludeRemasters: false,
    excludeExplicit: false,
    excludeIntroOutro: false,
    minRating: "",
    excludePlayedWithinDays: "",
    minDurationMinutes: "",
    maxDurationMinutes: "",
  });
  const [safetyRules, setSafetyRules] = useState<SafetyRules>({
    avoidSameArtistBackToBack: true,
    limitTracksPerArtist: false,
    maxTracksPerArtist: "3",
    limitTracksPerAlbum: false,
    maxTracksPerAlbum: "2",
    warnIfFewerThan: true,
    minimumTrackCount: "10",
  });
  const [smartPresetMetadata, setSmartPresetMetadata] = useState<SmartPresetMetadata>({});
  const [moodPresetMetadata, setMoodPresetMetadata] = useState<MoodPresetMetadata>({});
  const [bpmPresetMetadata, setBpmPresetMetadata] = useState<BpmPresetMetadata>({});
  const [engineVersion, setEngineVersion] = useState<EngineVersion>("v1");
  const [tuningConfig, setTuningConfig] = useState<SmartMixTuningConfig>(() => normalizeSmartMixTuningConfig(DEFAULT_SMART_MIX_TUNING));
  const [moodBlendSettings, setMoodBlendSettings] = useState<MoodBlendBetaSettings>(DEFAULT_MOOD_BLEND_BETA_SETTINGS);
  const [customTuningPresets, setCustomTuningPresets] = useState<SmartMixTuningPreset[]>([]);
  const [selectedTuningPreset, setSelectedTuningPreset] = useState(tuningPresetSelectValue(builtInSmartMixTuningPresets[0]));
  const [customTuningPresetName, setCustomTuningPresetName] = useState("");
  const [savingTuningPreset, setSavingTuningPreset] = useState(false);
  const [pinnedTrackIds, setPinnedTrackIds] = useState<string[]>([]);
  const [excludedTrackIds, setExcludedTrackIds] = useState<string[]>([]);
  const [draggedTrackId, setDraggedTrackId] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [savedRules, setSavedRules] = useState<SavedRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [activeRecipe, setActiveRecipe] = useState<PlaylistRecipe | null>(null);
  const [isEditingRecipe, setIsEditingRecipe] = useState(false);
  const [recipeBaselineSignature, setRecipeBaselineSignature] = useState("");
  const [recipeNotice, setRecipeNotice] = useState("");
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [recipeDescription, setRecipeDescription] = useState("");
  const [tracks, setTracks] = useState<any[]>([]);
  const [playlistPreview, setPlaylistPreview] = useState<PlaylistPreviewState | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [exclusionNotice, setExclusionNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [updatingRecipe, setUpdatingRecipe] = useState(false);

  useEffect(() => {
    fetchSavedRules();
    fetchDefaults();
    fetchHistory();
    fetchTuningPresets();
  }, []);

  useEffect(() => {
    setSelectedTuningPreset(presetValueForConfig(tuningConfig, customTuningPresets));
  }, [customTuningPresets, tuningConfig]);

  useEffect(() => {
    const sourceParams = new URLSearchParams(window.location.search);
    const source = sourceParams.get("from");
    if (!source) return;

    const genre = sourceParams.get("genre") || "";
    const q = sourceParams.get("q") || "";
    const minPopularity = sourceParams.get("minPopularity") || "";
    const trait = sourceParams.get("trait") || "";
    const importedRules: Rule[] = [];
    const importedGroups: RuleGroup[] = [];

    if (genre) importedRules.push({ field: "genre", operator: "contains", value: genre });
    if (minPopularity) importedRules.push({ field: "popularity", operator: "gte", value: minPopularity });
    if (trait === "unplayed") importedRules.push({ field: "playCount", operator: "eq", value: "0" });
    if (trait === "played") importedRules.push({ field: "playCount", operator: "gt", value: "0" });
    if (trait === "rated") importedRules.push({ field: "rating", operator: "gt", value: "0" });
    if (trait === "live") importedRules.push({ field: "isLive", operator: "eq", value: "true" });
    if (trait === "remaster") importedRules.push({ field: "isRemaster", operator: "eq", value: "true" });
    if (trait === "explicit") importedRules.push({ field: "isExplicit", operator: "eq", value: "true" });
    if (trait === "missingPopularity") importedRules.push({ field: "hasPopularity", operator: "eq", value: "false" });

    if (q) {
      importedGroups.push({
        id: "imported-search",
        combinator: "OR",
        rules: [
          { field: "title", operator: "contains", value: q },
          { field: "artist", operator: "contains", value: q },
          { field: "album", operator: "contains", value: q },
        ],
      });
    }

    if (importedRules.length === 0 && importedGroups.length === 0) return;

    setRootCombinator("AND");
    setRules(importedRules);
    setRuleGroups(importedGroups);
    setPlaylistName(genre ? `${genre} Mix` : q ? `${q} Mix` : "Filtered Library Mix");
    setSelectedRuleId("");
    setPinnedTrackIds([]);
    setExcludedTrackIds([]);
    setTracks([]);
    setPlaylistPreview(null);
  }, []);

  const fetchSavedRules = async () => {
    try {
      const res = await axios.get("/api/playlists/rules");
      setSavedRules(res.data.rules || []);
    } catch (e) {
      console.error("Failed to load saved playlists", e);
    }
  };

  const fetchDefaults = async () => {
    try {
      const res = await axios.get("/api/settings/library-selection");
      setServerId(res.data.defaultServerId || "");
      setLibraryId(res.data.defaultLibraryId || "");
    } catch (e) {
      console.error("Failed to load default library", e);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await axios.get("/api/playlists/history");
      setHistory(res.data.history || []);
    } catch (e) {
      console.error("Failed to load playlist history", e);
    }
  };

  const fetchTuningPresets = async () => {
    try {
      const res = await axios.get("/api/smart-mix-tuning-presets");
      setCustomTuningPresets(res.data.customPresets || []);
    } catch (e) {
      console.error("Failed to load Smart Mix tuning presets", e);
    }
  };

  const buildRuleTree = () => {
    const children: any[] = [];
    if (rules.length > 0) {
      children.push({ type: "group", combinator: "AND", children: rules.map(rule => ({ type: "rule", ...rule })) });
    }
    for (const group of ruleGroups) {
      children.push({ type: "group", combinator: group.combinator, children: group.rules.map(rule => ({ type: "rule", ...rule })) });
    }
    if (children.length === 0) return undefined;
    if (children.length === 1 && rootCombinator === "AND") return children[0];
    return { type: "group", combinator: rootCombinator, children };
  };

  const restoreSafetyRules = (incoming: any = {}) => {
    setSafetyRules({
      avoidSameArtistBackToBack: incoming.avoidSameArtistBackToBack ?? true,
      limitTracksPerArtist: incoming.limitTracksPerArtist || false,
      maxTracksPerArtist: incoming.maxTracksPerArtist?.toString() || "3",
      limitTracksPerAlbum: incoming.limitTracksPerAlbum || false,
      maxTracksPerAlbum: incoming.maxTracksPerAlbum?.toString() || "2",
      warnIfFewerThan: incoming.warnIfFewerThan ?? true,
      minimumTrackCount: incoming.minimumTrackCount?.toString() || "10",
    });
  };

  const updateSafetyRules = (patch: Partial<SafetyRules>) => {
    setSafetyRules((current) => ({ ...current, ...patch }));
    clearPreview();
  };

  const restoreRuleTree = (tree: any, fallbackRules: Rule[]) => {
    if (!tree) {
      setRootCombinator("AND");
      setRules(fallbackRules?.length ? fallbackRules : [{ field: "popularity", operator: "gt", value: "50" }]);
      setRuleGroups([]);
      return;
    }

    if (tree.type !== "group") {
      setRootCombinator("AND");
      setRules([{ field: tree.field, operator: tree.operator, value: tree.value }]);
      setRuleGroups([]);
      return;
    }

    setRootCombinator(tree.combinator || "AND");
    const childGroups = tree.children || [];
    const mainGroup = childGroups.find((child: any) => child.type === "group" && child.combinator === "AND") || childGroups[0];
    setRules((mainGroup?.children || []).filter((child: any) => child.type !== "group").map((child: any) => ({ field: child.field, operator: child.operator, value: child.value })));
    setRuleGroups(childGroups.filter((child: any) => child !== mainGroup && child.type === "group").map((child: any) => ({
      id: `${Date.now()}-${Math.random()}`,
      combinator: child.combinator || "OR",
      rules: (child.children || []).filter((grandchild: any) => grandchild.type !== "group").map((grandchild: any) => ({ field: grandchild.field, operator: grandchild.operator, value: grandchild.value })),
    })));
  };

  const displayedMoodPreset = moodPresetLabel(moodPresetMetadata.moodPresetName, moodPresetMetadata.moodPresetModified);

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

  const clearBpmPresetMetadata = () => {
    setBpmPresetMetadata({});
  };

  const restoreTuningConfig = (incoming: unknown) => {
    const normalized = normalizeSmartMixTuningConfig(incoming ?? DEFAULT_SMART_MIX_TUNING);
    setTuningConfig(normalized);
    setSelectedTuningPreset(presetValueForConfig(normalized, customTuningPresets));
    setCustomTuningPresetName(normalized.presetName && normalized.presetName !== "Balanced" ? normalized.presetName : "");
  };

  const restoreMoodBlend = (incoming: any = {}) => {
    const mode = incoming.moodBlendMode === "smooth_transition" || incoming.moodBlendMode === "strict_matching" || incoming.moodBlendMode === "mixed_mood"
      ? incoming.moodBlendMode as MoodBlendMode
      : "off";
    setMoodBlendSettings({
      ...DEFAULT_MOOD_BLEND_BETA_SETTINGS,
      moodBlendMode: mode,
      selectedMoodPath: Array.isArray(incoming.selectedMoodPath) ? incoming.selectedMoodPath : [],
      allowedMoods: Array.isArray(incoming.allowedMoods) ? incoming.allowedMoods : [],
      moodStrength: Number.isFinite(Number(incoming.moodStrength)) ? Number(incoming.moodStrength) : DEFAULT_MOOD_BLEND_BETA_SETTINGS.moodStrength,
      transitionSmoothness: Number.isFinite(Number(incoming.transitionSmoothness)) ? Number(incoming.transitionSmoothness) : DEFAULT_MOOD_BLEND_BETA_SETTINGS.transitionSmoothness,
      moodStrictness: Number.isFinite(Number(incoming.moodStrictness)) ? Number(incoming.moodStrictness) : mode === "strict_matching" ? 85 : mode === "mixed_mood" ? 50 : DEFAULT_MOOD_BLEND_BETA_SETTINGS.moodStrictness,
      fallbackTolerance: Number.isFinite(Number(incoming.fallbackTolerance)) ? Number(incoming.fallbackTolerance) : DEFAULT_MOOD_BLEND_BETA_SETTINGS.fallbackTolerance,
      bridgeTrackPreference: Number.isFinite(Number(incoming.bridgeTrackPreference)) ? Number(incoming.bridgeTrackPreference) : DEFAULT_MOOD_BLEND_BETA_SETTINGS.bridgeTrackPreference,
      moodVariety: Number.isFinite(Number(incoming.moodVariety)) ? Number(incoming.moodVariety) : DEFAULT_MOOD_BLEND_BETA_SETTINGS.moodVariety,
      conflictSensitivity: Number.isFinite(Number(incoming.conflictSensitivity)) ? Number(incoming.conflictSensitivity) : DEFAULT_MOOD_BLEND_BETA_SETTINGS.conflictSensitivity,
      selectedMoodPreset: typeof incoming.selectedMoodPreset === "string" ? incoming.selectedMoodPreset : DEFAULT_MOOD_BLEND_BETA_SETTINGS.selectedMoodPreset,
    });
  };

  const updateMoodBlendSettings = (patch: Partial<MoodBlendBetaSettings>) => {
    setMoodBlendSettings((current) => {
      const next = { ...current, ...patch };
      if (current.moodBlendMode !== "off" || next.moodBlendMode !== "off") {
        setEngineVersion("v2");
      }
      return next;
    });
    clearPreview();
  };

  const updateTuningConfig = (patch: Partial<SmartMixTuningConfig>) => {
    setEngineVersion("v2");
    setTuningConfig((current) => normalizeSmartMixTuningConfig({
      ...current,
      ...patch,
      presetName: patch.presetName ?? "Custom",
    }));
    setSelectedTuningPreset("custom");
    clearPreview();
  };

  const selectTuningPreset = (value: string) => {
    setSelectedTuningPreset(value);
    if (value === "custom") {
      setEngineVersion("v2");
      setTuningConfig((current) => normalizeSmartMixTuningConfig({ ...current, presetName: "Custom" }));
      clearPreview();
      return;
    }

    const preset = [...builtInSmartMixTuningPresets, ...customTuningPresets].find((item) => tuningPresetSelectValue(item) === value);
    if (!preset) return;

    setEngineVersion("v2");
    setTuningConfig(normalizeSmartMixTuningConfig(preset.config));
    setCustomTuningPresetName(preset.builtIn ? "" : preset.name);
    clearPreview();
  };

  const saveTuningPreset = async () => {
    const name = customTuningPresetName.trim();
    if (!name) {
      alert("Enter a tuning preset name.");
      return;
    }

    setSavingTuningPreset(true);
    try {
      const res = await axios.post("/api/smart-mix-tuning-presets", {
        name,
        tuningConfig: { ...tuningConfig, presetName: name },
      });
      const preset = res.data.preset as SmartMixTuningPreset;
      setCustomTuningPresets((current) => [preset, ...current.filter((item) => item.id !== preset.id && item.name !== preset.name)]);
      setTuningConfig(normalizeSmartMixTuningConfig(preset.config));
      setSelectedTuningPreset(tuningPresetSelectValue(preset));
      setEngineVersion("v2");
      clearPreview();
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.error || "Failed to save tuning preset");
    } finally {
      setSavingTuningPreset(false);
    }
  };

  const deleteSelectedTuningPreset = async () => {
    const preset = customTuningPresets.find((item) => tuningPresetSelectValue(item) === selectedTuningPreset);
    if (!preset) return;
    if (!window.confirm(`Delete tuning preset "${preset.name}"?`)) return;

    try {
      await axios.delete(`/api/smart-mix-tuning-presets/${preset.id}`);
      setCustomTuningPresets((current) => current.filter((item) => item.id !== preset.id));
      selectTuningPreset(tuningPresetSelectValue(builtInSmartMixTuningPresets[0]));
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.error || "Failed to delete tuning preset");
    }
  };

  const playlistPayload = (extra: Record<string, any> = {}) => ({
    rules,
    ruleTree: buildRuleTree(),
    limit,
    serverId: serverId || undefined,
    libraryId: libraryId || undefined,
    duplicateStrategy,
    preferNonLive,
    excludeRemasters,
    negativeFilters: {
      ...negativeFilters,
      minRating: negativeFilters.minRating || undefined,
      excludePlayedWithinDays: negativeFilters.excludePlayedWithinDays || undefined,
      minDurationMinutes: negativeFilters.minDurationMinutes || undefined,
      maxDurationMinutes: negativeFilters.maxDurationMinutes || undefined,
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
    engineVersion,
    tuningConfig: normalizeSmartMixTuningConfig(tuningConfig),
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
    ...smartPresetMetadata,
    ...moodPresetMetadata,
    ...bpmPresetMetadata,
    ...extra,
  });

  const playlistPayloadFromRecipeFilters = (filters: any) => ({
    rules: filters.rules || [],
    ruleTree: filters.ruleTree,
    limit: filters.limit || 50,
    serverId: filters.serverId || undefined,
    libraryId: filters.libraryId || undefined,
    duplicateStrategy: filters.duplicateStrategy || "song_artist",
    preferNonLive: filters.preferNonLive ?? true,
    excludeRemasters: filters.excludeRemasters || false,
    negativeFilters: {
      excludeHoliday: filters.negativeFilters?.excludeHoliday || false,
      excludeLive: filters.negativeFilters?.excludeLive || false,
      excludeRemasters: filters.negativeFilters?.excludeRemasters || false,
      excludeExplicit: filters.negativeFilters?.excludeExplicit || false,
      excludeIntroOutro: filters.negativeFilters?.excludeIntroOutro || false,
      minRating: filters.negativeFilters?.minRating != null ? filters.negativeFilters.minRating.toString() : undefined,
      excludePlayedWithinDays: filters.negativeFilters?.excludePlayedWithinDays != null ? filters.negativeFilters.excludePlayedWithinDays.toString() : undefined,
      minDurationMinutes: filters.negativeFilters?.minDurationMinutes != null ? filters.negativeFilters.minDurationMinutes.toString() : undefined,
      maxDurationMinutes: filters.negativeFilters?.maxDurationMinutes != null ? filters.negativeFilters.maxDurationMinutes.toString() : undefined,
    },
    safetyRules: {
      avoidSameArtistBackToBack: filters.safetyRules?.avoidSameArtistBackToBack ?? true,
      limitTracksPerArtist: filters.safetyRules?.limitTracksPerArtist || false,
      maxTracksPerArtist: filters.safetyRules?.maxTracksPerArtist != null ? filters.safetyRules.maxTracksPerArtist.toString() : "3",
      limitTracksPerAlbum: filters.safetyRules?.limitTracksPerAlbum || false,
      maxTracksPerAlbum: filters.safetyRules?.maxTracksPerAlbum != null ? filters.safetyRules.maxTracksPerAlbum.toString() : "2",
      warnIfFewerThan: filters.safetyRules?.warnIfFewerThan ?? true,
      minimumTrackCount: filters.safetyRules?.minimumTrackCount != null ? filters.safetyRules.minimumTrackCount.toString() : "10",
    },
    smartPresetId: filters.smartPresetId,
    smartPresetName: filters.smartPresetName,
    smartPresetVersion: filters.smartPresetVersion,
    moodPresetId: filters.moodPresetId,
    moodPresetName: filters.moodPresetName,
    moodPresetVersion: filters.moodPresetVersion,
    moodPresetModified: filters.moodPresetModified || false,
    bpmPresetId: filters.bpmPresetId,
    bpmPresetName: filters.bpmPresetName,
    bpmPresetVersion: filters.bpmPresetVersion,
    bpmPresetModified: filters.bpmPresetModified || false,
    tuningConfig: normalizeSmartMixTuningConfig(filters.tuningConfig),
    moodBlendMode: filters.moodBlendMode || "off",
    selectedMoodPath: filters.selectedMoodPath || [],
    allowedMoods: filters.allowedMoods || [],
    moodStrength: filters.moodStrength ?? DEFAULT_MOOD_BLEND_BETA_SETTINGS.moodStrength,
    transitionSmoothness: filters.transitionSmoothness ?? DEFAULT_MOOD_BLEND_BETA_SETTINGS.transitionSmoothness,
    moodStrictness: filters.moodStrictness ?? DEFAULT_MOOD_BLEND_BETA_SETTINGS.moodStrictness,
    fallbackTolerance: filters.fallbackTolerance ?? DEFAULT_MOOD_BLEND_BETA_SETTINGS.fallbackTolerance,
    bridgeTrackPreference: filters.bridgeTrackPreference ?? DEFAULT_MOOD_BLEND_BETA_SETTINGS.bridgeTrackPreference,
    moodVariety: filters.moodVariety ?? DEFAULT_MOOD_BLEND_BETA_SETTINGS.moodVariety,
    conflictSensitivity: filters.conflictSensitivity ?? DEFAULT_MOOD_BLEND_BETA_SETTINGS.conflictSensitivity,
    selectedMoodPreset: filters.selectedMoodPreset || DEFAULT_MOOD_BLEND_BETA_SETTINGS.selectedMoodPreset,
    engineVersion: (filters.engineVersion === "v2" ? "v2" : "v1") as EngineVersion,
    pinnedTrackIds: filters.pinnedTrackIds || [],
    excludedTrackIds: filters.excludedTrackIds || [],
  });

  const recipeEditSignature = (name: string, description: string, filters: any) => JSON.stringify({
    name: name.trim(),
    description: description.trim(),
    filters,
  });

  const previewConfigSignature = () => JSON.stringify(playlistPayload({ pinnedTrackIds: [], excludedTrackIds: [] }));
  const isPreviewCurrent = playlistPreview?.signature === previewConfigSignature();
  const createTrackIds = tracks.map((track) => track.id);
  const playlistNameReady = playlistName.trim().length > 0;
  const canCreateFromPreview = Boolean(playlistNameReady && playlistPreview && isPreviewCurrent && createTrackIds.length > 0);
  const isRecipeDirty = Boolean(
    activeRecipe
    && isEditingRecipe
    && recipeBaselineSignature
    && recipeBaselineSignature !== recipeEditSignature(recipeName, recipeDescription, playlistPayload()),
  );

  useEffect(() => {
    if (!isRecipeDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "You have unsaved recipe changes. Leave without saving?";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isRecipeDirty]);

  const clearPreview = () => {
    setTracks([]);
    setPlaylistPreview(null);
    setPreviewError("");
    setExclusionNotice("");
    setPinnedTrackIds([]);
    setExcludedTrackIds([]);
  };

  const addRule = () => {
    setRules([...rules, { field: "genre", operator: "contains", value: "" }]);
    clearPreview();
  };

  const removeRule = (index: number) => {
    if (isMoodPresetRuleField(rules[index]?.field)) markMoodPresetModified();
    if (rules[index]?.field === "tempo") clearBpmPresetMetadata();
    setRules(rules.filter((_, i) => i !== index));
    clearPreview();
  };

  const updateRule = (index: number, key: keyof Rule, val: string) => {
    const newRules = [...rules];
    const existingField = newRules[index]?.field;
    if (isMoodPresetRuleField(existingField) || (key === "field" && isMoodPresetRuleField(val))) markMoodPresetModified();
    if (existingField === "tempo" || (key === "field" && val === "tempo")) clearBpmPresetMetadata();
    newRules[index][key] = val;
    setRules(newRules);
    clearPreview();
  };

  const addGroup = () => {
    setRuleGroups([...ruleGroups, { id: `${Date.now()}-${Math.random()}`, combinator: "OR", rules: [{ field: "genre", operator: "contains", value: "" }] }]);
    clearPreview();
  };

  const updateGroup = (groupId: string, patch: Partial<RuleGroup>) => {
    setRuleGroups(ruleGroups.map(group => group.id === groupId ? { ...group, ...patch } : group));
    clearPreview();
  };

  const updateGroupRule = (groupId: string, index: number, key: keyof Rule, val: string) => {
    setRuleGroups(ruleGroups.map(group => {
      if (group.id !== groupId) return group;
      const nextRules = [...group.rules];
      const existingField = nextRules[index]?.field;
      if (isMoodPresetRuleField(existingField) || (key === "field" && isMoodPresetRuleField(val))) markMoodPresetModified();
      if (existingField === "tempo" || (key === "field" && val === "tempo")) clearBpmPresetMetadata();
      nextRules[index][key] = val;
      return { ...group, rules: nextRules };
    }));
    clearPreview();
  };

  const addGroupRule = (groupId: string) => {
    setRuleGroups(ruleGroups.map(group => group.id === groupId ? { ...group, rules: [...group.rules, { field: "genre", operator: "contains", value: "" }] } : group));
    clearPreview();
  };

  const removeGroupRule = (groupId: string, index: number) => {
    const group = ruleGroups.find((item) => item.id === groupId);
    if (isMoodPresetRuleField(group?.rules[index]?.field)) markMoodPresetModified();
    if (group?.rules[index]?.field === "tempo") clearBpmPresetMetadata();
    setRuleGroups(ruleGroups.map(group => group.id === groupId ? { ...group, rules: group.rules.filter((_, i) => i !== index) } : group));
    clearPreview();
  };

  const loadSavedRule = (id: string) => {
    setSelectedRuleId(id);
    setActiveRecipe(null);
    setIsEditingRecipe(false);
    setRecipeBaselineSignature("");
    setRecipeNotice("");
    setSmartPresetMetadata({});
    setMoodPresetMetadata({});
    setBpmPresetMetadata({});
    setEngineVersion("v1");
    restoreTuningConfig(DEFAULT_SMART_MIX_TUNING);
    restoreMoodBlend({});
    if (!id) return;

    const savedRule = savedRules.find(rule => rule.id === id);
    if (!savedRule) return;

    setPlaylistName(savedRule.name);
    restoreRuleTree(savedRule.ruleTree, savedRule.rules);
    setLimit(savedRule.limit);
    setAutoRefresh(savedRule.autoRefresh);
    setServerId(savedRule.serverId || "");
    setLibraryId(savedRule.libraryId || "");
    setDuplicateStrategy(savedRule.options?.duplicateStrategy || "song_artist");
    setPreferNonLive(savedRule.options?.preferNonLive ?? true);
    setExcludeRemasters(savedRule.options?.excludeRemasters || false);
    setNegativeFilters({
      excludeHoliday: savedRule.options?.negativeFilters?.excludeHoliday || false,
      excludeLive: savedRule.options?.negativeFilters?.excludeLive || false,
      excludeRemasters: savedRule.options?.negativeFilters?.excludeRemasters || false,
      excludeExplicit: savedRule.options?.negativeFilters?.excludeExplicit || false,
      excludeIntroOutro: savedRule.options?.negativeFilters?.excludeIntroOutro || false,
      minRating: savedRule.options?.negativeFilters?.minRating?.toString() || "",
      excludePlayedWithinDays: savedRule.options?.negativeFilters?.excludePlayedWithinDays?.toString() || "",
      minDurationMinutes: savedRule.options?.negativeFilters?.minDurationMinutes?.toString() || "",
      maxDurationMinutes: savedRule.options?.negativeFilters?.maxDurationMinutes?.toString() || "",
    });
    restoreSafetyRules(savedRule.options?.safetyRules);
    setSmartPresetMetadata({
      smartPresetId: savedRule.options?.smartPresetId,
      smartPresetName: savedRule.options?.smartPresetName,
      smartPresetVersion: savedRule.options?.smartPresetVersion,
    });
    setMoodPresetMetadata({
      moodPresetId: savedRule.options?.moodPresetId,
      moodPresetName: savedRule.options?.moodPresetName,
      moodPresetVersion: savedRule.options?.moodPresetVersion,
      moodPresetModified: savedRule.options?.moodPresetModified || false,
    });
    setBpmPresetMetadata({
      bpmPresetId: savedRule.options?.bpmPresetId,
      bpmPresetName: savedRule.options?.bpmPresetName,
      bpmPresetVersion: savedRule.options?.bpmPresetVersion,
      bpmPresetModified: savedRule.options?.bpmPresetModified || false,
    });
    restoreTuningConfig(savedRule.options?.tuningConfig);
    restoreMoodBlend(savedRule.options);
    setEngineVersion(savedRule.options?.engineVersion === "v2" ? "v2" : "v1");
    setPinnedTrackIds([]);
    setExcludedTrackIds([]);
    setTracks([]);
    setPlaylistPreview(null);
  };

  const applyRecipeFilters = async (recipe: PlaylistRecipe, shouldPreview = false, editMode = false) => {
    const filters = recipe.filters || {};
    const payload = playlistPayloadFromRecipeFilters(filters);

    setActiveRecipe(recipe);
    setIsEditingRecipe(editMode);
    setRecipeName(recipe.name);
    setRecipeDescription(recipe.description || "");
    setRecipeBaselineSignature(recipeEditSignature(recipe.name, recipe.description || "", payload));
    setRecipeNotice(`Editing recipe: ${recipe.name}`);
    setSelectedRuleId("");
    setPlaylistName(recipe.name);
    restoreRuleTree(filters.ruleTree, filters.rules || []);
    setLimit(filters.limit || 50);
    setAutoRefresh(false);
    setServerId(filters.serverId || "");
    setLibraryId(filters.libraryId || "");
    setDuplicateStrategy(filters.duplicateStrategy || "song_artist");
    setPreferNonLive(filters.preferNonLive ?? true);
    setExcludeRemasters(filters.excludeRemasters || false);
    setNegativeFilters({
      excludeHoliday: filters.negativeFilters?.excludeHoliday || false,
      excludeLive: filters.negativeFilters?.excludeLive || false,
      excludeRemasters: filters.negativeFilters?.excludeRemasters || false,
      excludeExplicit: filters.negativeFilters?.excludeExplicit || false,
      excludeIntroOutro: filters.negativeFilters?.excludeIntroOutro || false,
      minRating: filters.negativeFilters?.minRating?.toString() || "",
      excludePlayedWithinDays: filters.negativeFilters?.excludePlayedWithinDays?.toString() || "",
      minDurationMinutes: filters.negativeFilters?.minDurationMinutes?.toString() || "",
      maxDurationMinutes: filters.negativeFilters?.maxDurationMinutes?.toString() || "",
    });
    restoreSafetyRules(filters.safetyRules);
    setSmartPresetMetadata({
      smartPresetId: filters.smartPresetId,
      smartPresetName: filters.smartPresetName,
      smartPresetVersion: filters.smartPresetVersion,
    });
    setMoodPresetMetadata({
      moodPresetId: filters.moodPresetId,
      moodPresetName: filters.moodPresetName,
      moodPresetVersion: filters.moodPresetVersion,
      moodPresetModified: filters.moodPresetModified || false,
    });
    setBpmPresetMetadata({
      bpmPresetId: filters.bpmPresetId,
      bpmPresetName: filters.bpmPresetName,
      bpmPresetVersion: filters.bpmPresetVersion,
      bpmPresetModified: filters.bpmPresetModified || false,
    });
    restoreTuningConfig(filters.tuningConfig);
    restoreMoodBlend(filters);
    setEngineVersion(filters.engineVersion === "v2" ? "v2" : "v1");
    setPinnedTrackIds(filters.pinnedTrackIds || []);
    setExcludedTrackIds(filters.excludedTrackIds || []);
    setTracks([]);
    setPlaylistPreview(null);

    if (shouldPreview) {
      await runPreview(payload, JSON.stringify(payload), editMode ? null : recipe);
    }
  };

  useEffect(() => {
    const recipeId = searchParams.get("recipeId");
    if (!recipeId) return;

    let cancelled = false;
    const loadRecipe = async () => {
      try {
        const res = await axios.get(`/api/playlist-recipes/${recipeId}`);
        if (cancelled) return;
        await applyRecipeFilters(res.data.recipe, searchParams.get("preview") === "1", searchParams.get("edit") === "1");
      } catch (e) {
        console.error("Failed to load playlist recipe", e);
        if (!cancelled) setRecipeNotice("Unable to load that playlist recipe.");
      }
    };

    loadRecipe();
    return () => {
      cancelled = true;
    };
    // Load only when the URL-selected recipe changes; filter state changes should not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const saveSmartPlaylist = async (showAlert = true) => {
    if (!playlistName.trim()) {
      alert("Please enter a playlist name");
      return "";
    }

    setSaving(true);
    try {
      const payload = { name: playlistName, autoRefresh, ...playlistPayload() };
      const res = selectedRuleId
        ? await axios.put(`/api/playlists/rules/${selectedRuleId}`, payload)
        : await axios.post("/api/playlists/rules", payload);

      setSelectedRuleId(res.data.rule.id);
      await fetchSavedRules();
      if (showAlert) alert("Smart playlist saved");
      return res.data.rule.id;
    } catch (e) {
      console.error(e);
      alert("Failed to save smart playlist");
      return "";
    } finally {
      setSaving(false);
    }
  };

  const openRecipeModal = () => {
    setRecipeName((recipeName || playlistName || activeRecipe?.name || "").trim());
    setRecipeDescription(recipeDescription || activeRecipe?.description || "");
    setShowRecipeModal(true);
  };

  const savePlaylistRecipe = async () => {
    if (!recipeName.trim()) {
      alert("Recipe name is required.");
      return;
    }

    setSavingRecipe(true);
    try {
      const res = await axios.post("/api/playlist-recipes", {
        name: recipeName,
        description: recipeDescription,
        filters: playlistPayload(),
      });
      setActiveRecipe(res.data.recipe);
      setIsEditingRecipe(false);
      setRecipeName(res.data.recipe.name);
      setRecipeDescription(res.data.recipe.description || "");
      setRecipeNotice(`Saved recipe "${res.data.recipe.name}".`);
      setShowRecipeModal(false);
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.error || "Failed to save playlist recipe");
    } finally {
      setSavingRecipe(false);
    }
  };

  const updatePlaylistRecipe = async () => {
    if (!activeRecipe) return;
    if (!recipeName.trim()) {
      alert("Recipe name is required.");
      return;
    }

    setUpdatingRecipe(true);
    try {
      const res = await axios.patch(`/api/playlist-recipes/${activeRecipe.id}`, {
        name: recipeName,
        description: recipeDescription,
        filters: playlistPayload(),
      });
      setActiveRecipe(res.data.recipe);
      setIsEditingRecipe(true);
      setRecipeName(res.data.recipe.name);
      setRecipeDescription(res.data.recipe.description || "");
      setRecipeBaselineSignature(recipeEditSignature(res.data.recipe.name, res.data.recipe.description || "", res.data.recipe.filters));
      setRecipeNotice(`Updated recipe "${res.data.recipe.name}".`);
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.error || "Failed to update playlist recipe");
    } finally {
      setUpdatingRecipe(false);
    }
  };

  const refreshSelectedPlaylist = async () => {
    if (!selectedRuleId) return;

    setSaving(true);
    try {
      await axios.post(`/api/playlists/rules/${selectedRuleId}/refresh`);
      await fetchSavedRules();
      alert("Smart playlist refreshed in Plex");
    } catch (e) {
      console.error(e);
      alert("Export this saved playlist once before refreshing it");
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = (templateName: string) => {
    setActiveRecipe(null);
    setIsEditingRecipe(false);
    setRecipeBaselineSignature("");
    setRecipeNotice("");
    setSmartPresetMetadata({});
    setMoodPresetMetadata({});
    setBpmPresetMetadata({});
    setEngineVersion("v1");
    restoreTuningConfig(DEFAULT_SMART_MIX_TUNING);
    restoreMoodBlend({});
    if (templateName === "deep_cuts") {
      setRules([{ field: "popularity", operator: "lt", value: "30" }]);
      setPlaylistName("Deep Cuts Discovered");
    } else if (templateName === "90s") {
      setRules([
        { field: "year", operator: "gte", value: "1990" },
        { field: "year", operator: "lte", value: "1999" }
      ]);
      setPlaylistName("Ultimate 90s Mix");
    } else if (templateName === "christmas") {
      setRules([
        { field: "title", operator: "contains", value: "Christmas" }
      ]);
      setPlaylistName("Christmas Cheer");
    } else if (templateName === "anti_christmas") {
      setRules([
        { field: "title", operator: "not_contains", value: "Christmas" },
        { field: "title", operator: "not_contains", value: "Holiday" }
      ]);
      setNegativeFilters({ ...negativeFilters, excludeHoliday: true });
      setPlaylistName("No Holidays Allowed");
    } else if (templateName === "workout") {
      setRules([
        { field: "tempo", operator: "gte", value: "120" },
        { field: "energy", operator: "gte", value: "0.7" }
      ]);
      setPlaylistName("High BPM Workout Mix");
    }
    setSelectedRuleId("");
    setRuleGroups([]);
    setPinnedTrackIds([]);
    setExcludedTrackIds([]);
    setTracks([]);
    setPlaylistPreview(null);
  };

  const runPreview = async (config = playlistPayload(), signature = previewConfigSignature(), recipeForUsage: PlaylistRecipe | null = isEditingRecipe ? null : activeRecipe) => {
    setLoading(true);
    setPreviewError("");
    setExclusionNotice("");
    try {
      setPinnedTrackIds([]);
      setExcludedTrackIds([]);
      const res = await axios.post("/api/playlists/preview", config);
      setTracks(res.data.tracks || []);
      setPlaylistPreview({
        previewId: res.data.previewId,
        trackIds: res.data.trackIds || [],
        totalPreviewTrackCount: res.data.totalPreviewTrackCount || 0,
        summary: res.data.summary,
        filterSummary: res.data.filterSummary || [],
        warnings: res.data.warnings || [],
        messages: res.data.messages || (res.data.warnings || []).map((message: string) => ({ severity: "warning", message })),
        signature,
      });
      if (recipeForUsage?.id) {
        await axios.post(`/api/playlist-recipes/${recipeForUsage.id}/use`);
      }
    } catch (e) {
      console.error(e);
      setPreviewError("Unable to generate playlist preview. Check your filters and try again.");
    } finally {
      setLoading(false);
    }
  };

  const previewPlaylist = async () => runPreview();

  const cancelRecipeEditing = () => {
    if (isRecipeDirty && !window.confirm("You have unsaved recipe changes. Leave without saving?")) return;
    router.push("/recipes");
  };

  const regenerateUnpinned = async () => {
    setLoading(true);
    setPreviewError("");
    setExclusionNotice("");
    try {
      const signature = previewConfigSignature();
      const res = await axios.post("/api/playlists/preview", playlistPayload({
        pinnedTrackIds,
        excludedTrackIds,
      }));
      setTracks(res.data.tracks || []);
      setPlaylistPreview({
        previewId: res.data.previewId,
        trackIds: res.data.trackIds || [],
        totalPreviewTrackCount: res.data.totalPreviewTrackCount || 0,
        summary: res.data.summary,
        filterSummary: res.data.filterSummary || [],
        warnings: res.data.warnings || [],
        messages: res.data.messages || (res.data.warnings || []).map((message: string) => ({ severity: "warning", message })),
        signature,
      });
      setPinnedTrackIds((res.data.trackIds || []).filter((trackId: string) => pinnedTrackIds.includes(trackId)));
    } catch (e) {
      console.error(e);
      setPreviewError("Unable to generate playlist preview. Check your filters and try again.");
    } finally {
      setLoading(false);
    }
  };

  const removeTrack = (trackId: string) => {
    setTracks(tracks.filter(track => track.id !== trackId));
    setPlaylistPreview(playlistPreview ? {
      ...playlistPreview,
      trackIds: playlistPreview.trackIds.filter(id => id !== trackId),
      totalPreviewTrackCount: Math.max(0, playlistPreview.totalPreviewTrackCount - 1),
      summary: {
        ...playlistPreview.summary,
        finalTrackCount: Math.max(0, playlistPreview.summary.finalTrackCount - 1),
      },
    } : null);
    setPinnedTrackIds(pinnedTrackIds.filter(id => id !== trackId));
    setExcludedTrackIds([...excludedTrackIds, trackId]);
  };

  const excludeTrack = async (track: any) => {
    const title = track.title || "this track";
    if (!window.confirm(`Exclude "${title}" from future Mixarr playlists?`)) return;

    try {
      await axios.post("/api/track-exclusions", {
        trackId: track.id,
        reason: "Do not want in playlists",
      });
      setTracks((current) => current.filter((item) => item.id !== track.id));
      setPlaylistPreview((current) => current ? {
        ...current,
        trackIds: current.trackIds.filter((id) => id !== track.id),
        totalPreviewTrackCount: Math.max(0, current.totalPreviewTrackCount - 1),
        summary: {
          ...current.summary,
          matchingTrackCount: Math.max(0, current.summary.matchingTrackCount - 1),
          finalTrackCount: Math.max(0, current.summary.finalTrackCount - 1),
          displayedTrackCount: Math.max(0, current.summary.displayedTrackCount - 1),
          manualExclusionsRemoved: (current.summary.manualExclusionsRemoved || 0) + 1,
        },
        filterSummary: [
          ...current.filterSummary.filter((item) => item.label !== "Manual exclusions"),
          { label: "Manual exclusions", value: `${(current.summary.manualExclusionsRemoved || 0) + 1} removed` },
        ],
      } : null);
      setPinnedTrackIds((current) => current.filter((id) => id !== track.id));
      setExcludedTrackIds((current) => current.filter((id) => id !== track.id));
      setExclusionNotice(`Excluded "${title}" from future Mixarr playlists.`);
    } catch (error: any) {
      console.error("Failed to exclude track", error);
      alert(error.response?.data?.error || "Could not exclude track");
    }
  };

  const togglePin = (trackId: string) => {
    setPinnedTrackIds(pinnedTrackIds.includes(trackId)
      ? pinnedTrackIds.filter(id => id !== trackId)
      : [...pinnedTrackIds, trackId]);
  };

  const moveDraggedTrack = (targetTrackId: string) => {
    if (!draggedTrackId || draggedTrackId === targetTrackId) return;
    const draggedIndex = tracks.findIndex(track => track.id === draggedTrackId);
    const targetIndex = tracks.findIndex(track => track.id === targetTrackId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const nextTracks = [...tracks];
    const [draggedTrack] = nextTracks.splice(draggedIndex, 1);
    nextTracks.splice(targetIndex, 0, draggedTrack);
    setTracks(nextTracks);
    if (playlistPreview) setPlaylistPreview({ ...playlistPreview, trackIds: nextTracks.map(track => track.id) });
    setPinnedTrackIds(nextTracks.filter(track => pinnedTrackIds.includes(track.id)).map(track => track.id));
    setDraggedTrackId("");
  };

  const exportToPlex = async () => {
    if (!playlistName) {
      alert("Please enter a playlist name");
      return;
    }
    if (!playlistPreview || !isPreviewCurrent) {
      alert("Preview this playlist recipe before creating it");
      return;
    }
    if (playlistPreview.trackIds.length === 0) {
      alert("No tracks matched this playlist recipe. Adjust your filters and preview again.");
      return;
    }
    setExporting(true);
    try {
      const savedRuleId = autoRefresh || selectedRuleId
        ? await saveSmartPlaylist(false)
        : "";
      if ((autoRefresh || selectedRuleId) && !savedRuleId) return;

      await axios.post("/api/playlists/create-from-preview", {
        name: playlistName,
        trackIds: createTrackIds,
        savedRuleId: savedRuleId || undefined,
        rulesSnapshot: buildRuleTree() || rules,
        optionsSnapshot: playlistPayload({ pinnedTrackIds: [], excludedTrackIds: [] }),
        previewId: playlistPreview.previewId,
        recipeId: activeRecipe?.id || undefined,
        recipeName: activeRecipe?.name || undefined,
        sourceType: activeRecipe ? "recipe" : smartPresetMetadata.smartPresetName ? "smart_builder" : "manual_builder",
        filters: activeRecipe ? playlistPayload({ pinnedTrackIds: [], excludedTrackIds: [] }) : undefined,
        manualExclusionsApplied: playlistPreview.summary.manualExclusionsRemoved || 0,
        removedBySafetyRules: playlistPreview.summary.removedBySafetyRules || 0,
        safetyRulesApplied: playlistPreview.summary.safetyRulesApplied || false,
      });
      await fetchSavedRules();
      await fetchHistory();
      alert("Playlist created in Plex successfully!");
    } catch (e) {
      console.error(e);
      alert("Failed to create playlist in Plex");
    } finally {
      setExporting(false);
    }
  };

  const tuningSlider = (
    key: TuningSliderKey,
    label: string,
    helper: string,
    leftLabel?: string,
    rightLabel?: string,
  ) => (
    <label className={styles.tuningControl}>
      <span className={styles.tuningControlHeader}>
        <span>{label}</span>
        <strong>{Math.round(tuningConfig[key])}</strong>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        value={tuningConfig[key]}
        onChange={(event) => updateTuningConfig({ [key]: Number(event.target.value) } as Partial<SmartMixTuningConfig>)}
      />
      {(leftLabel || rightLabel) && (
        <span className={styles.tuningScale}>
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </span>
      )}
      <small>{helper}</small>
    </label>
  );

  return (
    <>
    <div className="builder-container">
      {/* LEFT COLUMN: BUILDER */}
      <div className={styles.builderMainColumn}>
        <header className={styles.header}>
          <div>
            <h2>Playlist Builder</h2>
            <p>Create dynamic mixes using cached metadata</p>
          </div>
          <button type="button" onClick={() => router.push("/smart-builder")} className={styles.btnSecondary}>
            <Sparkles size={16} />
            Try Smart Builder
          </button>
        </header>

        {smartPresetMetadata.smartPresetName && (
          <div className={styles.recipeNotice}>
            <span>Smart preset: {smartPresetMetadata.smartPresetName}</span>
            <button type="button" onClick={() => setSmartPresetMetadata({})} className={styles.btnIcon} aria-label="Clear smart preset metadata">
              <X size={14} />
            </button>
          </div>
        )}

        {moodPresetMetadata.moodPresetName && (
          <div className={styles.recipeNotice}>
            <span>Mood preset: {displayedMoodPreset}</span>
            <button type="button" onClick={clearMoodPresetMetadata} className={styles.btnIcon} aria-label="Clear mood preset metadata">
              <X size={14} />
            </button>
          </div>
        )}

        {recipeNotice && (
          <div className={styles.recipeNotice}>
            <span>{recipeNotice}</span>
            <button type="button" onClick={() => setRecipeNotice("")} className={styles.btnIcon} aria-label="Dismiss recipe message">
              <X size={14} />
            </button>
          </div>
        )}

        {activeRecipe && (
          <div className={`glass-panel ${styles.recipeEditPanel}`}>
            <div className={styles.recipeEditHeader}>
              <div>
                <h3>{isEditingRecipe ? "Edit Playlist Recipe" : "Recipe Loaded"}</h3>
                <p>{isEditingRecipe ? "Update the saved recipe details and current builder filters." : `Editing recipe: ${activeRecipe.name}`}</p>
              </div>
              <div className={styles.recipeEditActions}>
                <button type="button" onClick={previewPlaylist} disabled={loading} className={styles.btnSecondary}>
                  <Play size={16} />
                  Preview Recipe
                </button>
                <button type="button" onClick={openRecipeModal} disabled={savingRecipe} className={styles.btnSecondary}>
                  {savingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                  Save as New Recipe
                </button>
                <button type="button" onClick={updatePlaylistRecipe} disabled={updatingRecipe} className={styles.btnPrimary}>
                  {updatingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                  Update Recipe
                </button>
                {isEditingRecipe && (
                  <button type="button" onClick={cancelRecipeEditing} className={styles.btnSecondary}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
            <div className={styles.recipeEditFields}>
              <label className={styles.optionLabel}>
                Recipe name
                <input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} className={styles.input} />
              </label>
              <label className={styles.optionLabel}>
                Description, optional
                <textarea value={recipeDescription} onChange={(e) => setRecipeDescription(e.target.value)} className={styles.textarea} rows={3} />
              </label>
            </div>
          </div>
        )}

        {/* Saved Smart Playlists */}
        <div className={`glass-panel ${styles.panel}`}>
          <h3>Saved Smart Playlists</h3>
          <div className={styles.savedBar}>
            <select value={selectedRuleId} onChange={(e) => loadSavedRule(e.target.value)} className={styles.savedBarSelect}>
              <option value="">New smart playlist</option>
              {savedRules.map(rule => (
                <option key={rule.id} value={rule.id}>
                  {rule.name}{rule.autoRefresh ? " (auto)" : ""}
                </option>
              ))}
            </select>
            <label className={styles.savedCheck}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto-refresh after export
            </label>
            <button onClick={() => saveSmartPlaylist()} disabled={saving} className={styles.btnSecondary}>
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {selectedRuleId ? "Update" : "Save"}
            </button>
            <button onClick={openRecipeModal} disabled={savingRecipe} className={styles.btnSecondary}>
              {savingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {activeRecipe ? "Save as New Recipe" : "Save Recipe"}
            </button>
            {activeRecipe && (
              <button onClick={updatePlaylistRecipe} disabled={updatingRecipe} className={styles.btnSecondary}>
                {updatingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                Update Recipe
              </button>
            )}
            {selectedRuleId && (
              <button onClick={refreshSelectedPlaylist} disabled={saving} className={styles.btnSecondary}>
                <RefreshCw size={16} />
                Refresh Plex
              </button>
            )}
          </div>
          {selectedRuleId && savedRules.find(rule => rule.id === selectedRuleId)?.lastRefreshedAt && (
            <p className={styles.savedTimestamp}>
              Last Plex refresh: {new Date(savedRules.find(rule => rule.id === selectedRuleId)!.lastRefreshedAt!).toLocaleString()}
            </p>
          )}
        </div>

        {/* Quick Templates */}
        <div className={`glass-panel ${styles.panel}`}>
          <h3>Quick Templates</h3>
          <div className={styles.templateRow}>
            <button onClick={() => applyTemplate("deep_cuts")} className={styles.btnTemplate}><Shuffle size={14} /> Deep Cuts</button>
            <button onClick={() => applyTemplate("90s")} className={styles.btnTemplate}><Music size={14} /> 90s Decade</button>
            <button onClick={() => applyTemplate("workout")} className={styles.btnTemplate}><Activity size={14} /> Workout (High BPM)</button>
            <button onClick={() => applyTemplate("christmas")} className={styles.btnTemplate}><Star size={14} /> Seasonal</button>
            <button onClick={() => applyTemplate("anti_christmas")} className={styles.btnTemplate}>Anti-Seasonal</button>
          </div>
        </div>

        {/* Playlist Behavior */}
        <div className={`glass-panel ${styles.panel}`}>
          <h3>Playlist Behavior</h3>
          <div className={styles.behaviorGrid}>
            <div className={styles.behaviorRow}>
              <label className={styles.optionLabel}>
                Duplicate Control
                <select value={duplicateStrategy} onChange={(e) => { setDuplicateStrategy(e.target.value as "allow" | "song_artist"); clearPreview(); }} className={styles.select}>
                  <option value="song_artist">One version per song</option>
                  <option value="allow">Allow duplicates</option>
                </select>
              </label>
              <label className={styles.optionLabel}>
                Smart Mix Engine
                <select value={engineVersion} onChange={(e) => { setEngineVersion(e.target.value as EngineVersion); clearPreview(); }} className={styles.select}>
                  <option value="v1">v1 Legacy</option>
                  <option value="v2">v2 Recommendation Tuning</option>
                </select>
              </label>
              <label className={styles.optionLabel}>
                Top-Level Groups
                <select value={rootCombinator} onChange={(e) => { setRootCombinator(e.target.value as "AND" | "OR"); clearPreview(); }} className={styles.select}>
                  <option value="AND">Match all groups</option>
                  <option value="OR">Match any group</option>
                </select>
              </label>
            </div>
            <div className={styles.checkGroup}>
              <label className={styles.checkLabel}><input type="checkbox" checked={preferNonLive} onChange={(e) => { setPreferNonLive(e.target.checked); clearPreview(); }} /> Prefer non-live duplicates</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={excludeRemasters} onChange={(e) => { setExcludeRemasters(e.target.checked); clearPreview(); }} /> Exclude remasters</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeHoliday} onChange={(e) => { setNegativeFilters({ ...negativeFilters, excludeHoliday: e.target.checked }); clearPreview(); }} /> Exclude holiday tracks</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeLive} onChange={(e) => { setNegativeFilters({ ...negativeFilters, excludeLive: e.target.checked }); clearPreview(); }} /> Exclude live tracks</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeExplicit} onChange={(e) => { setNegativeFilters({ ...negativeFilters, excludeExplicit: e.target.checked }); clearPreview(); }} /> Exclude explicit tracks</label>
              <label className={styles.checkLabel}><input type="checkbox" checked={negativeFilters.excludeIntroOutro} onChange={(e) => { setNegativeFilters({ ...negativeFilters, excludeIntroOutro: e.target.checked }); clearPreview(); }} /> Exclude intros/outros</label>
            </div>
            <div className={styles.behaviorRow}>
              <label className={styles.optionLabel}>Min Rating<input value={negativeFilters.minRating} onChange={(e) => { setNegativeFilters({ ...negativeFilters, minRating: e.target.value }); clearPreview(); }} placeholder="0-10" className={styles.input} /></label>
              <label className={styles.optionLabel}>Not Played Days<input value={negativeFilters.excludePlayedWithinDays} onChange={(e) => { setNegativeFilters({ ...negativeFilters, excludePlayedWithinDays: e.target.value }); clearPreview(); }} placeholder="30" className={styles.input} /></label>
              <label className={styles.optionLabel}>Min Minutes<input value={negativeFilters.minDurationMinutes} onChange={(e) => { setNegativeFilters({ ...negativeFilters, minDurationMinutes: e.target.value }); clearPreview(); }} placeholder="1" className={styles.input} /></label>
              <label className={styles.optionLabel}>Max Minutes<input value={negativeFilters.maxDurationMinutes} onChange={(e) => { setNegativeFilters({ ...negativeFilters, maxDurationMinutes: e.target.value }); clearPreview(); }} placeholder="8" className={styles.input} /></label>
            </div>
          </div>
        </div>

        {/* Smart Mix Tuning */}
        <div className={`glass-panel ${styles.panel}`}>
          <div className={styles.sectionTitleRow}>
            <h3>Smart Mix Tuning</h3>
            <SlidersHorizontal size={18} />
          </div>
          <p className={styles.panelSubtext}>Tune how Smart Mix v2 chooses, ranks, and orders tracks.</p>
          <div className={styles.tuningPresetRow}>
            <label className={styles.optionLabel}>
              Preset
              <select value={selectedTuningPreset} onChange={(e) => selectTuningPreset(e.target.value)} className={styles.select}>
                <option value="custom">Custom</option>
                <optgroup label="Built-in presets">
                  {builtInSmartMixTuningPresets.map((preset) => (
                    <option key={preset.id} value={tuningPresetSelectValue(preset)}>{preset.name}</option>
                  ))}
                </optgroup>
                {customTuningPresets.length > 0 && (
                  <optgroup label="Saved presets">
                    {customTuningPresets.map((preset) => (
                      <option key={preset.id} value={tuningPresetSelectValue(preset)}>{preset.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label className={styles.optionLabel}>
              Save as preset
              <input
                value={customTuningPresetName}
                onChange={(e) => setCustomTuningPresetName(e.target.value)}
                placeholder={tuningConfig.presetName && tuningConfig.presetName !== "Custom" ? `${tuningConfig.presetName} copy` : "My tuning preset"}
                className={styles.input}
              />
            </label>
            <div className={styles.tuningPresetActions}>
              <button type="button" onClick={saveTuningPreset} disabled={savingTuningPreset} className={styles.btnSecondary}>
                {savingTuningPreset ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                Save
              </button>
              <button
                type="button"
                onClick={deleteSelectedTuningPreset}
                disabled={!selectedTuningPreset.startsWith("custom:")}
                className={styles.btnDanger}
              >
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </div>
          <div className={styles.tuningGrid}>
            {tuningSlider("recommendationStrength", "Recommendation Strength", "How strongly Mixarr should follow its matching logic.", "Relaxed", "Strict")}
            {tuningSlider("familiarityDiscoveryBalance", "Familiar vs Discovery", "Choose safer favorites or deeper cuts.", "Discovery", "Familiar")}
            {tuningSlider("popularityWeight", "Popularity Weight", "Control how much popularity affects ranking.", "Light", "Strong")}
            {tuningSlider("moodWeight", "Mood Weight", "Higher values keep the emotional feel more consistent.", "Flexible", "Consistent")}
            {tuningSlider("energyWeight", "Energy Weight", "Higher values create smoother energy movement.", "Flexible", "Smooth")}
            {tuningSlider("bpmWeight", "BPM Weight", "Higher values create smoother tempo flow.", "Light", "DJ-style")}
            {tuningSlider("artistVariety", "Artist Variety", "Higher values reduce repeated artists.", "Repeat OK", "More variety")}
            {tuningSlider("albumVariety", "Album Variety", "Higher values reduce repeated albums.", "Repeat OK", "More variety")}
          </div>
          <label className={`${styles.checkLabel} ${styles.tuningCheck}`}>
            <input
              type="checkbox"
              checked={tuningConfig.avoidRecentlyUsedTracks}
              onChange={(e) => updateTuningConfig({ avoidRecentlyUsedTracks: e.target.checked })}
            />
            Avoid recently used tracks
          </label>
        </div>

        <MoodBlendingBetaPanel
          settings={moodBlendSettings}
          onChange={updateMoodBlendSettings}
          serverId={serverId}
          libraryId={libraryId}
        />

        {/* Safety Rules */}
        <div className={`glass-panel ${styles.panel}`}>
          <div className={styles.sectionTitleRow}>
            <h3>Safety Rules</h3>
            <ShieldCheck size={18} />
          </div>
          <p className={styles.panelSubtext}>Optional guardrails to keep generated playlists cleaner and less repetitive.</p>
          <div className={styles.safetyGrid}>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={safetyRules.avoidSameArtistBackToBack}
                onChange={(e) => updateSafetyRules({ avoidSameArtistBackToBack: e.target.checked })}
              />
              Avoid same artist back-to-back
            </label>
            <div className={styles.safetyControl}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={safetyRules.limitTracksPerArtist}
                  onChange={(e) => updateSafetyRules({ limitTracksPerArtist: e.target.checked })}
                />
                Limit tracks per artist
              </label>
              <label className={styles.optionLabel}>
                Max tracks per artist
                <input
                  type="number"
                  min="1"
                  value={safetyRules.maxTracksPerArtist}
                  disabled={!safetyRules.limitTracksPerArtist}
                  onChange={(e) => updateSafetyRules({ maxTracksPerArtist: e.target.value })}
                  className={styles.input}
                />
              </label>
            </div>
            <div className={styles.safetyControl}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={safetyRules.limitTracksPerAlbum}
                  onChange={(e) => updateSafetyRules({ limitTracksPerAlbum: e.target.checked })}
                />
                Limit tracks per album
              </label>
              <label className={styles.optionLabel}>
                Max tracks per album
                <input
                  type="number"
                  min="1"
                  value={safetyRules.maxTracksPerAlbum}
                  disabled={!safetyRules.limitTracksPerAlbum}
                  onChange={(e) => updateSafetyRules({ maxTracksPerAlbum: e.target.value })}
                  className={styles.input}
                />
              </label>
            </div>
            <div className={styles.safetyControl}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={safetyRules.warnIfFewerThan}
                  onChange={(e) => updateSafetyRules({ warnIfFewerThan: e.target.checked })}
                />
                Warn if playlist has fewer than X tracks
              </label>
              <label className={styles.optionLabel}>
                Minimum track warning
                <input
                  type="number"
                  min="1"
                  value={safetyRules.minimumTrackCount}
                  disabled={!safetyRules.warnIfFewerThan}
                  onChange={(e) => updateSafetyRules({ minimumTrackCount: e.target.value })}
                  className={styles.input}
                />
              </label>
            </div>
          </div>
        </div>

        {/* Rule Builder */}
        <div className={`glass-panel ${styles.rulePanel}`}>
          <div className={styles.ruleHeader}>
            <div>
              <h3>Matching Rules</h3>
              <p className={styles.panelSubtext}>
                <strong>Cheat Sheet:</strong> Happy (Energy: 0.7, Mood: 0.9) | Relaxed (E: 0.2, M: 0.6) | Aggressive (E: 0.9, M: 0.3) | Sad (E: 0.3, M: 0.2)
              </p>
            </div>
            <div className={styles.ruleHeaderActions}>
              <button onClick={addRule} className={styles.btnGhost}>
                <Plus size={16} /> Add Rule
              </button>
              <button onClick={addGroup} className={styles.btnGhost}>
                <Plus size={16} /> Add OR Group
              </button>
            </div>
          </div>

          <div className={styles.ruleList}>
            {rules.map((rule, i) => (
              <div key={i} className={styles.ruleRow}>
                <select
                  value={rule.field}
                  onChange={(e) => updateRule(i, "field", e.target.value)}
                  className={styles.select}
                >
                  <option value="popularity">Popularity Score (0-100)</option>
                  <option value="energy">Energy (0.0-1.0)</option>
                  <option value="valence">Mood/Valence (0.0-1.0)</option>
                  <option value="tempo">BPM (Beats Per Minute) / Tempo</option>
                  <option value="year">Release Year</option>
                  <option value="duration">Duration (ms)</option>
                  <option value="rating">Plex Rating</option>
                  <option value="playCount">Play Count</option>
                  <option value="isLive">Live Track</option>
                  <option value="isRemaster">Remaster</option>
                  <option value="isExplicit">Explicit</option>
                  <option value="hasPopularity">Has Popularity Score</option>
                  <option value="genre">Genre Tag</option>
                  <option value="artist">Artist Name</option>
                  <option value="album">Album Title</option>
                  <option value="title">Track Title</option>
                </select>

                <select
                  value={rule.operator}
                  onChange={(e) => updateRule(i, "operator", e.target.value)}
                  className={styles.select}
                >
                  <option value="eq">Equals (=)</option>
                  <option value="contains">Contains</option>
                  <option value="not_contains">Does Not Contain</option>
                  <option value="gt">Greater Than (&gt;)</option>
                  <option value="lt">Less Than (&lt;)</option>
                  <option value="gte">Greater or Equal (&ge;)</option>
                  <option value="lte">Less or Equal (&le;)</option>
                </select>

                <input
                  type="text"
                  value={rule.value}
                  onChange={(e) => updateRule(i, "value", e.target.value)}
                  placeholder="Value..."
                  className={styles.input}
                />

                <button onClick={() => removeRule(i)} className={styles.btnGhostDanger}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {ruleGroups.map((group) => (
              <div key={group.id} className={styles.ruleGroupBox}>
                <div className={styles.ruleGroupHeader}>
                  <select value={group.combinator} onChange={(e) => updateGroup(group.id, { combinator: e.target.value as "AND" | "OR" })} className={styles.select}>
                    <option value="OR">Any rule in this group</option>
                    <option value="AND">All rules in this group</option>
                  </select>
                  <button onClick={() => { setRuleGroups(ruleGroups.filter(item => item.id !== group.id)); clearPreview(); }} className={styles.btnGhostDanger}>
                    <Trash2 size={16} />
                  </button>
                </div>
                {group.rules.map((rule, i) => (
                  <div key={i} className={styles.ruleRow}>
                    <select value={rule.field} onChange={(e) => updateGroupRule(group.id, i, "field", e.target.value)} className={styles.select}>
                      <option value="popularity">Popularity Score (0-100)</option>
                      <option value="energy">Energy (0.0-1.0)</option>
                      <option value="valence">Mood/Valence (0.0-1.0)</option>
                      <option value="tempo">BPM / Tempo</option>
                      <option value="year">Release Year</option>
                      <option value="duration">Duration (ms)</option>
                      <option value="rating">Plex Rating</option>
                      <option value="playCount">Play Count</option>
                      <option value="isLive">Live Track</option>
                      <option value="isRemaster">Remaster</option>
                      <option value="isExplicit">Explicit</option>
                      <option value="hasPopularity">Has Popularity Score</option>
                      <option value="genre">Genre Tag</option>
                      <option value="artist">Artist Name</option>
                      <option value="album">Album Title</option>
                      <option value="title">Track Title</option>
                    </select>
                    <select value={rule.operator} onChange={(e) => updateGroupRule(group.id, i, "operator", e.target.value)} className={styles.select}>
                      <option value="eq">Equals (=)</option>
                      <option value="contains">Contains</option>
                      <option value="not_contains">Does Not Contain</option>
                      <option value="gt">Greater Than (&gt;)</option>
                      <option value="lt">Less Than (&lt;)</option>
                      <option value="gte">Greater or Equal (&ge;)</option>
                      <option value="lte">Less or Equal (&le;)</option>
                    </select>
                    <input type="text" value={rule.value} onChange={(e) => updateGroupRule(group.id, i, "value", e.target.value)} placeholder="Value..." className={styles.input} />
                    <button onClick={() => removeGroupRule(group.id, i)} className={styles.btnGhostDanger}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button onClick={() => addGroupRule(group.id)} className={styles.btnGhost}>
                  <Plus size={16} /> Add Group Rule
                </button>
              </div>
            ))}
          </div>

          <div className={styles.ruleFooter}>
            <div className={styles.limitLabel}>
              <label>Track Limit:</label>
              <input type="number" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); clearPreview(); }} className={styles.limitInput} />
            </div>
            <button onClick={previewPlaylist} disabled={loading} className={`${styles.btnPrimary} ${styles.rulePreviewButton}`}>
              <Play size={16} /> {loading ? "Querying..." : "Preview Playlist"}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: PREVIEW */}
      <div className={`glass-panel ${styles.previewPanel}`}>
        <div className={styles.previewHeader}>
          <div>
            <h3>Playlist Preview</h3>
            <p>Review the exact playlist order before Mixarr writes to Plex.</p>
          </div>
          <div className={styles.previewActions}>
            <button onClick={previewPlaylist} disabled={loading} className={styles.btnSecondary}>
              <Play size={14} /> Preview Playlist
            </button>
            <button onClick={regenerateUnpinned} disabled={loading || !playlistPreview} className={styles.btnSecondary}>
              <RefreshCw size={14} /> Refresh Preview
            </button>
          </div>
        </div>

        <div className={styles.previewNameRow}>
          <input
            type="text"
            placeholder="Name your playlist..."
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            className={styles.previewNameInput}
          />
          <button onClick={exportToPlex} disabled={exporting || !canCreateFromPreview} className={styles.btnPrimary}>
            <Upload size={16} /> {exporting ? "Creating..." : "Create Playlist"}
          </button>
        </div>
        {!playlistNameReady && (
          <p className={styles.helperText}>Enter a playlist name before creating the playlist.</p>
        )}
        <p className={styles.helperText}>Refresh Preview reruns the current filters.</p>

        {playlistPreview && !isPreviewCurrent && (
          <div className={styles.staleNotice}>
            <AlertTriangle size={16} />
            Filters changed after this preview. Refresh the preview before creating the playlist.
          </div>
        )}

        {exclusionNotice && (
          <div className={styles.exclusionNotice}>
            <Ban size={16} />
            {exclusionNotice}
          </div>
        )}

        {playlistPreview && (
          <>
            <div className={styles.statsGrid}>
              <div className={styles.statCard}>
                <span>Target</span>
                <strong>{playlistPreview.summary.targetTrackCount}</strong>
              </div>
              <div className={styles.statCard}>
                <span>Engine</span>
                <strong>{playlistPreview.summary.engineLabel?.replace("Smart Mix Engine: ", "") || "v1 Legacy"}</strong>
              </div>
              {playlistPreview.summary.engineVersion === "v2" && (
                <div className={styles.statCard}>
                  <span>Tuning</span>
                  <strong>{playlistPreview.summary.tuningPresetName || "Custom"}</strong>
                </div>
              )}
              <div className={styles.statCard}>
                <span>Matched</span>
                <strong>{playlistPreview.summary.matchingTrackCount}</strong>
              </div>
              <div className={styles.statCard}>
                <span>Preview</span>
                <strong>{playlistPreview.summary.finalTrackCount}</strong>
              </div>
              <div className={styles.statCard}>
                <span>Duration</span>
                <strong>{formatEstimatedDuration(playlistPreview.summary.estimatedDurationMinutes)}</strong>
              </div>
              {(playlistPreview.summary.manualExclusionsRemoved || 0) > 0 && (
                <div className={styles.statCard}>
                  <span>Manual exclusions</span>
                  <strong>{playlistPreview.summary.manualExclusionsRemoved} removed</strong>
                </div>
              )}
              {(playlistPreview.summary.removedBySafetyRules || 0) > 0 && (
                <div className={styles.statCard}>
                  <span>Safety removed</span>
                  <strong>{playlistPreview.summary.removedBySafetyRules} removed</strong>
                </div>
              )}
              {(playlistPreview.summary.safetyRearrangedTrackCount || 0) > 0 && (
                <div className={styles.statCard}>
                  <span>Artist moves</span>
                  <strong>{playlistPreview.summary.safetyRearrangedTrackCount} moved</strong>
                </div>
              )}
              {playlistPreview.summary.safetyRulesApplied && (
                <div className={styles.statCard}>
                  <span>Safety rules</span>
                  <strong>On</strong>
                </div>
              )}
            </div>

            {(playlistPreview.summary.manualExclusionsRemoved || 0) > 0 && (
              <p className={styles.manualExclusionText}>
                {playlistPreview.summary.manualExclusionsRemoved} manually excluded track{playlistPreview.summary.manualExclusionsRemoved === 1 ? " was" : "s were"} removed from this preview.
              </p>
            )}
            {playlistPreview.summary.safetyRuleSummary && (
              <p className={styles.manualExclusionText}>
                {playlistPreview.summary.safetyRuleSummary}
              </p>
            )}

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

            {playlistPreview.messages.length > 0 && (
              <div className={styles.messageList}>
                {playlistPreview.messages.map((message) => (
                  <div key={`${message.severity}-${message.message}`} className={`${styles.messagePanel} ${styles[`messagePanel${message.severity.charAt(0).toUpperCase()}${message.severity.slice(1)}`]}`}>
                    <div className={styles.messageTitle}>
                      {message.severity === "info" ? <Info size={16} /> : <AlertTriangle size={16} />}
                      {message.severity === "info" ? "Info" : message.severity === "error" ? "Needs Attention" : "Warning"}
                    </div>
                    <p>{message.message}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <section className={styles.trackPreviewSection} aria-labelledby="previewed-tracks">
          <div className={styles.trackPreviewHeader}>
            <div>
              <h4 id="previewed-tracks">Previewed Tracks</h4>
              <p>These are the tracks Mixarr will add to Plex in this order.</p>
            </div>
            {playlistPreview && tracks.length > 0 && (
              <span className={styles.trackPreviewCount}>
                {playlistPreview.totalPreviewTrackCount > tracks.length
                  ? `Showing first ${tracks.length} of ${playlistPreview.totalPreviewTrackCount} matched tracks. Create Playlist will use these ${tracks.length} previewed tracks.`
                  : `Showing ${tracks.length} previewed tracks. Create Playlist will use these exact tracks.`}
              </span>
            )}
          </div>

          {loading ? (
            <div className={styles.loadingPreview}>Generating playlist preview...</div>
          ) : previewError ? (
            <div className={styles.errorPreview}>{previewError}</div>
          ) : tracks.length === 0 ? (
            <div className={styles.emptyPreview}>
              {playlistPreview?.totalPreviewTrackCount === 0
                ? "No tracks matched this playlist preview. Adjust your filters and try again."
                : "Click Preview Playlist to see matched tracks before creating anything in Plex."}
            </div>
          ) : (
            <>
              <div className={`table-container ${styles.trackTableWrap}`}>
                <table className={styles.previewTable}>
                  <thead>
                    <tr>
                      <th className={styles.colIndex}>#</th>
                      <th>Track title</th>
                      <th>Artist</th>
                      <th>Album</th>
                      <th className={styles.colDuration}>Duration</th>
                      <th className={styles.colBpm}>BPM</th>
                      <th className={styles.colFeature}>Energy</th>
                      <th className={styles.colFeature}>Mood</th>
                      <th className={styles.colPop}>Popularity</th>
                      <th className={styles.colActions}>Tools</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tracks.map((track, idx) => (
                      <tr
                        key={track.id}
                        draggable
                        onDragStart={() => setDraggedTrackId(track.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => moveDraggedTrack(track.id)}
                      >
                        <td className={styles.trackOrder}>{idx + 1}</td>
                        <td className={styles.trackTitle}>
                          {track.title || "—"}
                          {(track.isLive || track.isRemaster || track.isExplicit) && (
                            <div className={styles.badgeRow}>
                              {track.isLive && <span className={styles.miniBadge}>Live</span>}
                              {track.isRemaster && <span className={styles.miniBadge}>Remaster</span>}
                              {track.isExplicit && <span className={styles.miniBadge}>Explicit</span>}
                            </div>
                          )}
                        </td>
                        <td className={styles.trackArtist}>{track.artist?.title || "—"}</td>
                        <td className={styles.trackAlbum}>{track.album?.title || "—"}</td>
                        <td className={styles.trackDuration}>{formatDuration(track.duration)}</td>
                        <td className={styles.trackBpm}>
                          {(track.effectiveBpm ?? track.bpm ?? track.audioFeature?.tempo)?.toFixed(0) || "—"}
                          {track.metadataConfidence?.audio?.tempoLabel && <div className={styles.trackBpmLabel}>{track.metadataConfidence.audio.tempoLabel}</div>}
                        </td>
                        <td className={styles.trackFeature}>{(track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy)?.toFixed(2) || "—"}</td>
                        <td className={styles.trackFeature}>{(track.audioFeature?.effectiveMood ?? track.audioFeature?.valence)?.toFixed(2) || "—"}</td>
                        <td className={styles.trackPop}>{track.popularity?.score?.toFixed(0) || "—"}</td>
                        <td>
                          <div className={styles.actionGroup}>
                            <button title="Drag row" className={styles.btnIcon}><GripVertical size={14} /></button>
                            <button title={pinnedTrackIds.includes(track.id) ? "Unpin" : "Pin"} onClick={() => togglePin(track.id)} className={`${styles.btnIcon} ${pinnedTrackIds.includes(track.id) ? styles.pinActive : ""}`}><Pin size={14} /></button>
                            <button title="Remove from this preview" onClick={() => removeTrack(track.id)} className={styles.btnIcon}><X size={14} /></button>
                            <TrackPreviewButton trackId={track.id} />
                            <button title="Exclude from future Mixarr playlists" onClick={() => excludeTrack(track)} className={styles.btnIcon}><Ban size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.mobileTrackCards}>
                {tracks.map((track, idx) => (
                  <article key={track.id} className={styles.mobileTrackCard}>
                    <div className={styles.mobileTrackTop}>
                      <span className={styles.mobileTrackOrder}>{idx + 1}</span>
                      <div>
                        <h5>{track.title || "—"}</h5>
                        <p>{track.artist?.title || "—"}</p>
                      </div>
                    </div>
                    <div className={styles.mobileTrackMeta}>
                      <span>Album <strong>{track.album?.title || "—"}</strong></span>
                      <span>Duration <strong>{formatDuration(track.duration)}</strong></span>
                      <span>BPM <strong>{(track.effectiveBpm ?? track.bpm ?? track.audioFeature?.tempo)?.toFixed(0) || "—"}</strong></span>
                      <span>Energy <strong>{(track.audioFeature?.effectiveEnergy ?? track.audioFeature?.energy)?.toFixed(2) || "—"}</strong></span>
                      <span>Mood <strong>{(track.audioFeature?.effectiveMood ?? track.audioFeature?.valence)?.toFixed(2) || "—"}</strong></span>
                    </div>
                    <div className={styles.mobileTrackActions}>
                      <button type="button" onClick={() => excludeTrack(track)} className={styles.btnSecondary}>
                        <Ban size={14} />
                        Exclude
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        {playlistPreview && (
          <details className={styles.detailsPanel}>
            <summary>Filters used and playlist stats</summary>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryPanel}>
                <h4><ListChecks size={15} /> Filters used</h4>
                <dl>
                  {playlistPreview.filterSummary.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className={styles.summaryPanel}>
                <h4><Clock size={15} /> Playlist stats</h4>
                <dl>
                  <div><dt>BPM</dt><dd>{playlistPreview.summary.bpmRange}</dd></div>
                  <div><dt>Energy</dt><dd>{playlistPreview.summary.energyRange}</dd></div>
                  <div><dt>Mood</dt><dd>{playlistPreview.summary.moodRange}</dd></div>
                  <div><dt>Popularity</dt><dd>{playlistPreview.summary.popularityRange}</dd></div>
                  <div><dt>Artists</dt><dd>{playlistPreview.summary.diversity.artistCount}</dd></div>
                  <div><dt>Albums</dt><dd>{playlistPreview.summary.diversity.albumCount}</dd></div>
                  {(playlistPreview.summary.manualExclusionsRemoved || 0) > 0 && <div><dt>Manual exclusions</dt><dd>{playlistPreview.summary.manualExclusionsRemoved} removed</dd></div>}
                  <div><dt>Safety</dt><dd>{playlistPreview.summary.safetyRuleSummary || "Safety rules: off"}</dd></div>
                  <div><dt>Safety removed</dt><dd>{playlistPreview.summary.removedBySafetyRules || 0}</dd></div>
                  <div><dt>Artist spacing</dt><dd>{playlistPreview.summary.artistSpacingApplied ? "Yes" : "No"}</dd></div>
                  <div><dt>Album limit</dt><dd>{playlistPreview.summary.albumLimitApplied ? "Yes" : "No"}</dd></div>
                  <div><dt>Missing BPM</dt><dd>{playlistPreview.summary.missing.bpm}</dd></div>
                  <div><dt>Missing features</dt><dd>{playlistPreview.summary.missing.audioFeatures}</dd></div>
                </dl>
              </div>
            </div>
          </details>
        )}

        {history.length > 0 && (
          <div className={styles.historySection}>
            <h4>Recent Playlist History</h4>
            <div className={styles.historyList}>
              {history.slice(0, 5).map((item) => (
                <div key={item.id} className={styles.historyItem}>
                  <span>{item.name} ({item.trackCount})</span>
                  <span className={item.status === "success" ? styles.historySuccess : styles.historyFail}>{item.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>

    {showRecipeModal && (
      <div className={styles.modalOverlay} role="presentation">
        <div className={styles.recipeModal} role="dialog" aria-modal="true" aria-labelledby="save-recipe-title">
          <div className={styles.modalHeader}>
            <div>
              <h3 id="save-recipe-title">{activeRecipe ? "Save as New Playlist Recipe" : "Save Playlist Recipe"}</h3>
              <p>Save your current filters so you can reuse this playlist setup later.</p>
            </div>
            <button type="button" onClick={() => setShowRecipeModal(false)} className={styles.btnIcon} aria-label="Close save recipe dialog">
              <X size={16} />
            </button>
          </div>
          <label className={styles.optionLabel}>
            Recipe name
            <input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} className={styles.input} autoFocus />
          </label>
          <label className={styles.optionLabel}>
            Description, optional
            <textarea value={recipeDescription} onChange={(e) => setRecipeDescription(e.target.value)} className={styles.textarea} rows={4} />
          </label>
          <div className={styles.modalActions}>
            <button type="button" onClick={() => setShowRecipeModal(false)} className={styles.btnSecondary}>
              Cancel
            </button>
            <button type="button" onClick={savePlaylistRecipe} disabled={savingRecipe} className={styles.btnPrimary}>
              {savingRecipe ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {activeRecipe ? "Save as New Recipe" : "Save Recipe"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
