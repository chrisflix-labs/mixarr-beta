import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { preflightAudioFeatureRetry, type AudioFeatureRetryMode } from "./audioFeatureRetry";
import {
  buildBpmRetryBaseWhere,
  buildBpmRetryCandidateWhere,
  getAudioFeatureHealthSummary,
  getBpmHealthSummary,
  getGenreHealthSummary,
  getPopularityHealthSummary,
  invalidateLibraryHealthCache,
  isAudioFeatureHealthFilter,
  type AudioFeatureHealthFilter,
  type BpmHealthFilter,
  type GenreHealthFilter,
  type PopularityHealthFilter,
} from "./libraryHealth";
import { getLibraryHealthDetailSummary, resolveLibraryHealthTrackIds } from "./libraryHealthDetails";
import { safeRecordJobHistory } from "./jobHistory";
import { buildRetryExplanation, formatRetrySkipReasons } from "./retryExplanations";
import { getEnrichmentJobStatuses } from "./enrichmentJobStatus";
import { assertEssentiaAvailable } from "./localBpmEngine";
import {
  getUserSyncSettings,
  metadataProviderModeLabel,
  resolveMetadataProviderSettings,
  type SyncEngineOptions,
} from "./syncSettings";

export type DataEnrichmentAction =
  | "sync_bpm"
  | "retry_missing_bpm"
  | "force_local_bpm_reprocess"
  | "sync_audio_features"
  | "retry_partial_audio_features"
  | "retry_pending_audio_features"
  | "run_local_analysis"
  | "force_local_audio_reprocess"
  | "sync_genres"
  | "retry_missing_genres"
  | "sync_popularity"
  | "retry_missing_popularity";

export type DataEnrichmentPreflight = {
  action: DataEnrichmentAction;
  title: string;
  enrichmentType: "bpm" | "audio_features" | "genres" | "popularity" | "local_audio_analysis";
  filter: string;
  matched: number;
  eligible: number;
  queued: number;
  skipped: number;
  skipReasons: Record<string, number>;
  skipReasonLabels?: Record<string, string>;
  providerMode: string;
  estimatedAction: string;
  canRun: boolean;
  disabledReason: string | null;
  summary: string;
  trackIds?: string[];
  mode?: string;
  advanced?: boolean;
};

type ActionConfig = {
  title: string;
  enrichmentType: DataEnrichmentPreflight["enrichmentType"];
  filter: string;
  mode?: AudioFeatureRetryMode | "configured" | "force_local";
  advanced?: boolean;
  estimatedAction: string;
};

export const dataEnrichmentActionConfigs: Record<DataEnrichmentAction, ActionConfig> = {
  sync_bpm: {
    title: "BPM sync preflight",
    enrichmentType: "bpm",
    filter: "missing_bpm",
    mode: "configured",
    estimatedAction: "Queue eligible tracks for BPM enrichment using the configured BPM providers.",
  },
  retry_missing_bpm: {
    title: "Missing BPM retry preflight",
    enrichmentType: "bpm",
    filter: "missing_bpm",
    mode: "configured",
    estimatedAction: "Retry tracks that Library Health classifies as Missing BPM.",
  },
  force_local_bpm_reprocess: {
    title: "Force local BPM reprocess preflight",
    enrichmentType: "bpm",
    filter: "api_bpm",
    mode: "force_local",
    advanced: true,
    estimatedAction: "Recalculate local BPM for API BPM tracks using local analysis, even when BPM already exists.",
  },
  sync_audio_features: {
    title: "Audio feature sync preflight",
    enrichmentType: "audio_features",
    filter: "missing_audio_features",
    mode: "configured_providers",
    estimatedAction: "Queue eligible tracks for audio-feature enrichment using configured providers.",
  },
  retry_partial_audio_features: {
    title: "Audio feature retry preflight",
    enrichmentType: "audio_features",
    filter: "partial_audio_features",
    mode: "configured_providers",
    estimatedAction: "Retry tracks that Library Health classifies as Partial Audio Features.",
  },
  retry_pending_audio_features: {
    title: "Pending audio feature retry preflight",
    enrichmentType: "audio_features",
    filter: "pending_audio_features",
    mode: "configured_providers",
    estimatedAction: "Retry tracks that Library Health classifies as Pending Audio Features.",
  },
  run_local_analysis: {
    title: "Local audio analysis preflight",
    enrichmentType: "local_audio_analysis",
    filter: "partial_audio_features",
    mode: "local_only",
    advanced: true,
    estimatedAction: "Analyze eligible local files with Essentia.",
  },
  force_local_audio_reprocess: {
    title: "Force local audio reprocess preflight",
    enrichmentType: "local_audio_analysis",
    filter: "complete_audio_features",
    mode: "force_local_reprocess",
    advanced: true,
    estimatedAction: "Force local Essentia reprocess for matching tracks even when audio features already exist.",
  },
  sync_genres: {
    title: "Genre sync preflight",
    enrichmentType: "genres",
    filter: "missing_genres",
    estimatedAction: "Queue missing genre metadata for provider backfill.",
  },
  retry_missing_genres: {
    title: "Missing genres retry preflight",
    enrichmentType: "genres",
    filter: "missing_genres",
    estimatedAction: "Retry tracks that Library Health classifies as Missing Genres.",
  },
  sync_popularity: {
    title: "Popularity sync preflight",
    enrichmentType: "popularity",
    filter: "missing_popularity",
    estimatedAction: "Queue missing popularity metadata for provider backfill.",
  },
  retry_missing_popularity: {
    title: "Missing popularity retry preflight",
    enrichmentType: "popularity",
    filter: "missing_popularity",
    estimatedAction: "Retry tracks that Library Health classifies as Missing Popularity.",
  },
};

