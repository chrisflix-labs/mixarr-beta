import { structuredIntentSchema, type StructuredIntent } from "./contracts";

const moodCategoryMap: Partial<Record<StructuredIntent["categories"][number]["name"], string>> = {
  relaxing: "Relaxing", nostalgic: "Nostalgic", romantic: "Romantic", energetic: "Energetic",
  melancholic: "Melancholic", aggressive: "Aggressive", cinematic: "Cinematic", focus: "Focused",
};

function hardValue(intent: StructuredIntent, field: string) {
  return intent.hardRequirements.find((item) => item.deterministicMapping.field === field)?.deterministicMapping.value;
}

function progression(intent: StructuredIntent) {
  const shape = intent.energyCurve?.shape;
  if (shape === "RISING" || shape === "FINAL_PEAK") return "rising" as const;
  if (shape === "FALLING") return "falling" as const;
  if (shape === "WAVE") return "wave" as const;
  if (shape === "FLAT") return "steady" as const;
  return "mixed" as const;
}

export type IntentAdapterOutput = ReturnType<typeof adaptIntentToDeterministicInputs>;

export function adaptIntentToDeterministicInputs(value: unknown) {
  const intent = structuredIntentSchema.parse(value);
  const unresolvedHard = intent.conflicts.filter((conflict) => conflict.type === "HARD_CONFLICT" && !conflict.resolution);
  if (unresolvedHard.length) throw Object.assign(new Error("Contradictory hard requirements must be resolved before generation."), { code: "CONTRADICTORY_HARD_REQUIREMENTS", status: 409 });

  const selectedMoods = Array.from(new Set(intent.categories.map((item) => moodCategoryMap[item.name]).filter((item): item is string => Boolean(item))));
  const phaseMoods = intent.phases.flatMap((phase) => phase.categories.map((item) => moodCategoryMap[item]).filter((item): item is string => Boolean(item)));
  const allMoods = Array.from(new Set([...selectedMoods, ...phaseMoods]));
  const excludeExplicit = intent.hardRequirements.some((item) => item.type === "EXPLICIT" && item.strength === "EXCLUDED");
  const excludeLive = intent.hardRequirements.some((item) => item.type === "LIVE" && item.strength === "EXCLUDED");
  const excludeHoliday = intent.hardRequirements.some((item) => item.type === "HOLIDAY" && item.strength === "EXCLUDED");
  const genreExclusions = intent.hardRequirements.filter((item) => item.type === "GENRE" && item.strength === "EXCLUDED");
  const minimumBpm = hardValue(intent, "minimum_bpm");
  const maximumBpm = hardValue(intent, "maximum_bpm");
  const bpmRange = hardValue(intent, "bpm_range") as { minimum?: number; maximum?: number } | undefined;
  const bpmTarget = intent.softPreferences.find((item) => item.deterministicMapping.field === "bpm_target")?.deterministicMapping.value;
  const familiar = intent.softPreferences.some((item) => item.type === "FAMILIARITY" && item.strength === "PREFERRED");
  const smooth = intent.positivePreferences.some((item) => item.type === "TRANSITION" && item.deterministicMapping.value === "smooth");
  const energyPoints = intent.energyCurve?.points || [];
  const minEnergy = energyPoints.length ? Math.min(...energyPoints.map((point) => point.value)) : null;
  const maxEnergy = energyPoints.length ? Math.max(...energyPoints.map((point) => point.value)) : null;
  const targetEnergy = energyPoints.length ? energyPoints.reduce((sum, point) => sum + point.value, 0) / energyPoints.length : null;
  const rules = genreExclusions.map((item) => ({ field: "genre" as const, operator: "not_contains" as const, value: String(item.deterministicMapping.value || item.target) }));
  const bpmMode: "RAMP_UP" | "RAMP_DOWN" | "STEADY" | "CUSTOM" | "DISABLED" = intent.bpmCurve?.shape === "RISING" ? "RAMP_UP" : intent.bpmCurve?.shape === "FALLING" ? "RAMP_DOWN" : intent.bpmCurve?.shape === "FLAT" ? "STEADY" : intent.bpmCurve ? "CUSTOM" : "DISABLED";
  const moodCurve = intent.phases.flatMap((phase, index) => {
    const mood = phase.categories.map((item) => moodCategoryMap[item]).find(Boolean);
    if (!mood) return [];
    const before = intent.phases.slice(0, index).reduce((sum, item) => sum + item.targetShare, 0) * 100;
    return [{ start: Math.round(before * 100) / 100, end: Math.round((before + phase.targetShare * 100) * 100) / 100, mood }];
  });
  const warnings = [...intent.warnings];
  if (intent.negativePreferences.some((item) => item.deterministicMapping.field === "aggressive")) warnings.push("Aggressiveness is not a first-class library field; Mixarr uses energy, valence, and transition smoothness as the nearest supported soft signals.");
  if (intent.negativePreferences.some((item) => item.deterministicMapping.field === "media_type")) warnings.push("Podcast exclusion applies only when the source library exposes a supported media type.");

  return {
    schemaVersion: 1,
    recipePatch: {
      metadata: { description: intent.summary, category: intent.categories[0] ? intent.categories[0].name.replace(/_/g, " ") : "Custom" },
      generation: {
        rules,
        negativeFilters: { excludeExplicit, excludeLive, excludeHoliday },
        engineVersion: "v2" as const,
        moodBlendMode: moodCurve.length > 1 ? "smooth_transition" as const : allMoods.length ? "mixed_mood" as const : "off" as const,
        selectedMoodPath: moodCurve.map((item) => item.mood), allowedMoods: allMoods,
        transitionSmoothness: smooth ? 90 : 72,
        intentOrdering: {
          schemaVersion: 1 as const, phases: intent.phases.map((phase) => ({ id: phase.id, label: phase.label, targetShare: phase.targetShare })),
          energyCurve: intent.energyCurve, bpmCurve: intent.bpmCurve, smoothTransitions: smooth || intent.phases.some((phase) => phase.transition === "GRADUAL"),
        },
      },
      targets: { selectedMoods: allMoods, primaryMood: allMoods[0] || null, secondaryMoods: allMoods.slice(1), moodBlendMode: moodCurve.length > 1 ? "smooth_transition" as const : allMoods.length ? "mixed_mood" as const : "off" as const, moodTransition: moodCurve.length > 1 ? "sectioned" as const : "none" as const, moodCurve, minimumEnergy: null, maximumEnergy: null, targetEnergy, energyProgression: progression(intent) },
      bpmFlow: {
        minimumBpm: Number.isFinite(Number(minimumBpm ?? bpmRange?.minimum)) ? Number(minimumBpm ?? bpmRange?.minimum) : null,
        maximumBpm: Number.isFinite(Number(maximumBpm ?? bpmRange?.maximum)) ? Number(maximumBpm ?? bpmRange?.maximum) : null,
        targetBpm: Number.isFinite(Number(bpmTarget)) ? Number(bpmTarget) : null, mode: bpmMode,
        sections: intent.bpmCurve?.points.map((point, index, list) => ({ start: point.position * 100, end: (list[index + 1]?.position ?? 1) * 100, targetBpm: point.value })) || [],
        maximumBpmGap: smooth ? 8 : 12,
      },
      discovery: familiar ? { familiarityBalance: 78 } : {},
      variety: smooth ? { minimumArtistSpacing: 2 } : {},
      refreshPolicy: { mode: "manual" as const },
    },
    orderingContext: { energyCurve: intent.energyCurve, bpmCurve: intent.bpmCurve, phases: intent.phases, tolerancePolicy: "RELAX_SOFT_ONLY" as const },
    explanation: {
      requestedCurves: { energy: intent.energyCurve, bpm: intent.bpmCurve }, phaseCoverageTargets: intent.phases.map((phase) => ({ id: phase.id, label: phase.label, percentage: phase.targetShare * 100 })),
      hardFilters: intent.hardRequirements.map((item) => item.target), softBonuses: intent.softPreferences.filter((item) => item.strength === "PREFERRED").map((item) => item.target), penalties: intent.softPreferences.filter((item) => item.strength === "DISCOURAGED").map((item) => item.target), warnings,
    },
  };
}
