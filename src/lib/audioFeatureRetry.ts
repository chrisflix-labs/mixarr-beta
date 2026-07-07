import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import {
  getAudioFeatureHealthStatus,
  type EffectiveAudioFeatureSettings,
} from "./audioFeatures";
import { invalidateLibraryHealthCache, isAudioFeatureHealthFilter, type AudioFeatureHealthFilter } from "./libraryHealth";
import { resolveLibraryHealthTrackIds } from "./libraryHealthDetails";
import { safeRecordJobHistory } from "./jobHistory";
import { buildRetryExplanation, formatRetrySkipReasons } from "./retryExplanations";
import { metadataProviderModeKey } from "./syncSettings";

export type AudioFeatureRetryMode =
  | "configured_providers"
  | "api_only"
  | "local_only"
  | "force_local_reprocess";

export type LegacyAudioFeatureRetryMode = "configured" | "api_only" | "local_only" | "force_local";

export type AudioFeatureSkipReason =
  | "missing_local_file"
  | "unsupported_file_type"
  | "file_not_readable"
  | "already_complete"
  | "already_processing"
  | "local_analysis_disabled"
  | "essentia_unavailable"
  | "provider_disabled"
  | "api_disabled"
  | "local_disabled"
  | "too_short"
  | "previous_failure"
  | "not_active"
  | "not_in_selected_library"
  | "missing_required_metadata"
  | "not_eligible_for_selected_mode"
  | "unknown";

export type AudioFeatureRetryRequest = {
  filter?: string | null;
  mode?: AudioFeatureRetryMode | LegacyAudioFeatureRetryMode | string | null;
  providerMode?: AudioFeatureRetryMode | LegacyAudioFeatureRetryMode | string | null;
  trackIds?: string[];
  libraryId?: string;
  force?: boolean;
};

export type AudioFeatureRetryResult = {
  filter: string;
  mode: AudioFeatureRetryMode;
  providerMode: string;
  matched: number;
  eligible: number;
  queued: number;
  skipped: number;
  processed: number;
  failed: number;
  skipReasons: Record<string, number>;
  skipReasonLabels: Record<string, string>;
  summary: string;
  message: string;
  explanation: string | null;
  disabledReason: string | null;
  canRun: boolean;
  trackIds: string[];
  analyzer: "Essentia";
  analyzerAvailable: boolean | null;
  analysisScope: string;
  analysisScopeLabel: string;
  expectedAction: string;
  jobId?: string | null;
};

type RetryTrack = {
  id: string;
  title: string | null;
  mediaPath: string | null;
  syncStatus: string | null;
  bpm?: number | null;
  apiBpm?: number | null;
  localBpm?: number | null;
  effectiveBpm?: number | null;
  bpmSource?: string | null;
  artist?: { title: string | null } | null;
  audioFeature?: {
    energy?: number | null;
    valence?: number | null;
    danceability?: number | null;
    acousticness?: number | null;
    apiEnergy?: number | null;
    apiMood?: number | null;
    apiDanceability?: number | null;
    apiAcousticness?: number | null;
    localEnergy?: number | null;
    localMood?: number | null;
    localDanceability?: number | null;
    localAcousticness?: number | null;
    effectiveEnergy?: number | null;
    effectiveMood?: number | null;
    effectiveDanceability?: number | null;
    effectiveAcousticness?: number | null;
    tempo?: number | null;
    source?: string | null;
    tempoSource?: string | null;
    audioFeatureSource?: string | null;
    audioFeatureStatus?: string | null;
    audioFeatureFailureReason?: string | null;
    audioFeatureAnalysisScope?: string | null;
    audioFeatureConfidence?: number | null;
    energySource?: string | null;
    valenceSource?: string | null;
    danceabilitySource?: string | null;
    acousticnessSource?: string | null;
  } | null;
};

