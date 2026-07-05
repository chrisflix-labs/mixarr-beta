import type { Prisma } from "@prisma/client";

export const bpmAnalysisStatuses = ["success", "no_data", "failed", "extraction_failed", "analyzer_failed", "too_short"] as const;
export type BpmAnalysisStatus = typeof bpmAnalysisStatuses[number];
export type BpmRetryProviderMode = "configured" | "api_only" | "local_only" | "force_local";
export const bpmBackfillFilters = ["missing_bpm", "api_bpm", "imported_legacy_bpm", "all_active", "failed", "tracks_with_bpm", "local_bpm"] as const;
export type BpmBackfillFilter = typeof bpmBackfillFilters[number];
export type BpmSourceType = "api_bpm" | "local_bpm" | "imported_bpm";

export type TrackWithBpmSources = {
  bpm?: unknown;
  apiBpm?: unknown;
  localBpm?: unknown;
  effectiveBpm?: unknown;
  bpmSource?: unknown;
  bpmAnalysisStatus?: unknown;
  bpmAnalyzedAt?: unknown;
  tempo?: unknown;
  analyzedBpm?: unknown;
  audioFeature?: {
    bpm?: unknown;
    tempo?: unknown;
    tempoSource?: unknown;
  } | null;
  audioFeatures?: {
    bpm?: unknown;
    tempo?: unknown;
    tempoSource?: unknown;
  } | null;
  analysis?: {
    bpm?: unknown;
    tempo?: unknown;
  } | null;
};

export function getValidBpm(value: unknown) {
  const bpm = Number(value);
  return Number.isFinite(bpm) && bpm > 0 ? bpm : null;
}

function isLocalBpmSource(source: unknown) {
  const normalized = String(source || "").trim().toLowerCase();
  return normalized === "local_essentia"
    || normalized === "essentia"
    || normalized.startsWith("essentia");
}

function isApiBpmSource(source: unknown) {
  const normalized = String(source || "").trim().toLowerCase();
  return normalized === "api" || normalized === "deezer";
}

function isAubioBpmSource(source: unknown) {
  const normalized = String(source || "").trim().toLowerCase();
  return normalized === "aubio" || normalized.startsWith("aubio");
}

export function getEffectiveBpm(track: TrackWithBpmSources) {
  const candidates = [
    track.effectiveBpm,
    track.bpm,
    track.apiBpm,
    track.localBpm,
    track.audioFeatures?.bpm,
    track.audioFeatures?.tempo,
    track.audioFeature?.bpm,
    track.audioFeature?.tempo,
    track.analysis?.bpm,
    track.analysis?.tempo,
    track.analyzedBpm,
    track.tempo,
  ];

  for (const candidate of candidates) {
    const bpm = getValidBpm(candidate);
    if (bpm !== null) return bpm;
  }

  return null;
}

export function hasEffectiveBpm(track: TrackWithBpmSources) {
  return getEffectiveBpm(track) !== null;
}

export function hasLocalEssentiaBpmSuccess(track: TrackWithBpmSources) {
  const hasAubioTempo = isAubioBpmSource(track.audioFeature?.tempoSource)
    || isAubioBpmSource(track.audioFeatures?.tempoSource);
  return (getValidBpm(track.localBpm) !== null && !hasAubioTempo)
    || (
      track.bpmAnalysisStatus === "success"
      && isLocalBpmSource(track.bpmSource)
    )
    || (
      getValidBpm(track.audioFeature?.tempo) !== null
      && isLocalBpmSource(track.audioFeature?.tempoSource)
    )
    || (
      getValidBpm(track.audioFeatures?.tempo) !== null
      && isLocalBpmSource(track.audioFeatures?.tempoSource)
    );
}

export function classifyBpmSource(track: TrackWithBpmSources): BpmSourceType | "missing_bpm" {
  if (getEffectiveBpm(track) === null) return "missing_bpm";
  if (hasLocalEssentiaBpmSuccess(track)) return "local_bpm";
  if (getValidBpm(track.apiBpm) !== null || isApiBpmSource(track.bpmSource)) return "api_bpm";
  return "imported_bpm";
}

export function effectiveBpmTrackWhere(
  condition: Prisma.FloatNullableFilter<"AudioFeature"> | number = { gt: 0 },
): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpm: condition as Prisma.FloatNullableFilter<"Track"> | number },
      { effectiveBpm: condition as Prisma.FloatNullableFilter<"Track"> | number },
      { apiBpm: condition as Prisma.FloatNullableFilter<"Track"> | number },
      { localBpm: condition as Prisma.FloatNullableFilter<"Track"> | number },
      {
        AND: [
          {
            OR: [
              { bpm: null },
              { bpm: { lte: 0 } },
            ],
          },
          {
            audioFeature: {
              is: {
                tempo: condition,
              },
            },
          },
        ],
      },
    ],
  };
}

