import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { adaptIntentToDeterministicInputs } from "./intentIntelligence/adapter";
import { dictionaryDefinitionSchema, structuredIntentSchema } from "./intentIntelligence/contracts";
import { interpretIntentLocally, normalizeIntentPhrase } from "./intentIntelligence/interpreter";
import { orderTracksByIntentCurves, sampleIntentCurve } from "./intentIntelligence/ordering";

function read(path: string) { return readFileSync(join(process.cwd(), path), "utf8"); }
function category(intent: ReturnType<typeof interpretIntentLocally>, name: string) { return intent.categories.some((item) => item.name === name); }

describe("v2.4.5 local mood, activity, and intent intelligence", () => {
  it("normalizes punctuation and prefers multi-word canonical mappings", () => {
    assert.equal(normalizeIntentPhrase("  Late—Night   CODING!!! "), "late night coding");
    const intent = interpretIntentLocally({ text: "Give me peaceful background music for deep work." });
    assert.equal(category(intent, "background_listening"), true); assert.equal(category(intent, "relaxing"), true); assert.equal(category(intent, "focus"), true);
    assert.equal(intent.matchedPhrases.some((item) => item.normalizedPhrase === "peaceful background music"), true);
  });

  it("builds the three-phase rainy-night to uplifting progression", () => {
    const intent = interpretIntentLocally({ text: "Start with rainy-night music, become more hopeful, and finish with something uplifting." });
    assert.equal(intent.phases.length, 3); assert.equal(intent.energyCurve?.shape, "RISING");
    assert.ok((intent.phases[0].energy?.preferred || 0) < (intent.phases[2].energy?.preferred || 0));
    assert.ok((intent.phases[0].valence?.preferred || 0) < (intent.phases[2].valence?.preferred || 0));
    assert.equal(Math.round(intent.phases.reduce((sum, phase) => sum + phase.targetShare, 0) * 100), 100);
  });

  it("extracts coding context, minimal vocals, and stable transitions", () => {
    const intent = interpretIntentLocally({ text: "Give me late-night coding music with minimal vocals and no abrupt energy changes." });
    for (const expected of ["coding", "late_night", "focus", "background_listening"]) assert.equal(category(intent, expected), true);
    assert.equal(intent.negativePreferences.some((item) => item.type === "VOCALS"), true);
    assert.equal(intent.positivePreferences.some((item) => item.type === "TRANSITION"), true);
    assert.equal(intent.energyCurve?.shape, "FLAT");
  });

  it("supports workout rise-and-fall phases and duration warnings", () => {
    const intent = interpretIntentLocally({ text: "Start with a moderate warmup, build to high energy, then give me a ten-minute cooldown." });
    assert.equal(intent.phases.length, 3); assert.equal(intent.phases[0].label, "Warmup"); assert.equal(intent.phases[2].label, "Cooldown");
    assert.equal(intent.energyCurve?.shape, "MIDDLE_PEAK"); assert.match(intent.warnings.join(" "), /exact ten-minute duration/i);
  });

  it("distinguishes hard exclusions from soft familiarity and aggression preferences", () => {
    const dinner = interpretIntentLocally({ text: "I want upbeat dinner music, preferably familiar songs, but no explicit tracks." });
    assert.equal(category(dinner, "dinner"), true); assert.equal(category(dinner, "energetic"), true);
    assert.equal(dinner.hardRequirements.some((item) => item.type === "EXPLICIT" && item.strength === "EXCLUDED"), true);
    assert.equal(dinner.softPreferences.some((item) => item.type === "FAMILIARITY"), true);
    const family = interpretIntentLocally({ text: "Make a family-safe party playlist that is energetic but not aggressive." });
    assert.equal(family.hardRequirements.some((item) => item.type === "EXPLICIT"), true);
    assert.equal(family.negativePreferences.some((item) => item.target === "high aggressiveness" && item.strength === "DISCOURAGED"), true);
  });

  it("detects sleep/high-BPM hard conflicts and blocks the adapter until review", () => {
    const intent = interpretIntentLocally({ text: "Give me relaxing sleep music that stays above 150 BPM." });
    assert.equal(intent.conflicts.some((item) => item.type === "HARD_CONFLICT"), true); assert.equal(intent.requiresReview, true);
    assert.throws(() => adaptIntentToDeterministicInputs(intent), /Contradictory hard requirements/);
  });

  it("parses approximate BPM ramps without inventing a mood", () => {
    const intent = interpretIntentLocally({ text: "Begin around 95 BPM and gradually reach 130 BPM by the end." });
    assert.equal(intent.bpmCurve?.shape, "RISING"); assert.deepEqual(intent.bpmCurve?.points.map((point) => point.value), [95, 130]); assert.equal(intent.categories.length, 0);
  });

  it("resolves personal dictionary phrases locally with deterministic precedence", () => {
    const definition = dictionaryDefinitionSchema.parse({ categories: ["relaxing", "background_listening"], energyTarget: { minimum: .2, maximum: .4, preferred: .3, label: "low" } });
    const intent = interpretIntentLocally({ text: "Play Chrisflix chill.", dictionaries: [{ id: "private-1", phrase: "Chrisflix chill", aliases: ["CF chill"], definition, source: "PERSONAL_DICTIONARY", priority: 900 }] });
    assert.equal(intent.interpretationSource, "LOCAL_DICTIONARY"); assert.equal(category(intent, "relaxing"), true);
    assert.equal(intent.matchedPhrases[0].source, "PERSONAL_DICTIONARY");
    const source = read("src/lib/naturalLanguageRequests/interpreter.ts");
    assert.match(source, /providerSafeRequest/); assert.match(source, /private terminology/); assert.doesNotMatch(source, /description: row\.description/);
  });

  it("keeps phase-specific instrumental and vocal requirements scoped", () => {
    const intent = interpretIntentLocally({ text: "Start instrumental, add vocals in the middle, and finish with instrumental cinematic tracks." });
    assert.equal(intent.phases.length, 3); assert.equal(intent.phases[0].vocalMode, "INSTRUMENTAL"); assert.equal(intent.phases[1].vocalMode, "VOCAL"); assert.equal(intent.phases[2].vocalMode, "INSTRUMENTAL");
    assert.equal(intent.phases[2].categories.includes("cinematic"), true);
  });

  it("validates the strict schema, adapts only supported deterministic inputs, and orders curves deterministically", () => {
    const intent = interpretIntentLocally({ text: "Begin around 95 BPM and gradually reach 130 BPM by the end." });
    assert.equal(structuredIntentSchema.safeParse({ ...intent, arbitraryFilter: "DROP TABLE" }).success, false);
    const adapter = adaptIntentToDeterministicInputs(intent); assert.equal(adapter.recipePatch.generation.engineVersion, "v2"); assert.equal(adapter.orderingContext.tolerancePolicy, "RELAX_SOFT_ONLY");
    assert.equal(Math.round(sampleIntentCurve(intent.bpmCurve, .5) || 0), 113);
    const tracks = [{ id: "fast", bpm: 130, audioFeature: { effectiveEnergy: .8 } }, { id: "slow", bpm: 95, audioFeature: { effectiveEnergy: .2 } }, { id: "mid", bpm: 112, audioFeature: { effectiveEnergy: .5 } }];
    assert.deepEqual(orderTracksByIntentCurves(tracks, adapter.recipePatch.generation.intentOrdering as any).map((track) => track.id), ["slow", "mid", "fast"]);
  });

  it("ships authenticated APIs, additive migration, settings, editor, privacy controls, docs, and release metadata", () => {
    for (const path of ["src/app/api/intents/interpret/route.ts","src/app/api/intents/validate/route.ts","src/app/api/intents/estimate/route.ts","src/app/api/intents/apply/route.ts","src/app/api/intent-dictionary/route.ts","src/app/api/intent-presets/route.ts","src/app/api/intent-settings/route.ts"]) assert.doesNotThrow(() => read(path));
    const migration = read("prisma/migrations/20260723010000_mood_activity_intent_intelligence_v245/migration.sql"), ui = read("src/components/NaturalLanguageRequests.tsx"), docs = read("docs/MOOD_ACTIVITY_INTENT_INTELLIGENCE_V245.md");
    assert.match(migration, /IntentDictionaryEntry/); assert.match(migration, /IntentInterpretationSetting/); assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);
    for (const marker of [/Recognized intent/, /Playlist phases/, /Energy curve/, /Custom terminology resolved locally/, /Save intent preset/]) assert.match(ui, marker);
    assert.match(docs, /private phrases.*resolved locally/i); assert.equal(JSON.parse(read("package.json")).version, "2.4.10");
  });
});