export function formatDataEnrichmentModeLabel(label: string, prefix?: string) {
  return prefix ? `${prefix}: ${label}` : label;
}

export function formatPreferLocalLabel(value: boolean) {
  return `Prefer local values: ${value ? "Enabled" : "Disabled"}`;
}

export function formatProviderEnabledLabel(label: string, value: boolean) {
  return `${label}: ${value ? "Enabled" : "Disabled"}`;
}

export function formatPreflightSummary(input: Pick<DataEnrichmentPreflight, "matched" | "eligible" | "skipped" | "providerMode" | "estimatedAction" | "skipReasons">) {
  if (input.matched === 0) return "No matching tracks need this enrichment action.";
  const skipped = formatRetrySkipReasons(input.skipReasons);
  if (input.eligible === 0) {
    return skipped
      ? `Matched ${input.matched.toLocaleString()} tracks, but none are eligible. Skipped: ${skipped}.`
      : `Matched ${input.matched.toLocaleString()} tracks, but none are eligible.`;
  }
  return [
    `Matched ${input.matched.toLocaleString()} track${input.matched === 1 ? "" : "s"}.`,
    `Eligible ${input.eligible.toLocaleString()}.`,
    `Skipped ${input.skipped.toLocaleString()}.`,
    `Mode: ${input.providerMode}.`,
    input.estimatedAction,
  ].join(" ");
}

function activeUserTrackWhere(userId: string, libraryId?: string): Prisma.TrackWhereInput {
  return {
    syncStatus: "active",
    library: { ...(libraryId ? { id: libraryId } : {}), server: { userId } },
  };
}

async function resolveTrackIds(userId: string, filter: string, libraryId: string | undefined, settings?: ReturnType<typeof resolveMetadataProviderSettings>["audioFeatures"]) {
  const resolved = await resolveLibraryHealthTrackIds(userId, {
    category: filter as any,
    libraryId,
    settings,
  });
  return resolved.trackIds;
}

function countReasons(total: number, reason: string) {
  return total > 0 ? { [reason]: total } : {};
}

function labelsForReasons(reasons: Record<string, number>) {
  return Object.fromEntries(Object.keys(reasons).map((reason) => [reason, reason.replace(/_/g, " ")]));
}

async function preflightBpm(userId: string, config: ActionConfig, libraryId: string | undefined, settings: ReturnType<typeof resolveMetadataProviderSettings>["bpm"]): Promise<DataEnrichmentPreflight> {
  const providerMode = config.mode === "force_local" ? "force_local" : "configured";
  const matchedWhere = buildBpmRetryBaseWhere(userId, { filter: config.filter as BpmHealthFilter, libraryId });
  const candidateWhere = buildBpmRetryCandidateWhere(userId, {
    filter: config.filter as BpmHealthFilter,
    libraryId,
    providerMode,
    force: config.mode === "force_local",
  });
  const [matched, tracks] = await Promise.all([
    prisma.track.count({ where: matchedWhere }),
    prisma.track.findMany({ where: candidateWhere, select: { id: true } }),
  ]);
  const trackIds = tracks.map((track) => track.id);
  const disabledReason = !settings.api && !settings.local
    ? "No BPM providers are enabled."
    : config.mode === "force_local" && !settings.local
      ? "Local BPM analysis is disabled. Enable local BPM in Settings first."
      : null;
  const eligible = disabledReason ? 0 : trackIds.length;
  const skipped = Math.max(0, matched - eligible);
  const skipReasons = disabledReason
    ? countReasons(matched, settings.local ? "provider_disabled" : "local_disabled")
    : countReasons(skipped, "not_eligible_for_selected_mode");
  const providerModeLabel = metadataProviderModeLabel(settings);

  return {
    action: "" as DataEnrichmentAction,
    title: config.title,
    enrichmentType: config.enrichmentType,
    filter: config.filter,
    matched,
    eligible,
    queued: eligible,
    skipped,
    skipReasons,
    skipReasonLabels: labelsForReasons(skipReasons),
    providerMode: providerModeLabel,
    estimatedAction: config.estimatedAction,
    canRun: eligible > 0,
    disabledReason,
    summary: formatPreflightSummary({ matched, eligible, skipped, providerMode: providerModeLabel, estimatedAction: config.estimatedAction, skipReasons }),
    trackIds: disabledReason ? [] : trackIds,
    mode: providerMode,
    advanced: config.advanced,
  };
}