export function missingEffectiveBpmTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      {
        OR: [
          { bpm: null },
          { bpm: { lte: 0 } },
        ],
      },
      {
        OR: [
          { effectiveBpm: null },
          { effectiveBpm: { lte: 0 } },
        ],
      },
      {
        OR: [
          { apiBpm: null },
          { apiBpm: { lte: 0 } },
        ],
      },
      {
        OR: [
          { localBpm: null },
          { localBpm: { lte: 0 } },
        ],
      },
      {
        OR: [
          { audioFeature: null },
          {
            audioFeature: {
              is: {
                OR: [
                  { tempo: null },
                  { tempo: { lte: 0 } },
                ],
              },
            },
          },
        ],
      },
    ],
  };
}

function localBpmSuccessSourceWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { localBpm: { gt: 0 } },
      { bpmSource: { in: ["local_essentia", "essentia", "aubio"] } },
      {
        AND: [
          { bpmAnalysisStatus: "success" },
          { bpmSource: { in: ["local_essentia", "essentia", "aubio"] } },
        ],
      },
      {
        audioFeature: {
          is: {
            OR: [
              {
                AND: [
                  { tempo: { gt: 0 } },
                  { tempoSource: { startsWith: "Essentia" } },
                ],
              },
              {
                AND: [
                  { tempo: { gt: 0 } },
                  { tempoSource: { startsWith: "Aubio" } },
                ],
              },
            ],
          },
        },
      },
    ],
  };
}

function apiBpmSourceWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      effectiveBpmTrackWhere(),
      { NOT: localBpmSuccessSourceWhere() },
      {
        OR: [
          { apiBpm: { gt: 0 } },
          { bpmSource: { in: ["api", "deezer"] } },
        ],
      },
    ],
  };
}

function importedBpmSourceWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      effectiveBpmTrackWhere(),
      { NOT: localBpmSuccessSourceWhere() },
      { NOT: apiBpmSourceWhere() },
    ],
  };
}

export function buildBpmSourceWhereClause(sourceType: BpmSourceType): Prisma.TrackWhereInput {
  switch (sourceType) {
    case "api_bpm":
      return apiBpmSourceWhere();
    case "local_bpm":
      return {
        AND: [
          effectiveBpmTrackWhere(),
          localBpmSuccessSourceWhere(),
        ],
      };
    case "imported_bpm":
      return importedBpmSourceWhere();
  }
}

export function localBpmSourceTrackWhere(): Prisma.TrackWhereInput {
  return buildBpmSourceWhereClause("local_bpm");
}

export function localEssentiaBpmSuccessTrackWhere(): Prisma.TrackWhereInput {
  return localBpmSourceTrackWhere();
}

export function apiBpmTrackWhere(): Prisma.TrackWhereInput {
  return buildBpmSourceWhereClause("api_bpm");
}

export function importedBpmTrackWhere(): Prisma.TrackWhereInput {
  return buildBpmSourceWhereClause("imported_bpm");
}

export function bpmAnalysisAttemptedTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpmAnalyzedAt: { not: null } },
      { bpmAnalysisStatus: { in: [...bpmAnalysisStatuses] } },
      localBpmSourceTrackWhere(),
    ],
  };
}

export function bpmNoDataMarkerTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpmAnalysisStatus: "no_data" },
      {
        audioFeature: {
          is: {
            tempoSource: "local_not_found",
          },
        },
      },
    ],
  };
}

export function bpmFailedMarkerTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpmAnalysisStatus: "failed" },
      {
        audioFeature: {
          is: {
            tempoSource: "local_failed",
          },
        },
      },
    ],
  };
}

export function bpmExtractionFailedMarkerTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpmAnalysisStatus: "extraction_failed" },
      {
        audioFeature: {
          is: {
            tempoSource: "local_extraction_failed",
          },
        },
      },
    ],
  };
}

export function bpmAnalyzerFailedMarkerTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpmAnalysisStatus: "analyzer_failed" },
      {
        audioFeature: {
          is: {
            tempoSource: "local_analyzer_failed",
          },
        },
      },
    ],
  };
}

export function bpmTooShortMarkerTrackWhere(): Prisma.TrackWhereInput {
  return {
    OR: [
      { bpmAnalysisStatus: "too_short" },
      {
        audioFeature: {
          is: {
            tempoSource: "local_too_short",
          },
        },
      },
    ],
  };
}

export function bpmNoDataTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      bpmNoDataMarkerTrackWhere(),
    ],
  };
}

export function bpmLegacyFailedTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      bpmFailedMarkerTrackWhere(),
    ],
  };
}

