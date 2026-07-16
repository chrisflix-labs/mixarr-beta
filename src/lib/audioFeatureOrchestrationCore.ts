export type AudioFeatureProvider = "api" | "local";

export type EffectiveProviderSettings = {
  audioFeatures: { api: boolean; local: boolean; preferLocal: boolean };
  bpm: { api: boolean; local: boolean; preferLocal: boolean };
};

export type ProviderCapability = {
  providerKey: string;
  use: "audioFeatures" | "bpm";
  enabled: boolean;
  usable: boolean;
  reason?: string;
};

export type ProviderDecision = {
  order: AudioFeatureProvider[];
  provider: AudioFeatureProvider | null;
  audioProvider: AudioFeatureProvider | null;
  bpmProvider: AudioFeatureProvider | null;
  apiAvailable: boolean;
  localAvailable: boolean;
  preference: "api_first" | "local_first";
  fallbackUsed: boolean;
  enabled: { api: boolean; local: boolean };
  unusableReasons: string[];
};

export type AudioFeatureBatchResult = {
  attempted: number;
  processed: number;
  skipped: number;
  failed: number;
  eligible?: number;
  remainingEligible?: number;
  [key: string]: unknown;
};

export type AudioFeatureStageResult = AudioFeatureBatchResult & {
  status: "completed" | "skipped" | "warning" | "failed";
  reason:
    | "audio_features_disabled"
    | "no_tracks_require_processing"
    | "no_usable_provider"
    | "audio_feature_processing_failed"
    | "runtime_guard_reached"
    | "processed";
  provider: AudioFeatureProvider | null;
  providers: AudioFeatureProvider[];
  fallbackUsed: boolean;
  tracksDiscovered: number;
  batches: number;
  durationMs: number;
  message: string;
  metadata: Record<string, unknown>;
};

export class AudioFeatureNoProgressError extends Error {
  constructor(provider: AudioFeatureProvider, remainingEligible: number) {
    super(`${provider} audio feature provider made no progress while ${remainingEligible} eligible track(s) remained.`);
    this.name = "AudioFeatureNoProgressError";
  }
}

export function resolveAudioFeatureProviders(input: {
  settings: EffectiveProviderSettings;
  capabilities: ProviderCapability[];
  localInitializationError?: string | null;
}): ProviderDecision {
  const apiEnabled = input.settings.audioFeatures.api || input.settings.bpm.api;
  const localEnabled = input.settings.audioFeatures.local || input.settings.bpm.local;
  const relevantAudioApi = input.capabilities.filter((capability) => capability.enabled && capability.use === "audioFeatures" && input.settings.audioFeatures.api);
  const relevantBpmApi = input.capabilities.filter((capability) => capability.enabled && capability.use === "bpm" && input.settings.bpm.api);
  const audioApiAvailable = relevantAudioApi.some((capability) => capability.usable);
  const bpmApiAvailable = relevantBpmApi.some((capability) => capability.usable);
  const apiAvailable = audioApiAvailable || bpmApiAvailable;
  const localAvailable = localEnabled && !input.localInitializationError;
  const preferLocal = input.settings.audioFeatures.local || input.settings.audioFeatures.api
    ? input.settings.audioFeatures.preferLocal
    : input.settings.bpm.preferLocal;
  const preference = preferLocal ? "local_first" as const : "api_first" as const;
  const ordered = (api: boolean, local: boolean, localFirst: boolean) => localFirst
    ? [local ? "local" as const : null, api ? "api" as const : null].filter((value): value is AudioFeatureProvider => Boolean(value))
    : [api ? "api" as const : null, local ? "local" as const : null].filter((value): value is AudioFeatureProvider => Boolean(value));
  const audioOrder = ordered(audioApiAvailable, input.settings.audioFeatures.local && localAvailable, input.settings.audioFeatures.preferLocal);
  const bpmOrder = ordered(bpmApiAvailable, input.settings.bpm.local && localAvailable, input.settings.bpm.preferLocal);
  const order = Array.from(new Set([...audioOrder, ...bpmOrder]));
  const audioProvider = audioOrder[0] || null;
  const bpmProvider = bpmOrder[0] || null;
  const audioFallback = input.settings.audioFeatures.api && input.settings.audioFeatures.local
    && !input.settings.audioFeatures.preferLocal && !audioApiAvailable && audioProvider === "local";
  const bpmFallback = input.settings.bpm.api && input.settings.bpm.local
    && !input.settings.bpm.preferLocal && !bpmApiAvailable && bpmProvider === "local";
  const relevantApi = [...relevantAudioApi, ...relevantBpmApi];
  const unusableReasons = relevantApi
    .filter((capability) => !capability.usable)
    .map((capability) => `${capability.providerKey}:${capability.reason || "unavailable"}`);
  if (apiEnabled && relevantApi.length === 0) unusableReasons.push("api:no enabled provider configured for the requested use");
  if (localEnabled && input.localInitializationError) unusableReasons.push(`local:${input.localInitializationError}`);

  return {
    order,
    provider: audioProvider || bpmProvider || order[0] || null,
    audioProvider,
    bpmProvider,
    apiAvailable,
    localAvailable,
    preference,
    fallbackUsed: audioFallback || bpmFallback,
    enabled: { api: apiEnabled, local: localEnabled },
    unusableReasons,
  };
}