async function preflightMetadata(userId: string, config: ActionConfig, libraryId: string | undefined): Promise<DataEnrichmentPreflight> {
  const trackIds = await resolveTrackIds(userId, config.filter, libraryId);
  const active = activeUserTrackWhere(userId, libraryId);
  const tracks = trackIds.length
    ? await prisma.track.findMany({
      where: { AND: [active, { id: { in: trackIds } }] },
      select: { id: true, title: true, artist: { select: { title: true } } },
    })
    : [];
  const matched = trackIds.length;
  const eligible = tracks.length;
  const skipped = Math.max(0, matched - eligible);
  const skipReasons = countReasons(skipped, "not_active");
  const providerMode = "API/imported provider metadata";

  return {
    action: "" as DataEnrichmentAction,
    title: config.title,
    enrichmentType: config.enrichmentType,
    filter: config.filter,
    matched,
    eligible,
    queued: eligible,
    skipped,
    skipReasons,
    skipReasonLabels: labelsForReasons(skipReasons),
    providerMode,
    estimatedAction: config.estimatedAction,
    canRun: eligible > 0,
    disabledReason: null,
    summary: formatPreflightSummary({ matched, eligible, skipped, providerMode, estimatedAction: config.estimatedAction, skipReasons }),
    trackIds: tracks.map((track) => track.id),
    advanced: config.advanced,
  };
}

export async function preflightDataEnrichmentAction(userId: string, action: DataEnrichmentAction, options: { libraryId?: string } = {}): Promise<DataEnrichmentPreflight> {
  const config = dataEnrichmentActionConfigs[action];
  const syncSettings = resolveMetadataProviderSettings(await getUserSyncSettings(userId));
  let result: DataEnrichmentPreflight;

  if (config.enrichmentType === "audio_features" || config.enrichmentType === "local_audio_analysis") {
    const resolvedTrackIds = isAudioFeatureHealthFilter(config.filter)
      ? undefined
      : await resolveTrackIds(userId, config.filter, options.libraryId, syncSettings.audioFeatures);
    const audio = await preflightAudioFeatureRetry(userId, {
      filter: resolvedTrackIds ? undefined : config.filter,
      trackIds: resolvedTrackIds,
      mode: config.mode,
      providerMode: config.mode,
      libraryId: options.libraryId,
      force: config.mode === "force_local_reprocess",
    }, syncSettings.audioFeatures);
    result = {
      action,
      title: config.title,
      enrichmentType: config.enrichmentType,
      filter: config.filter,
      matched: audio.matched,
      eligible: audio.eligible,
      queued: audio.queued,
      skipped: audio.skipped,
      skipReasons: audio.skipReasons,
      skipReasonLabels: audio.skipReasonLabels,
      providerMode: metadataProviderModeLabel(syncSettings.audioFeatures),
      estimatedAction: config.estimatedAction,
      canRun: audio.canRun,
      disabledReason: audio.disabledReason,
      summary: formatPreflightSummary({
        matched: audio.matched,
        eligible: audio.eligible,
        skipped: audio.skipped,
        providerMode: metadataProviderModeLabel(syncSettings.audioFeatures),
        estimatedAction: config.estimatedAction,
        skipReasons: audio.skipReasons,
      }),
      trackIds: audio.trackIds,
      mode: audio.mode,
      advanced: config.advanced,
    };
  } else if (config.enrichmentType === "bpm") {
    result = await preflightBpm(userId, config, options.libraryId, syncSettings.bpm);
    result.action = action;
  } else {
    result = await preflightMetadata(userId, config, options.libraryId);
    result.action = action;
  }

  return result;
}