/** All terminal BPM failures. This intentionally includes legacy, extraction,
 * and analyzer failures so the umbrella count cannot disagree with its parts. */
export function bpmFailedTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      {
        OR: [
          bpmFailedMarkerTrackWhere(),
          bpmExtractionFailedMarkerTrackWhere(),
          bpmAnalyzerFailedMarkerTrackWhere(),
        ],
      },
    ],
  };
}

export function bpmExtractionFailedTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      bpmExtractionFailedMarkerTrackWhere(),
    ],
  };
}

export function bpmAnalyzerFailedTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      bpmAnalyzerFailedMarkerTrackWhere(),
    ],
  };
}

export function bpmTooShortTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      bpmTooShortMarkerTrackWhere(),
    ],
  };
}

export function noEffectiveBpmTrackWhere(): Prisma.TrackWhereInput {
  return missingEffectiveBpmTrackWhere();
}

export function pendingBpmBackfillTrackWhere(): Prisma.TrackWhereInput {
  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      {
        OR: [
          { bpmAnalysisStatus: null },
          { bpmAnalysisStatus: { notIn: [...bpmAnalysisStatuses] } },
        ],
      },
      { NOT: bpmNoDataMarkerTrackWhere() },
      { NOT: bpmFailedMarkerTrackWhere() },
      { NOT: bpmExtractionFailedMarkerTrackWhere() },
      { NOT: bpmAnalyzerFailedMarkerTrackWhere() },
      { NOT: bpmTooShortMarkerTrackWhere() },
    ],
  };
}

export function normalizeBpmBackfillFilter(value: unknown, options: { force?: boolean } = {}): BpmBackfillFilter {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "api_bpm") return "api_bpm";
  if (normalized === "imported_bpm" || normalized === "imported_legacy_bpm") return "imported_legacy_bpm";
  if (normalized === "tracks_with_bpm") return "tracks_with_bpm";
  if (normalized === "local_bpm") return "local_bpm";
  if (normalized === "all_active") return "all_active";
  if (
    normalized === "failed"
    || normalized === "bpm_failed"
    || normalized === "bpm_no_data"
    || normalized === "extraction_failed"
    || normalized === "analyzer_failed"
    || normalized === "too_short"
  ) return "failed";
  if (options.force && !normalized) return "all_active";
  return "missing_bpm";
}

export function bpmBackfillFilterTrackWhere(filter: BpmBackfillFilter): Prisma.TrackWhereInput {
  switch (filter) {
    case "api_bpm":
      return apiBpmTrackWhere();
    case "imported_legacy_bpm":
      return importedBpmTrackWhere();
    case "all_active":
      return {};
    case "tracks_with_bpm":
      return effectiveBpmTrackWhere();
    case "local_bpm":
      return localBpmSourceTrackWhere();
    case "failed":
      return {
        OR: [
          bpmNoDataMarkerTrackWhere(),
          bpmFailedMarkerTrackWhere(),
          bpmExtractionFailedMarkerTrackWhere(),
          bpmAnalyzerFailedMarkerTrackWhere(),
          bpmTooShortMarkerTrackWhere(),
        ],
      };
    case "missing_bpm":
      return missingEffectiveBpmTrackWhere();
  }
}

export function bpmBackfillCandidateTrackWhere(options: {
  retryNoDataFailed?: boolean;
  includeAubioReprocess?: boolean;
  reprocessApiWithLocal?: boolean;
  filter?: unknown;
  force?: boolean;
} = {}): Prisma.TrackWhereInput {
  const filter = normalizeBpmBackfillFilter(options.filter, { force: options.force });
  const explicitFilteredReprocess = filter !== "missing_bpm" || !!options.force;
  if (explicitFilteredReprocess) {
    return bpmBackfillFilterTrackWhere(filter);
  }

  const missingBpmWhere: Prisma.TrackWhereInput = options.retryNoDataFailed
    ? missingEffectiveBpmTrackWhere()
    : pendingBpmBackfillTrackWhere();

  const candidateBranches: Prisma.TrackWhereInput[] = [missingBpmWhere];

  if (options.includeAubioReprocess) {
    candidateBranches.push({
      audioFeature: {
        is: {
          tempo: { not: null },
          tempoSource: { startsWith: "Aubio" },
        },
      },
    });
  }

  if (options.reprocessApiWithLocal) {
    candidateBranches.push({
      AND: [
        { NOT: localEssentiaBpmSuccessTrackWhere() },
        {
          OR: [
            apiBpmTrackWhere(),
            importedBpmTrackWhere(),
          ],
        },
      ],
    });
  }

  return candidateBranches.length === 1 ? candidateBranches[0] : { OR: candidateBranches };
}

