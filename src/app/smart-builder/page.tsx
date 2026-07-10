"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Ban, BookMarked, CheckCircle2, ListChecks, Play, RefreshCw, Save, Sparkles, Upload } from "lucide-react";
import BpmPresetPicker from "@/components/BpmPresetPicker";
import MoodPresetPicker from "@/components/MoodPresetPicker";
import { BPM_PRESET_VERSION, bpmPresetLabel, bpmPresetRangeLabel, getBpmPreset, type BpmPreset } from "@/lib/bpmPresets";
import TrackPreviewButton from "@/components/TrackPreviewButton";
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

type MoodBlendMode = "off" | "smooth_transition" | "strict_matching" | "mixed_mood";

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

function parseMoodList(value: string) {
  return value
    .split(/->|>|,|\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 12);
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
  const [moodBlendMode, setMoodBlendMode] = useState<MoodBlendMode>("off");
  const [moodPathInput, setMoodPathInput] = useState("");
  const [allowedMoodsInput, setAllowedMoodsInput] = useState("");
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
  const [playlistPreview, setPlaylistPreview] = useState<PlaylistPreviewState | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingRecipe, setSavingRecipe] = useState(false);

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
  }, []);

  const clearPreview = () => {
    setTracks([]);
    setPlaylistPreview(null);
    setPreviewError("");
    setNotice("");
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
      moodBlendMode,
      selectedMoodPath: moodBlendMode === "smooth_transition" || moodBlendMode === "strict_matching" ? parseMoodList(moodPathInput) : [],
      allowedMoods: moodBlendMode === "mixed_mood" ? parseMoodList(allowedMoodsInput) : [],
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
    };
  };

  const previewSignature = () => JSON.stringify(playlistPayload());
  const isPreviewCurrent = Boolean(playlistPreview && playlistPreview.signature === previewSignature());
  const playlistNameReady = playlistName.trim().length > 0;
  const canPreview = !loading;
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
    const payload = playlistPayload();
    if (!payload) return;
    setLoading(true);
    setPreviewError("");
    setNotice("");
    try {
      const signature = JSON.stringify(payload);
      const res = await axios.post("/api/playlists/preview", payload);
      setTracks(res.data.tracks || []);
      setPlaylistPreview({
        previewId: res.data.previewId,
        trackIds: res.data.trackIds || [],
        totalPreviewTrackCount: res.data.totalPreviewTrackCount || 0,
        summary: res.data.summary,
        filterSummary: res.data.filterSummary || [],
        warnings: res.data.warnings || [],
        signature,
      });
    } catch (error) {
      console.error(error);
      setPreviewError("Unable to generate playlist preview. Adjust the preset settings and try again.");
    } finally {
      setLoading(false);
    }
  };

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
        trackIds: tracks.map((track) => track.id),
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
            <div className={styles.moodBlendBox}>
              <div className={styles.moodBlendHeader}>
                <div>
                  <h4>Mood Blending</h4>
                  <p>Guide how Smart Mix v2 moves between mood tags while keeping BPM, energy, and tuning active.</p>
                </div>
                <span>{moodBlendLabel(moodBlendMode)}</span>
              </div>
              <div className={styles.formGrid}>
                <label className={styles.fieldLabel}>
                  Mood Blend Mode
                  <select value={moodBlendMode} onChange={(event) => { setMoodBlendMode(event.target.value as MoodBlendMode); clearPreview(); }} className={styles.select}>
                    <option value="off">Off</option>
                    <option value="smooth_transition">Smooth Transition</option>
                    <option value="strict_matching">Strict Matching</option>
                    <option value="mixed_mood">Mixed Mood</option>
                  </select>
                </label>
                {moodBlendMode === "mixed_mood" ? (
                  <label className={styles.fieldLabel}>
                    Allowed Moods
                    <input value={allowedMoodsInput} onChange={(event) => { setAllowedMoodsInput(event.target.value); clearPreview(); }} placeholder="Chill, Focus, Ambient" className={styles.input} />
                  </label>
                ) : (
                  <label className={styles.fieldLabel}>
                    Mood Path
                    <input value={moodPathInput} onChange={(event) => { setMoodPathInput(event.target.value); clearPreview(); }} placeholder="Happy -> Energetic -> Party" className={styles.input} />
                  </label>
                )}
              </div>
            </div>
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
                        </div>
                        <div className={styles.trackActions}>
                          <TrackPreviewButton trackId={track.id} />
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
