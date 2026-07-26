import { normalizeSmartMixTuningConfig, type SmartMixTuningConfig } from "./smartMixEngine/v2";
import { getFeatureState, recordBetaUsage } from "./featureFlagService";
import type { BetaAccessLevel } from "./featureFlagRegistry";
import {
  DEFAULT_SCORING_MODEL,
  SCORING_MODELS,
  type ScoringModel,
} from "./scoringModelCatalog";

export type ScoringModelStability = "STABLE" | "EXPERIMENTAL";
export type ScoringModelDefinition = {
  id: ScoringModel;
  name: string;
  version: string;
  stability: ScoringModelStability;
  description: string;
  supportedFeatures: string[];
  defaultWeights: Pick<SmartMixTuningConfig, "popularityWeight" | "moodWeight" | "energyWeight" | "bpmWeight" | "artistVariety" | "albumVariety">;
  minimumBetaLevel: BetaAccessLevel;
  requiredFeature: string | null;
  apply: (config: SmartMixTuningConfig) => SmartMixTuningConfig;
};

const stableWeights = { popularityWeight: 50, moodWeight: 50, energyWeight: 50, bpmWeight: 50, artistVariety: 50, albumVariety: 50 };
const keepSavedWeights = (config: SmartMixTuningConfig) => normalizeSmartMixTuningConfig(config);

const scoringModelImplementations: Record<ScoringModel, Omit<ScoringModelDefinition, "id">> = {
  "stable-v2": {
    name: "Stable v2", version: "2", stability: "STABLE",
    description: "The supported Smart Mix v2 scoring behavior using saved static weights.",
    supportedFeatures: [], defaultWeights: stableWeights, minimumBetaLevel: "STABLE", requiredFeature: null, apply: keepSavedWeights,
  },
  "experimental-balanced": {
    name: "Experimental Balanced", version: "1", stability: "EXPERIMENTAL",
    description: "A real alternative model that pulls extreme weights toward balance and increases artist and album variety.",
    supportedFeatures: ["smartMix.experimentalScoring"],
    defaultWeights: { popularityWeight: 48, moodWeight: 58, energyWeight: 58, bpmWeight: 54, artistVariety: 64, albumVariety: 60 },
    minimumBetaLevel: "PUBLIC_BETA", requiredFeature: "smartMix.experimentalScoring",
    apply: (input) => {
      const config = normalizeSmartMixTuningConfig(input);
      const balanced = (saved: number, target: number) => Math.round((saved * 0.55 + target * 0.45) * 100) / 100;
      return normalizeSmartMixTuningConfig({
        ...config,
        recommendationStrength: balanced(config.recommendationStrength, 58),
        popularityWeight: balanced(config.popularityWeight, 48),
        moodWeight: balanced(config.moodWeight, 58),
        energyWeight: balanced(config.energyWeight, 58),
        bpmWeight: balanced(config.bpmWeight, 54),
        artistVariety: balanced(config.artistVariety, 64),
        albumVariety: balanced(config.albumVariety, 60),
        presetName: `${config.presetName || "Custom"} · Experimental Balanced`,
      });
    },
  },
};

export const scoringModelRegistry: readonly ScoringModelDefinition[] = SCORING_MODELS.map((id) => ({
  id,
  ...scoringModelImplementations[id],
}));

export const STABLE_SCORING_MODEL_ID = DEFAULT_SCORING_MODEL;

export function getScoringModel(modelId: unknown) {
  const id = typeof modelId === "string" ? modelId : STABLE_SCORING_MODEL_ID;
  return scoringModelRegistry.find((model) => model.id === id) || null;
}

export async function resolveScoringModel(input: { userId: string; requestedModel?: string | null; allowStableFallback?: boolean }) {
  const requested = getScoringModel(input.requestedModel);
  const stable = scoringModelRegistry[0];
  if (!requested) {
    if (!input.allowStableFallback) throw new Error("SCORING_MODEL_NOT_FOUND");
    return { requestedModel: String(input.requestedModel || ""), model: stable, fallbackUsed: true, fallbackReason: "model_unavailable" };
  }
  if (!requested.requiredFeature) return { requestedModel: requested.id, model: requested, fallbackUsed: false, fallbackReason: null };
  const state = await getFeatureState(requested.requiredFeature, { userId: input.userId });
  if (state.enabled) return { requestedModel: requested.id, model: requested, fallbackUsed: false, fallbackReason: null };
  if (!input.allowStableFallback) {
    const error = new Error("EXPERIMENTAL_SCORING_UNAVAILABLE");
    (error as any).featureState = state;
    throw error;
  }
  console.warn("[SmartMixBeta] Stable fallback selected", { requestedModel: requested.id, fallbackModel: stable.id, reason: state.reason });
  await recordBetaUsage({ userId: input.userId, featureKey: requested.requiredFeature, action: "scoring_model_resolution", success: true, fallbackUsed: true, engineVersion: "v2", scoringModel: stable.id, errorCode: state.reason });
  return { requestedModel: requested.id, model: stable, fallbackUsed: true, fallbackReason: state.reason };
}

export async function listAvailableScoringModels(userId: string) {
  const states = await Promise.all(scoringModelRegistry.map(async (model) => ({
    ...model,
    apply: undefined,
    available: !model.requiredFeature || (await getFeatureState(model.requiredFeature, { userId, requireUserEnabled: false })).available,
    enabled: !model.requiredFeature || (await getFeatureState(model.requiredFeature, { userId })).enabled,
  })));
  return states;
}