const retryTrackSelect = {
  id: true,
  title: true,
  mediaPath: true,
  syncStatus: true,
  bpm: true,
  apiBpm: true,
  localBpm: true,
  effectiveBpm: true,
  bpmSource: true,
  artist: { select: { title: true } },
  audioFeature: {
    select: {
      energy: true,
      valence: true,
      danceability: true,
      acousticness: true,
      apiEnergy: true,
      apiMood: true,
      apiDanceability: true,
      apiAcousticness: true,
      localEnergy: true,
      localMood: true,
      localDanceability: true,
      localAcousticness: true,
      effectiveEnergy: true,
      effectiveMood: true,
      effectiveDanceability: true,
      effectiveAcousticness: true,
      tempo: true,
      source: true,
      tempoSource: true,
      audioFeatureSource: true,
      audioFeatureStatus: true,
      audioFeatureFailureReason: true,
      audioFeatureAnalysisScope: true,
      audioFeatureConfidence: true,
      energySource: true,
      valenceSource: true,
      danceabilitySource: true,
      acousticnessSource: true,
    },
  },
} satisfies Prisma.TrackSelect;

function increment(reasons: Record<string, number>, reason: AudioFeatureSkipReason) {
  reasons[reason] = (reasons[reason] || 0) + 1;
}

export function audioFeatureAnalysisScopeLabel(scope?: string | null) {
  if (scope === "whole_track") return "Whole track";
  if (scope === "middle_sample") return "Middle sample";
  return "Sample window";
}

export const audioFeatureSkipReasonLabels: Record<string, string> = {
  missing_local_file: "Missing local file",
  unsupported_file_type: "Unsupported file type",
  file_not_readable: "File not readable",
  already_complete: "Already complete",
  already_processing: "Already processing",
  local_analysis_disabled: "Local analysis disabled",
  essentia_unavailable: "Essentia unavailable",
  provider_disabled: "Provider disabled",
  api_disabled: "API audio features disabled",
  local_disabled: "Local analysis disabled",
  too_short: "Too short",
  previous_failure: "Previous failure",
  not_active: "Not active",
  not_in_selected_library: "Not in selected library",
  missing_required_metadata: "Missing required metadata",
  not_eligible_for_selected_mode: "Not eligible for selected mode",
  unknown: "Unknown",
};

function labelsForReasons(reasons: Record<string, number>) {
  return Object.fromEntries(
    Object.keys(reasons).map((reason) => [reason, audioFeatureSkipReasonLabels[reason] || reason.replace(/_/g, " ")]),
  );
}

export function normalizeAudioFeatureRetryMode(value?: string | null, force?: boolean): AudioFeatureRetryMode {
  if (force || value === "force_local" || value === "force_local_reprocess") return "force_local_reprocess";
  if (value === "api_only") return "api_only";
  if (value === "local_only") return "local_only";
  return "configured_providers";
}

export function legacyAudioFeatureProviderMode(mode: AudioFeatureRetryMode): LegacyAudioFeatureRetryMode {
  if (mode === "configured_providers") return "configured";
  if (mode === "force_local_reprocess") return "force_local";
  return mode;
}

export function audioFeatureRetryProviderMode(settings: EffectiveAudioFeatureSettings) {
  return metadataProviderModeKey({
    api: settings.api ?? settings.enableApiAudioFeatures ?? true,
    local: settings.local ?? settings.enableLocalAudioFeatures ?? true,
    preferLocal: settings.preferLocal ?? settings.preferLocalAudioFeatures ?? false,
  } as any);
}

export function configuredProviderLabel(settings: EffectiveAudioFeatureSettings) {
  const api = settings.api ?? settings.enableApiAudioFeatures ?? true;
  const local = settings.local ?? settings.enableLocalAudioFeatures ?? true;
  if (api && local) return "API + Local Essentia";
  if (local) return "Local Essentia";
  if (api) return "API";
  return "Disabled";
}

function providerSettingsForMode(settings: EffectiveAudioFeatureSettings, mode: AudioFeatureRetryMode): EffectiveAudioFeatureSettings {
  if (mode === "api_only") return { ...settings, api: true, local: false, enableApiAudioFeatures: true, enableLocalAudioFeatures: false };
  if (mode === "local_only" || mode === "force_local_reprocess") {
    return { ...settings, api: false, local: true, enableApiAudioFeatures: false, enableLocalAudioFeatures: true, preferLocal: true, preferLocalAudioFeatures: true };
  }
  return settings;
}