function emptyCounts(): AudioFeatureBatchResult {
  return { attempted: 0, processed: 0, skipped: 0, failed: 0 };
}

function addCounts(target: AudioFeatureBatchResult, batch: AudioFeatureBatchResult) {
  target.attempted += batch.attempted;
  target.processed += batch.processed;
  target.skipped += batch.skipped;
  target.failed += batch.failed;
}

export async function drainAudioFeatureProvider(input: {
  provider: AudioFeatureProvider;
  runBatch: () => Promise<AudioFeatureBatchResult>;
  shouldContinue?: () => boolean;
}) {
  const counts = emptyCounts();
  let batches = 0;
  let discovered = 0;
  while (input.shouldContinue?.() !== false) {
    const batch = await input.runBatch();
    batches += 1;
    discovered = Math.max(discovered, Number(batch.eligible || 0));
    const remaining = Number(batch.remainingEligible ?? batch.eligible ?? 0);
    if (batch.attempted === 0) {
      if (remaining > 0) throw new AudioFeatureNoProgressError(input.provider, remaining);
      return { counts, batches, discovered, drained: true };
    }
    addCounts(counts, batch);
    if (batch.processed + batch.skipped + batch.failed === 0) {
      throw new AudioFeatureNoProgressError(input.provider, Math.max(remaining, batch.attempted));
    }
  }
  return { counts, batches, discovered, drained: false };
}

export async function runAudioFeatureOrchestration(input: {
  source: string;
  settingsSource: string;
  settings: EffectiveProviderSettings;
  capabilities: ProviderCapability[];
  localInitializationError?: string | null;
  runApiBatch: () => Promise<AudioFeatureBatchResult>;
  runLocalBatch: () => Promise<AudioFeatureBatchResult>;
  shouldContinue?: () => boolean;
  debug?: (message: string) => void;
}): Promise<AudioFeatureStageResult> {
  const startedAt = Date.now();
  const decision = resolveAudioFeatureProviders(input);
  input.debug?.(
    `[AudioFeatureEngine] Provider resolved source=${input.source} settingsSource=${input.settingsSource} `
    + `audio=${decision.audioProvider || "none"} bpm=${decision.bpmProvider || "none"} apiAvailable=${decision.apiAvailable} `
    + `localAvailable=${decision.localAvailable} preference=${decision.preference} fallbackUsed=${decision.fallbackUsed}`,
  );
  const base = {
    ...emptyCounts(),
    provider: decision.provider,
    providers: decision.order,
    fallbackUsed: decision.fallbackUsed,
    tracksDiscovered: 0,
    batches: 0,
    durationMs: 0,
    metadata: {
      source: input.source,
      settingsSource: input.settingsSource,
      providerDecision: decision,
    },
  };

  if (!decision.enabled.api && !decision.enabled.local) {
    return {
      ...base,
      status: "skipped",
      reason: "audio_features_disabled",
      durationMs: Date.now() - startedAt,
      message: "Audio Features and BPM processing are disabled by saved settings.",
    };
  }
  if (decision.order.length === 0) {
    return {
      ...base,
      status: "warning",
      reason: "no_usable_provider",
      durationMs: Date.now() - startedAt,
      message: `Audio Features processing is enabled but no usable provider could be initialized (${decision.unusableReasons.join("; ") || "provider unavailable"}).`,
    };
  }

  const totals = emptyCounts();
  let batches = 0;
  let tracksDiscovered = 0;
  try {
    for (const provider of decision.order) {
      const drained = await drainAudioFeatureProvider({
        provider,
        runBatch: provider === "api" ? input.runApiBatch : input.runLocalBatch,
        shouldContinue: input.shouldContinue,
      });
      addCounts(totals, drained.counts);
      batches += drained.batches;
      tracksDiscovered = Math.max(tracksDiscovered, drained.discovered);
      if (!drained.drained) {
        return {
          ...base,
          ...totals,
          batches,
          tracksDiscovered,
          status: "warning",
          reason: "runtime_guard_reached",
          durationMs: Date.now() - startedAt,
          message: "Audio Features processing stopped at the configured runtime or cancellation guard.",
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      ...totals,
      batches,
      tracksDiscovered,
      status: "failed",
      reason: "audio_feature_processing_failed",
      durationMs: Date.now() - startedAt,
      message: `Audio Features processing failed: ${message}`,
      metadata: { ...base.metadata, error: message },
    };
  }

  const noWork = totals.attempted === 0;
  return {
    ...base,
    ...totals,
    batches,
    tracksDiscovered,
    status: totals.failed > 0 ? "warning" : "completed",
    reason: noWork ? "no_tracks_require_processing" : "processed",
    durationMs: Date.now() - startedAt,
    message: noWork
      ? "Audio Features completed with no eligible tracks."
      : totals.failed > 0
        ? `Audio Features completed with warnings. attempted=${totals.attempted}, processed=${totals.processed}, skipped=${totals.skipped}, failed=${totals.failed}. Failed tracks remain retry-eligible.`
        : `Audio Features completed. attempted=${totals.attempted}, processed=${totals.processed}, skipped=${totals.skipped}, failed=${totals.failed}.`,
  };
}
