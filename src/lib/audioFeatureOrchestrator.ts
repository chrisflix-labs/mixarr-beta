import type { SyncEngineOptions } from "./syncSettings";
import {
  runAudioFeatureOrchestration,
  type AudioFeatureStageResult,
  type ProviderCapability,
} from "./audioFeatureOrchestrationCore";
import { logDebug } from "./logging";

export type AudioFeatureExecutionContext = {
  source: "manual" | "nightly" | "retry" | "startup" | "initial";
  userId: string;
  libraryId?: string;
  settingsOverrides?: SyncEngineOptions;
  shouldContinue?: () => boolean;
};

function providerCapabilities(payload: Awaited<ReturnType<typeof import("./externalApiSettings")["getExternalApiRuntimeConfig"]>>) {
  const capabilities: ProviderCapability[] = [];
  for (const provider of payload.providers) {
    for (const use of ["audioFeatures", "bpm"] as const) {
      if (!provider.uses[use]) continue;
      const reason = !provider.enabled
        ? "disabled"
        : !provider.hasCredentials
          ? "missing credentials"
          : provider.lastTestStatus === "failed"
            ? "connection test failed"
            : undefined;
      capabilities.push({
        providerKey: provider.providerKey,
        use,
        enabled: provider.enabled,
        usable: provider.enabled && provider.hasCredentials && provider.lastTestStatus !== "failed",
        reason,
      });
    }
  }
  return capabilities;
}

export async function runAudioFeatures(context: AudioFeatureExecutionContext): Promise<AudioFeatureStageResult> {
  const { getUserSyncSettings, resolveMetadataProviderSettings } = await import("./syncSettings");
  // This read deliberately happens at execution time, after earlier nightly stages.
  const savedSettings = await getUserSyncSettings(context.userId);
  const settings = {
    ...savedSettings,
    ...context.settingsOverrides,
    audioFeatureUserId: context.userId,
    ...(context.libraryId ? { audioFeatureLibraryId: context.libraryId } : {}),
  } as SyncEngineOptions;
  const effective = resolveMetadataProviderSettings(settings);
  const external = await import("./externalApiSettings");
  const runtimeProviders = await external.getExternalApiRuntimeConfig({ cache: false });
  const localEnabled = effective.audioFeatures.local || effective.bpm.local;
  let localInitializationError: string | null = null;
  if (localEnabled) {
    try {
      const { assertEssentiaAvailable } = await import("./localBpmEngine");
      await assertEssentiaAvailable();
    } catch (error) {
      localInitializationError = error instanceof Error ? error.message : String(error);
    }
  }

  const result = await runAudioFeatureOrchestration({
    source: context.source,
    settingsSource: context.settingsOverrides && Object.keys(context.settingsOverrides).length > 0 ? "database+execution_overrides" : "database",
    settings: effective,
    capabilities: providerCapabilities(runtimeProviders),
    localInitializationError,
    shouldContinue: context.shouldContinue,
    debug: logDebug,
    runApiBatch: async () => {
      const { runAudioFeatureEngine } = await import("./audioFeatureEngine");
      return runAudioFeatureEngine(settings);
    },
    runLocalBatch: async () => {
      const { runLocalAudioFeatureEngine } = await import("./localAudioFeatureEngine");
      return runLocalAudioFeatureEngine(settings);
    },
  });
  const { invalidateLibraryHealthCache } = await import("./libraryHealth");
  await invalidateLibraryHealthCache(context.userId, {
    libraryId: context.libraryId,
    reason: "audio_feature_orchestration_completed",
  });
  return {
    ...result,
    metadata: {
      ...result.metadata,
      libraryId: context.libraryId || null,
      selectedProvider: result.provider,
      tracksDiscovered: result.tracksDiscovered,
      batches: result.batches,
      durationMs: result.durationMs,
    },
  };
}