function hasLocalFile(track: RetryTrack) {
  const feature = track.audioFeature;
  const source = String(feature?.source || feature?.audioFeatureSource || "").toLowerCase();
  const tempoSource = String(feature?.tempoSource || "").toLowerCase();
  const bpmSource = String(track.bpmSource || "").toLowerCase();
  return !!track.mediaPath && source !== "local_not_found" && tempoSource !== "local_not_found" && bpmSource !== "local_not_found";
}

function hasRequiredApiMetadata(track: RetryTrack) {
  return !!track.title?.trim() && !!track.artist?.title?.trim();
}

function selectedProviders(settings: EffectiveAudioFeatureSettings, mode: AudioFeatureRetryMode) {
  const api = settings.api ?? settings.enableApiAudioFeatures ?? true;
  const local = settings.local ?? settings.enableLocalAudioFeatures ?? true;
  if (mode === "api_only") return { api: true, local: false, disabledReason: api ? null : "API audio features are disabled." };
  if (mode === "local_only" || mode === "force_local_reprocess") {
    return { api: false, local: true, disabledReason: local ? null : "Local Essentia analysis is disabled." };
  }
  if (!api && !local) return { api: false, local: false, disabledReason: "No audio feature providers are enabled." };
  return { api, local, disabledReason: null };
}

export function audioFeatureRetryEligibility(track: RetryTrack, options: {
  mode: AudioFeatureRetryMode;
  settings: EffectiveAudioFeatureSettings;
}): AudioFeatureSkipReason | null {
  const providers = selectedProviders(options.settings, options.mode);
  if (options.mode === "api_only" && providers.disabledReason) return "api_disabled";
  if ((options.mode === "local_only" || options.mode === "force_local_reprocess") && providers.disabledReason) return "local_disabled";
  if (providers.disabledReason) return "provider_disabled";

  const providerSettings = providerSettingsForMode(options.settings, options.mode);
  const classification = getAudioFeatureHealthStatus(track, providerSettings);
  const localRequired = !providers.api && providers.local;

  if (track.audioFeature?.audioFeatureStatus === "pending") return "already_processing";
  if (options.mode !== "force_local_reprocess" && classification.status === "complete") return "already_complete";
  if (localRequired && !hasLocalFile(track)) return "missing_local_file";
  if (localRequired && classification.status === "too_short") return "too_short";
  if (providers.api && !hasRequiredApiMetadata(track)) return "missing_required_metadata";
  return null;
}

function formatSummary(input: {
  filter: string;
  mode: AudioFeatureRetryMode;
  providerMode: string;
  analysisScopeLabel?: string;
  matched: number;
  eligible?: number;
  queued: number;
  skipped: number;
  skipReasons: Record<string, number>;
}) {
  const skipped = formatRetrySkipReasons(input.skipReasons);
  if (input.queued === 0) {
    const reason = skipped || "all matching tracks are already complete or not eligible for the selected provider mode";
    return `No local audio analysis jobs were queued. Matched ${input.matched} track${input.matched === 1 ? "" : "s"}, queued 0, skipped ${input.skipped}. Reason: ${reason}.`;
  }
  const localMode = input.mode === "local_only" || input.mode === "force_local_reprocess";
  const base = localMode
    ? `Local audio analysis preflight matched ${input.matched} track${input.matched === 1 ? "" : "s"}, eligible ${input.eligible ?? input.queued}, queued ${input.queued}, skipped ${input.skipped}. Scope: ${input.analysisScopeLabel || "Sample window"}.`
    : `Audio feature retry matched ${input.matched} track${input.matched === 1 ? "" : "s"}, eligible ${input.eligible ?? input.queued}, queued ${input.queued}, skipped ${input.skipped}.`;
  return skipped ? `${base} Skipped: ${skipped}.` : base;
}

function expectedActionFor(mode: AudioFeatureRetryMode, queued: number) {
  if (queued === 0) return "No jobs will be queued.";
  if (mode === "force_local_reprocess") return "Recalculate local audio features for eligible tracks using Essentia.";
  if (mode === "local_only") return "Analyze eligible local files with Essentia.";
  if (mode === "api_only") return "Queue eligible tracks for API audio-feature lookup.";
  return "Queue eligible tracks using the configured audio-feature providers.";
}