async function lastJob(userId: string, where: Prisma.JobHistoryWhereInput) {
  const job = await prisma.jobHistory.findFirst({
    where: {
      AND: [
        { OR: [{ userId }, { userId: null }] },
        where,
      ],
    },
    orderBy: { startedAt: "desc" },
  });
  if (!job) return null;
  return {
    name: job.name,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.durationMs,
    processed: job.processed ?? 0,
    skipped: job.skipped ?? 0,
    failed: job.failed ?? 0,
    summary: job.summary,
    metadata: job.metadata,
  };
}

export async function getDataEnrichmentSummary(userId: string, libraryId?: string) {
  const rawSettings = await getUserSyncSettings(userId);
  const settings = resolveMetadataProviderSettings(rawSettings);
  const [health, bpm, audio, genres, popularity, libraries, localStatus, lastRuns] = await Promise.all([
    getLibraryHealthDetailSummary(userId, libraryId, settings.audioFeatures),
    getBpmHealthSummary(userId, libraryId),
    getAudioFeatureHealthSummary(userId, libraryId, settings.audioFeatures),
    getGenreHealthSummary(userId, libraryId),
    getPopularityHealthSummary(userId, libraryId),
    prisma.library.findMany({
      where: { type: "artist", server: { userId } },
      select: { id: true, name: true, server: { select: { id: true, name: true } } },
      orderBy: [{ server: { name: "asc" } }, { name: "asc" }],
    }),
    getLocalAnalyzerStatus(settings.audioFeatures),
    Promise.all([
      lastJob(userId, { type: { in: ["bpm"] } }),
      lastJob(userId, { type: { in: ["audio_features"] } }),
      lastJob(userId, { OR: [{ type: "tags" }, { name: { contains: "Genre", mode: "insensitive" } }] }),
      lastJob(userId, { OR: [{ type: "popularity" }, { name: { contains: "Popularity", mode: "insensitive" } }] }),
    ]),
  ]);
  const jobs = getEnrichmentJobStatuses();

  return {
    totalTracks: health.totalTracks,
    libraries,
    providerModes: {
      bpm: metadataProviderModeLabel(settings.bpm),
      audioFeatures: metadataProviderModeLabel(settings.audioFeatures),
      preferLocalBpm: formatPreferLocalLabel(settings.bpm.preferLocal),
      preferLocalAudioFeatures: formatPreferLocalLabel(settings.audioFeatures.preferLocal),
      apiBpm: formatProviderEnabledLabel("API BPM", settings.bpm.api),
      localBpm: formatProviderEnabledLabel("Local BPM", settings.bpm.local),
      apiAudioFeatures: formatProviderEnabledLabel("API enrichment", settings.audioFeatures.api),
      localAudioFeatures: formatProviderEnabledLabel("Local Essentia", settings.audioFeatures.local),
    },
    bpm,
    audioFeatures: {
      ...audio,
      complete: health.categories.complete_audio_features,
      partial: health.categories.partial_audio_features,
      missing: health.categories.missing_audio_features,
      pending: health.categories.pending_audio_features,
      failed: health.categories.failed_audio_feature_analysis,
    },
    genres,
    popularity,
    localAudioAnalysis: {
      enabled: settings.audioFeatures.local,
      analyzer: "Essentia",
      analyzerAvailable: localStatus.analyzerAvailable,
      analyzerError: localStatus.analyzerError,
      scope: settings.audioFeatures.scope,
      scopeLabel: settings.audioFeatures.scope === "whole_track" ? "Whole track" : "Sample window",
      lastDiagnostics: health.diagnostics.localAnalysisDiagnostics || null,
    },
    libraryHealth: {
      categories: health.categories,
      diagnostics: health.diagnostics,
    },
    running: {
      bpm: jobs.bpm || null,
      audioFeatures: jobs.audio || null,
      genres: jobs.tags || null,
      popularity: jobs.popularity || null,
    },
    lastRuns: {
      bpm: lastRuns[0],
      audioFeatures: lastRuns[1],
      genres: lastRuns[2],
      popularity: lastRuns[3],
      localAudioAnalysis: health.diagnostics.localAnalysisDiagnostics || null,
    },
    settings: {
      bpm: settings.bpm,
      audioFeatures: settings.audioFeatures,
      raw: rawSettings,
    },
  };
}

async function getLocalAnalyzerStatus(settings: ReturnType<typeof resolveMetadataProviderSettings>["audioFeatures"]) {
  if (!settings.local) return { analyzerAvailable: false, analyzerError: "Local audio analysis is disabled." };
  try {
    await assertEssentiaAvailable();
    return { analyzerAvailable: true, analyzerError: null };
  } catch (error) {
    return { analyzerAvailable: false, analyzerError: error instanceof Error ? error.message : String(error) };
  }
}

