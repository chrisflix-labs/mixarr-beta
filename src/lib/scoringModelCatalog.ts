import { z } from "zod";

/**
 * The stored scoring-model values supported by the playlist-generation engine.
 * Every schema, prompt, control, persistence boundary, and execution dispatch
 * must derive from this tuple.
 */
export const SCORING_MODELS = [
  "stable-v2",
  "experimental-balanced",
] as const;

export type ScoringModel = typeof SCORING_MODELS[number];

export const scoringModelSchema = z.enum(SCORING_MODELS, {
  errorMap: () => ({ message: "Unsupported scoring model." }),
});

export const DEFAULT_SCORING_MODEL: ScoringModel = SCORING_MODELS[0];

const scoringModelMetadata: Record<ScoringModel, {
  label: string;
  description: string;
}> = {
  "stable-v2": {
    label: "Stable v2",
    description: "Uses the recipe's saved explicit scoring weights without applying a model preset.",
  },
  "experimental-balanced": {
    label: "Experimental balanced",
    description: "Blends saved weights toward balanced targets and increases artist and album variety.",
  },
};

export const SCORING_MODEL_OPTIONS = SCORING_MODELS.map((value) => ({
  value,
  ...scoringModelMetadata[value],
})) as readonly {
  value: ScoringModel;
  label: string;
  description: string;
}[];

/**
 * There are no documented scoring-model aliases in v2.4.20. Keep this
 * explicit and narrow so future migrations cannot accidentally introduce
 * fuzzy or arbitrary enum conversion.
 */
export const LEGACY_SCORING_MODEL_ALIASES: Readonly<Record<string, ScoringModel>> = Object.freeze({});

export type ScoringModelNormalization =
  | { status: "canonical"; value: ScoringModel; receivedValue: string }
  | { status: "legacy_alias"; value: ScoringModel; receivedValue: string }
  | { status: "unsupported"; receivedValue: unknown };

export function normalizeScoringModel(value: unknown): ScoringModelNormalization {
  if (typeof value === "string" && (SCORING_MODELS as readonly string[]).includes(value)) {
    return { status: "canonical", value: value as ScoringModel, receivedValue: value };
  }
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_SCORING_MODEL_ALIASES, value)) {
    return { status: "legacy_alias", value: LEGACY_SCORING_MODEL_ALIASES[value], receivedValue: value };
  }
  return { status: "unsupported", receivedValue: value };
}

export function scoringModelValidationIssue(value: unknown) {
  return {
    path: "scoring.scoringModel",
    code: "RECIPE_SCORING_MODEL_UNSUPPORTED",
    message: "The selected scoring model is not supported.",
    receivedValue: value,
    supportedValues: [...SCORING_MODELS],
  } as const;
}