async function resolveRetryTargetTrackIds(userId: string, input: {
  filter: string;
  trackIds?: string[];
  libraryId?: string;
  settings: EffectiveAudioFeatureSettings;
}) {
  const activeScope = {
    syncStatus: "active",
    library: { ...(input.libraryId ? { id: input.libraryId } : {}), server: { userId } },
  };
  if (input.trackIds?.length) {
    const tracks = await prisma.track.findMany({
      where: { AND: [activeScope, { id: { in: input.trackIds } }] },
      select: { id: true },
    });
    return tracks.map((track) => track.id);
  }

  const resolved = await resolveLibraryHealthTrackIds(userId, {
    category: input.filter as any,
    libraryId: input.libraryId,
    settings: input.settings,
  });
  return resolved.trackIds;
}

export async function preflightAudioFeatureRetry(userId: string, request: AudioFeatureRetryRequest, settings: EffectiveAudioFeatureSettings): Promise<AudioFeatureRetryResult> {
  const mode = normalizeAudioFeatureRetryMode(request.mode || request.providerMode || null, request.force);
  const filter = isAudioFeatureHealthFilter(request.filter) ? request.filter : "selected_tracks";
  if (!request.trackIds?.length && filter === "selected_tracks") {
    throw new Error("A valid audio-feature health filter or selected track IDs are required");
  }

  const targetTrackIds = await resolveRetryTargetTrackIds(userId, {
    filter: filter as AudioFeatureHealthFilter,
    trackIds: request.trackIds,
    libraryId: request.libraryId,
    settings,
  });
  const tracks = targetTrackIds.length
    ? await prisma.track.findMany({
      where: { id: { in: targetTrackIds } },
      select: retryTrackSelect,
    })
    : [];
  const targetSet = new Set(targetTrackIds);
  const orderedTracks = tracks
    .filter((track) => targetSet.has(track.id))
    .sort((left, right) => targetTrackIds.indexOf(left.id) - targetTrackIds.indexOf(right.id)) as RetryTrack[];
  const skipReasons: Record<string, number> = {};
  const eligibleTrackIds: string[] = [];

  for (const track of orderedTracks) {
    const reason = audioFeatureRetryEligibility(track, { mode, settings });
    if (reason) {
      increment(skipReasons, reason);
    } else {
      eligibleTrackIds.push(track.id);
    }
  }

  const providerMode = audioFeatureRetryProviderMode(settings);
  const analysisScope = String((settings as any).scope || (settings as any).localAudioFeaturesScope || "windows");
  const analysisScopeLabel = audioFeatureAnalysisScopeLabel(analysisScope);
  const matched = targetTrackIds.length;
  const eligible = eligibleTrackIds.length;
  const skipped = Math.max(0, matched - eligible);
  if (skipped > Object.values(skipReasons).reduce((sum, value) => sum + value, 0)) {
    skipReasons.unknown = skipped - Object.values(skipReasons).reduce((sum, value) => sum + value, 0);
  }
  const explanation = buildRetryExplanation({
    retryType: "audio-feature",
    filter,
    matched,
    queued: eligible,
    skipped,
    skipReasons,
    mode,
  });
  const disabledReason = Object.keys(skipReasons).length === 1 && eligible === 0
    ? disabledReasonForSkipReason(Object.keys(skipReasons)[0])
    : null;
  const summary = formatSummary({ filter, mode, providerMode, analysisScopeLabel, matched, eligible, queued: eligible, skipped, skipReasons });
  const expectedAction = expectedActionFor(mode, eligible);

  return {
    filter,
    mode,
    providerMode,
    matched,
    eligible,
    queued: eligible,
    skipped,
    processed: 0,
    failed: 0,
    skipReasons,
    skipReasonLabels: labelsForReasons(skipReasons),
    summary,
    message: summary || explanation.message,
    explanation: explanation.explanation,
    disabledReason,
    canRun: eligible > 0,
    trackIds: eligibleTrackIds,
    analyzer: "Essentia",
    analyzerAvailable: null,
    analysisScope,
    analysisScopeLabel,
    expectedAction,
  };
}