export async function queueMetadataRetry(userId: string, preflight: DataEnrichmentPreflight, libraryId?: string) {
  const now = new Date();
  const ids = preflight.trackIds || [];
  const chunks: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += 5_000) chunks.push(ids.slice(offset, offset + 5_000));

  if (preflight.enrichmentType === "genres") {
    for (const chunk of chunks) {
      await prisma.track.updateMany({
        where: { id: { in: chunk } },
        data: { tagsSyncedAt: null, genreStatus: "pending", genreFailureReason: null, genreAttemptedAt: null },
      });
    }
  }
  if (preflight.enrichmentType === "popularity") {
    for (const chunk of chunks) {
      await prisma.$transaction([
        prisma.popularity.deleteMany({ where: { trackId: { in: chunk } } }),
        prisma.track.updateMany({
          where: { id: { in: chunk } },
          data: { popularityStatus: "pending", popularityFailureReason: null, popularityAttemptedAt: null },
        }),
      ]);
    }
  }

  await invalidateLibraryHealthCache(userId, { libraryId, reason: "data_enrichment_metadata_retry_queued" });
  const retryExplanation = buildRetryExplanation({
    retryType: preflight.enrichmentType === "genres" ? "genre" : "popularity",
    filter: preflight.filter,
    matched: preflight.matched,
    queued: preflight.queued,
    skipped: preflight.skipped,
    skipReasons: preflight.skipReasons,
    mode: "configured",
  });
  await safeRecordJobHistory({
    userId,
    type: preflight.enrichmentType === "genres" ? "tags" : "popularity",
    name: preflight.enrichmentType === "genres" ? "Genre retry" : "Popularity retry",
    status: preflight.queued > 0 ? "success" : "warning",
    trigger: "retry",
    startedAt: now,
    finishedAt: new Date(),
    summary: retryExplanation.message,
    counts: { attempted: preflight.matched, processed: preflight.queued, skipped: preflight.skipped, failed: 0 },
    metadata: {
      source: "data_enrichment",
      enrichmentType: preflight.enrichmentType,
      action: preflight.action,
      filter: preflight.filter,
      providerMode: preflight.providerMode,
      matched: preflight.matched,
      eligible: preflight.eligible,
      queued: preflight.queued,
      processed: preflight.queued,
      skipped: preflight.skipped,
      failed: 0,
      skipReasons: preflight.skipReasons,
      summary: retryExplanation.message,
      libraryId: libraryId || null,
    },
  });
}

export async function queueBpmRetry(userId: string, preflight: DataEnrichmentPreflight, libraryId?: string) {
  const ids = preflight.trackIds || [];
  for (let offset = 0; offset < ids.length; offset += 5_000) {
    const chunk = ids.slice(offset, offset + 5_000);
    await prisma.$transaction([
      prisma.track.updateMany({
        where: { id: { in: chunk } },
        data: { bpmAnalysisStatus: null, bpmFailureReason: null, bpmAnalyzedAt: null },
      }),
      prisma.audioFeature.updateMany({
        where: { trackId: { in: chunk } },
        data: { tempoSource: null, tempoConfidence: null },
      }),
    ]);
  }

  await invalidateLibraryHealthCache(userId, { libraryId, reason: "data_enrichment_bpm_retry_queued" });
  const retryExplanation = buildRetryExplanation({
    retryType: "BPM",
    filter: preflight.filter,
    matched: preflight.matched,
    queued: preflight.queued,
    skipped: preflight.skipped,
    skipReasons: preflight.skipReasons,
    mode: preflight.mode || "configured",
  });
  await safeRecordJobHistory({
    userId,
    type: "bpm",
    name: preflight.advanced ? "BPM local reprocess" : "BPM retry",
    status: preflight.queued > 0 ? "success" : "warning",
    trigger: "retry",
    summary: retryExplanation.message,
    counts: { attempted: preflight.matched, processed: preflight.queued, skipped: preflight.skipped, failed: 0 },
    metadata: {
      source: "data_enrichment",
      enrichmentType: "bpm",
      action: preflight.action,
      filter: preflight.filter,
      providerMode: preflight.providerMode,
      retryMode: preflight.mode || "configured",
      matched: preflight.matched,
      eligible: preflight.eligible,
      queued: preflight.queued,
      processed: preflight.queued,
      skipped: preflight.skipped,
      failed: 0,
      skipReasons: preflight.skipReasons,
      summary: retryExplanation.message,
      libraryId: libraryId || null,
      force: preflight.mode === "force_local",
    },
  });
}
