import type { DictionaryDefinition, IntentCategory } from "./contracts";

export type PhraseProfile = {
  phrases: string[];
  categories: IntentCategory[];
  confidence: number;
  energy?: [number, number, number];
  valence?: [number, number, number];
  bpm?: [number | null, number | null, number | null];
  additions?: IntentCategory[];
};

export const BUILT_IN_PHRASE_PROFILES: PhraseProfile[] = [
  { phrases: ["background listening", "background music"], categories: ["background_listening"], confidence: .96, energy: [.15, .5, .32] },
  { phrases: ["late night", "late-night", "after midnight", "overnight"], categories: ["late_night"], confidence: .96, energy: [.15, .48, .3], valence: [.15, .6, .38] },
  { phrases: ["rainy night", "rainy-night", "rainy evening"], categories: ["late_night", "melancholic"], confidence: .9, energy: [.2, .4, .3], valence: [.12, .42, .28], bpm: [null, 105, 82] },
  { phrases: ["peaceful background music", "peaceful background"], categories: ["relaxing", "background_listening"], confidence: .94, energy: [.1, .34, .22] },
  { phrases: ["deep work", "getting things done", "productive", "productivity"], categories: ["focus"], confidence: .9, additions: ["background_listening"], energy: [.3, .58, .44] },
  { phrases: ["programming", "developer session", "coding"], categories: ["coding"], confidence: .97, additions: ["focus", "background_listening"], energy: [.28, .55, .42] },
  { phrases: ["study session", "studying", "study"], categories: ["studying"], confidence: .96, additions: ["focus", "background_listening"], energy: [.22, .5, .38] },
  { phrases: ["reading", "book time"], categories: ["reading"], confidence: .96, additions: ["relaxing", "background_listening"], energy: [.12, .42, .28] },
  { phrases: ["gym", "workout", "training session"], categories: ["workout"], confidence: .97, additions: ["energetic"], energy: [.58, .95, .78], bpm: [110, 175, 135] },
  { phrases: ["jogging", "running", "run music"], categories: ["running"], confidence: .97, additions: ["energetic"], energy: [.58, .95, .8], bpm: [115, 180, 145] },
  { phrases: ["road trip", "driving", "drive music"], categories: ["driving"], confidence: .96, energy: [.35, .78, .58] },
  { phrases: ["family safe party", "family-safe party"], categories: ["party", "energetic"], confidence: .99, energy: [.58, .9, .76] },
  { phrases: ["party"], categories: ["party"], confidence: .96, additions: ["energetic"], energy: [.55, .95, .75] },
  { phrases: ["date night"], categories: ["romantic", "dinner"], confidence: .95, additions: ["background_listening"], energy: [.18, .52, .34] },
  { phrases: ["dinner"], categories: ["dinner"], confidence: .96, additions: ["background_listening"], energy: [.18, .52, .34] },
  { phrases: ["bedtime", "sleep", "fall asleep"], categories: ["sleep", "relaxing"], confidence: .98, energy: [.02, .25, .12], bpm: [30, 85, 62] },
  { phrases: ["sunny morning", "early morning", "sunrise", "weekend morning", "morning"], categories: ["morning"], confidence: .94, energy: [.25, .62, .43], valence: [.55, 1, .76] },
  { phrases: ["afternoon", "weekend afternoon"], categories: ["background_listening"], confidence: .72, energy: [.25, .62, .44] },
  { phrases: ["sunset", "evening"], categories: ["relaxing", "background_listening"], confidence: .8, energy: [.18, .52, .34] },
  { phrases: ["chill", "calm", "relaxing", "relaxed", "peaceful"], categories: ["relaxing"], confidence: .92, energy: [.1, .42, .26] },
  { phrases: ["nostalgic", "nostalgia", "throwback"], categories: ["nostalgic"], confidence: .95 },
  { phrases: ["romantic", "romance"], categories: ["romantic"], confidence: .95 },
  { phrases: ["high energy", "hype", "energetic", "upbeat"], categories: ["energetic"], confidence: .93, energy: [.58, .95, .76], valence: [.5, 1, .72] },
  { phrases: ["sad", "melancholic", "melancholy", "moody"], categories: ["melancholic"], confidence: .9, valence: [.05, .4, .24] },
  { phrases: ["aggressive", "hard hitting", "hard-hitting"], categories: ["aggressive"], confidence: .94, energy: [.7, 1, .86] },
  { phrases: ["movie score", "soundtrack-like", "cinematic", "dark cinematic"], categories: ["cinematic"], confidence: .95, energy: [.25, .72, .48] },
  { phrases: ["triumphant", "uplifting", "hopeful"], categories: ["cinematic", "energetic"], confidence: .82, valence: [.62, 1, .8] },
];

export const PROFILE_SOFT_PREFERENCES: Partial<Record<IntentCategory, Array<{ target: string; type: "INSTRUMENTAL" | "VOCALS" | "TRANSITION" | "CATEGORY"; field: string; value: unknown }>>> = {
  coding: [
    { target: "minimal lyrical distraction", type: "VOCALS", field: "vocal_content", value: "minimal" },
    { target: "smooth stable energy", type: "TRANSITION", field: "energy_transition", value: "smooth" },
  ],
  focus: [{ target: "background-friendly", type: "CATEGORY", field: "category", value: "background_listening" }],
  running: [{ target: "consistent beat", type: "TRANSITION", field: "rhythm_transition", value: "consistent" }],
  dinner: [{ target: "lower aggressiveness", type: "CATEGORY", field: "aggressive", value: false }],
  sleep: [{ target: "exclude aggressive music", type: "CATEGORY", field: "aggressive", value: false }],
};

export function profileToDefinition(profile: PhraseProfile): DictionaryDefinition {
  return {
    categories: [...profile.categories, ...(profile.additions || [])],
    positivePreferences: [], negativePreferences: [], hardRequirements: [], softPreferences: [], phases: [],
    energyTarget: profile.energy ? { minimum: profile.energy[0], maximum: profile.energy[1], preferred: profile.energy[2], label: null } : null,
    valenceTarget: profile.valence ? { minimum: profile.valence[0], maximum: profile.valence[1], preferred: profile.valence[2], label: null } : null,
    tempoTarget: profile.bpm ? { minimumBpm: profile.bpm[0], maximumBpm: profile.bpm[1], preferredBpm: profile.bpm[2], label: null } : null,
    energyCurve: null, bpmCurve: null,
  };
}