function disabledReasonForSkipReason(reason: string) {
  if (reason === "api_disabled") return "API audio features are disabled.";
  if (reason === "local_disabled" || reason === "local_analysis_disabled") return "Local analysis is disabled. Enable local audio analysis in Settings first.";
  if (reason === "provider_disabled") return "No audio feature providers are enabled.";
  if (reason === "missing_local_file") return "No eligible tracks have local files.";
  if (reason === "already_complete") return "All matching tracks are already complete.";
  if (reason === "already_processing") return "All matching tracks are already queued or processing.";
  if (reason === "too_short") return "All matching tracks are too short for local analysis.";
  return null;
}

export async function runAudioFeatureRetry(userId: string, request: AudioFeatureRetryRequest, settings: EffectiveAudioFeatureSettings): Promise<AudioFeatureRetryResult> {
  const result = await preflightAudioFeatureRetry(userId, request, settings);
  const queueTime = new Date(0);

  for (let offset = 0; offset < result.trackIds.length; offset += 5_000) {
    const chunk = result.trackIds.slice(offset, offset + 5_000);
    await prisma.$transaction([
      prisma.audioFeature.createMany({
        data: chunk.map((trackId) => ({
          trackId,
          audioFeatureStatus: "pending",
          audioFeatureFailureReason: null,
          lastUpdated: queueTime,
        })),
        skipDuplicates: true,
      }),
      prisma.audioFeature.updateMany({
        where: { trackId: { in: chunk } },
        data: {
          audioFeatureStatus: "pending",
          audioFeatureFailureReason: null,
          lastUpdated: queueTime,
          ...(result.mode === "force_local_reprocess"
            ? {
              audioFeatureAnalyzedAt: null,
              audioFeatureAnalysisScope: (settings as any).scope || (settings as any).localAudioFeaturesScope || null,
            }
            : {}),
        },
      }),
    ]);
  }

  await invalidateLibraryHealthCache(userId, { libraryId: request.libraryId, reason: "audio_feature_retry_queued" });

  const completed = {
    ...result,
    processed: result.queued,
    failed: 0,
  };
  const completionSummary = result.queued > 0
    ? (
      result.mode === "local_only" || result.mode === "force_local_reprocess"
        ? `Local audio analysis queued. Matched ${result.matched}, queued ${result.queued}, skipped ${result.skipped}, failed 0.${formatRetrySkipReasons(result.skipReasons) ? ` Skipped: ${formatRetrySkipReasons(result.skipReasons)}.` : ""}`
        : result.summary
    )
    : result.summary;
  const jobId = await safeRecordJobHistory({
    userId,
    type: "audio_features",
    name: result.mode === "local_only" || result.mode === "force_local_reprocess" ? "Local audio analysis retry" : "Audio feature retry",
    status: result.queued > 0 ? "success" : "warning",
    trigger: "retry",
    summary: completionSummary,
    counts: { attempted: result.matched, processed: result.queued, skipped: result.skipped, failed: 0 },
    metadata: {
      retryType: "audio-feature",
      analyzer: result.analyzer,
      analysisScope: result.analysisScope,
      analysisScopeLabel: result.analysisScopeLabel,
      filter: result.filter,
      retryMode: result.mode,
      mode: result.mode,
      providerMode: result.providerMode,
      matched: result.matched,
      eligible: result.eligible,
      queued: result.queued,
      skipped: result.skipped,
      processed: result.queued,
      failed: 0,
      skipReasons: result.skipReasons,
      skipReasonLabels: result.skipReasonLabels,
      expectedAction: result.expectedAction,
      summary: completionSummary,
      disabledReason: result.disabledReason,
      libraryId: request.libraryId || null,
      force: result.mode === "force_local_reprocess",
    },
  });

  console.log(
    `[LibraryHealth] audio-feature retry filter=${result.filter} mode=${result.mode} analyzer=${result.analyzer} scope=${result.analysisScope} providerMode=${result.providerMode} matched=${result.matched} eligible=${result.eligible} queued=${result.queued} skipped=${result.skipped}`,
  );
  if (Object.keys(result.skipReasons).length) {
    console.log(`[LibraryHealth] audio-feature retry skip reasons: ${formatRetrySkipReasons(result.skipReasons)}`);
  }

  return { ...completed, jobId };
}