export function bpmBackfillTrackWhere(options: {
  includeAubioReprocess?: boolean;
  retryNoDataFailed?: boolean;
  reprocessApiWithLocal?: boolean;
  filter?: unknown;
  force?: boolean;
  activeOnly?: boolean;
} = {}): Prisma.TrackWhereInput {
  const eligibility = bpmBackfillCandidateTrackWhere(options);
  return options.activeOnly === false ? eligibility : {
    AND: [
      { syncStatus: "active" },
      eligibility,
    ],
  };
}

export function explainBpmBackfillEligibility(track: TrackWithBpmSources, options: {
  includeAubioReprocess?: boolean;
  retryNoDataFailed?: boolean;
  reprocessApiWithLocal?: boolean;
  filter?: unknown;
  force?: boolean;
} = {}) {
  const effectiveBpm = getEffectiveBpm(track);
  const localSuccess = hasLocalEssentiaBpmSuccess(track);
  const status = String(track.bpmAnalysisStatus || "");
  const attemptedTerminal = bpmAnalysisStatuses.includes(status as BpmAnalysisStatus);
  const missing = effectiveBpm === null;
  const pendingMissing = missing && (status === "" || !attemptedTerminal);
  const retryableMissing = missing && !!options.retryNoDataFailed;
  const aubioReprocess = !!options.includeAubioReprocess
    && getValidBpm(track.audioFeature?.tempo) !== null
    && String(track.audioFeature?.tempoSource || "").startsWith("Aubio");
  const apiOrImportedReprocess = !!options.reprocessApiWithLocal
    && !localSuccess
    && (
      getValidBpm(track.apiBpm) !== null
      || (
        effectiveBpm !== null
        && getValidBpm(track.localBpm) === null
        && !isLocalBpmSource(track.bpmSource)
      )
    );
  const normalizedFilter = normalizeBpmBackfillFilter(options.filter, { force: options.force });
  const classifiedSource = classifyBpmSource(track);
  const failedMarker = ["no_data", "failed", "extraction_failed", "analyzer_failed", "too_short"].includes(status);
  const filterSelected = normalizedFilter === "all_active"
    || (normalizedFilter === "tracks_with_bpm" && effectiveBpm !== null)
    || (normalizedFilter === "local_bpm" && classifiedSource === "local_bpm")
    || (normalizedFilter === "missing_bpm" && missing)
    || (normalizedFilter === "api_bpm" && classifiedSource === "api_bpm")
    || (normalizedFilter === "imported_legacy_bpm" && classifiedSource === "imported_bpm")
    || (normalizedFilter === "failed" && failedMarker);
  const filteredReprocess = (normalizedFilter !== "missing_bpm" || !!options.force)
    && filterSelected;
  const selected = filteredReprocess || retryableMissing || pendingMissing || aubioReprocess || apiOrImportedReprocess;
  const reasons = [
    filteredReprocess ? `${normalizedFilter}${options.force ? "_force" : "_local_reprocess"}` : null,
    retryableMissing ? "missing_effective_bpm_retry" : null,
    pendingMissing ? "missing_effective_bpm_pending" : null,
    aubioReprocess ? "aubio_reprocess_without_local_success" : null,
    apiOrImportedReprocess ? "api_or_imported_reprocess_without_local_success" : null,
  ].filter(Boolean);

  return {
    bpm: getValidBpm(track.bpm),
    localBpm: getValidBpm(track.localBpm),
    apiBpm: getValidBpm(track.apiBpm),
    bpmSource: typeof track.bpmSource === "string" ? track.bpmSource : null,
    bpmAnalysisStatus: typeof track.bpmAnalysisStatus === "string" ? track.bpmAnalysisStatus : null,
    audioFeatureTempo: getValidBpm(track.audioFeature?.tempo),
    audioFeatureTempoSource: typeof track.audioFeature?.tempoSource === "string" ? track.audioFeature.tempoSource : null,
    effectiveBpm,
    localEssentiaSuccess: localSuccess,
    selected,
    reason: reasons.join(",") || "not_eligible",
  };
}

export function bpmRetryEligibilityTrackWhere(options: {
  force?: boolean;
  providerMode?: BpmRetryProviderMode;
  filter?: unknown;
} = {}): Prisma.TrackWhereInput {
  if (options.force || options.providerMode === "force_local") return {};

  const filter = normalizeBpmBackfillFilter(options.filter);
  if (options.providerMode === "local_only" && filter !== "missing_bpm") {
    return {};
  }

  return {
    AND: [
      missingEffectiveBpmTrackWhere(),
      { NOT: localEssentiaBpmSuccessTrackWhere() },
      { NOT: bpmTooShortTrackWhere() },
    ],
  };
}
