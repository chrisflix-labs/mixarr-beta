import { randomUUID } from "crypto";
import {
  dictionaryDefinitionSchema, structuredIntentSchema, type DictionaryDefinition, type IntentCategory,
  type IntentPhase, type IntentPreference, type StructuredIntent,
} from "./contracts";
import { BUILT_IN_PHRASE_PROFILES, PROFILE_SOFT_PREFERENCES, profileToDefinition } from "./profiles";

export type RuntimeDictionaryMapping = {
  id: string;
  phrase: string;
  aliases?: string[];
  definition: DictionaryDefinition;
  source: "PERSONAL_DICTIONARY" | "HOUSEHOLD_DICTIONARY" | "ADMIN_DICTIONARY" | "SAVED_PRESET";
  priority?: number;
};

const HARD_MARKERS = /\b(must|required|only|never|do not|don't|dont|exclude|nothing (?:above|below|over|under)|clean only|family[ -]safe|no)\b/i;
const SOFT_MARKERS = /\b(prefer|preferably|favor|mostly|lean toward|try to|something like|around|roughly|about|not too|a little|occasional|minimal|very little)\b/i;

export function normalizeIntentPhrase(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[’‘]/g, "'").replace(/[-–—_/]+/g, " ").replace(/[^a-z0-9'%+.,\s]/gi, " ").replace(/\s+/g, " ").trim();
}

function round(value: number, places = 3) { const scale = 10 ** places; return Math.round(value * scale) / scale; }
function clamp(value: number, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function id(prefix: string) { return `${prefix}-${randomUUID().slice(0, 8)}`; }
function title(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()); }

function preference(input: {
  target: string; type: IntentPreference["type"]; strength: IntentPreference["strength"]; sourcePhrase: string;
  confidence?: number; field: string; value?: unknown; kind?: IntentPreference["deterministicMapping"]["kind"]; phaseId?: string | null;
}): IntentPreference {
  const classification = HARD_MARKERS.test(input.sourcePhrase) || SOFT_MARKERS.test(input.sourcePhrase) ? .96 : .72;
  return {
    id: id("pref"), target: input.target, type: input.type, strength: input.strength,
    confidence: input.confidence ?? .9, classificationConfidence: classification, sourcePhrase: input.sourcePhrase,
    scope: { phaseId: input.phaseId || null },
    deterministicMapping: { kind: input.kind || (input.strength === "REQUIRED" ? "FILTER" : input.strength === "EXCLUDED" ? "EXCLUSION" : input.strength === "DISCOURAGED" ? "PENALTY" : "BONUS"), field: input.field, value: input.value },
    userEdited: false,
  };
}

function strengthFor(phrase: string, negative = false): IntentPreference["strength"] {
  if (HARD_MARKERS.test(phrase)) return negative ? "EXCLUDED" : "REQUIRED";
  if (negative) return "DISCOURAGED";
  return "PREFERRED";
}

type MatchedDefinition = RuntimeDictionaryMapping & { normalizedPhrase: string; matchedPhrase: string; start: number; confidence: number };

function matchDefinitions(text: string, dictionaries: RuntimeDictionaryMapping[]) {
  const normalized = normalizeIntentPhrase(text);
  const builtIns: RuntimeDictionaryMapping[] = BUILT_IN_PHRASE_PROFILES.flatMap((profile, profileIndex) => profile.phrases.map((phrase, phraseIndex) => ({
    id: `built-in-${profileIndex}-${phraseIndex}`, phrase, definition: profileToDefinition(profile), source: "SAVED_PRESET" as const,
    priority: 0,
  })));
  const candidates = [...dictionaries, ...builtIns].flatMap((mapping) => [mapping.phrase, ...(mapping.aliases || [])].map((phrase) => ({ mapping, phrase, normalizedPhrase: normalizeIntentPhrase(phrase) })))
    .filter((item) => item.normalizedPhrase.length >= 2)
    .sort((left, right) => right.normalizedPhrase.length - left.normalizedPhrase.length || (right.mapping.priority || 0) - (left.mapping.priority || 0));
  const occupied: Array<[number, number]> = [];
  const matches: MatchedDefinition[] = [];
  for (const candidate of candidates) {
    let start = normalized.indexOf(candidate.normalizedPhrase);
    while (start >= 0) {
      const end = start + candidate.normalizedPhrase.length;
      const boundary = (start === 0 || normalized[start - 1] === " ") && (end === normalized.length || " ,.".includes(normalized[end]));
      const overlaps = occupied.some(([left, right]) => start < right && end > left);
      if (boundary && !overlaps) {
        occupied.push([start, end]);
        const profile = BUILT_IN_PHRASE_PROFILES.find((entry) => entry.phrases.some((phrase) => normalizeIntentPhrase(phrase) === candidate.normalizedPhrase));
        matches.push({ ...candidate.mapping, normalizedPhrase: candidate.normalizedPhrase, matchedPhrase: candidate.phrase, start, confidence: profile?.confidence || .99 });
        break;
      }
      start = normalized.indexOf(candidate.normalizedPhrase, start + 1);
    }
  }
  return matches.sort((left, right) => left.start - right.start);
}

function targetForText(value: string, dimension: "energy" | "valence" | "tempo") {
  const normalized = normalizeIntentPhrase(value);
  const profile = BUILT_IN_PHRASE_PROFILES
    .filter((entry) => entry.phrases.some((phrase) => normalized.includes(normalizeIntentPhrase(phrase))))
    .sort((left, right) => Math.max(...right.phrases.map((phrase) => phrase.length)) - Math.max(...left.phrases.map((phrase) => phrase.length)))[0];
  if (dimension === "energy" && profile?.energy) return { minimum: profile.energy[0], maximum: profile.energy[1], preferred: profile.energy[2], label: null };
  if (dimension === "valence" && profile?.valence) return { minimum: profile.valence[0], maximum: profile.valence[1], preferred: profile.valence[2], label: null };
  if (dimension === "tempo" && profile?.bpm) return { minimumBpm: profile.bpm[0], maximumBpm: profile.bpm[1], preferredBpm: profile.bpm[2], label: null };
  if (dimension === "energy") {
    if (/cool ?down|sleep|very calm|gentle/.test(normalized)) return { minimum: .05, maximum: .3, preferred: .18, label: "low" };
    if (/warm ?up|moderate|transitional/.test(normalized)) return { minimum: .3, maximum: .58, preferred: .44, label: "moderate" };
    if (/high energy|strong|peak|fast/.test(normalized)) return { minimum: .7, maximum: 1, preferred: .86, label: "high" };
    if (/uplifting|hopeful/.test(normalized)) return { minimum: .5, maximum: .78, preferred: .65, label: "moderate to high" };
  }
  if (dimension === "valence") {
    if (/rainy|dark|melanchol|sad|reflective/.test(normalized)) return { minimum: .1, maximum: .38, preferred: .25, label: "low" };
    if (/transition|neutral|become/.test(normalized)) return { minimum: .35, maximum: .62, preferred: .48, label: "neutral" };
    if (/uplifting|hopeful|triumphant|positive/.test(normalized)) return { minimum: .65, maximum: 1, preferred: .82, label: "positive" };
  }
  if (dimension === "tempo") {
    if (/slow|rainy|sleep|gentle/.test(normalized)) return { minimumBpm: null, maximumBpm: 100, preferredBpm: 78, label: "slow" };
    if (/moderate|transition|hopeful/.test(normalized)) return { minimumBpm: 90, maximumBpm: 125, preferredBpm: 108, label: "moderate" };
    if (/upbeat|fast|high energy/.test(normalized)) return { minimumBpm: 110, maximumBpm: 155, preferredBpm: 130, label: "upbeat" };
  }
  return null;
}

function labelForPhase(value: string, index: number) {
  const normalized = normalizeIntentPhrase(value);
  if (/rainy|melanchol|dark|calm/.test(normalized)) return "Reflective";
  if (/hopeful|become|transition|build/.test(normalized)) return "Transitional";
  if (/uplifting|triumphant|finish strong|high energy|peak/.test(normalized)) return "Uplifting";
  if (/warm ?up/.test(normalized)) return "Warmup";
  if (/cool ?down|wind down/.test(normalized)) return "Cooldown";
  if (/instrumental/.test(normalized)) return index === 0 ? "Instrumental opening" : "Instrumental finish";
  if (/vocal/.test(normalized)) return "Vocal middle";
  return `Phase ${index + 1}`;
}

function extractPhaseSegments(source: string) {
  const normalized = normalizeIntentPhrase(source);
  if (/start (?:with )?.*warm ?up.*build.*high energy.*(?:cool ?down|wind down)/.test(normalized)) {
    return ["moderate warmup", "build to high energy", "ten-minute cooldown"];
  }
  if (/start instrumental.*(?:vocals|vocal).*middle.*finish.*instrumental/.test(normalized)) {
    return ["start instrumental", "add vocals in the middle", "finish with instrumental cinematic tracks"];
  }
  const trigger = /\b(start with|begin with|open with|then|become|transition into|build toward|peak with|finish with|end with|cool down|wind down)\b/g;
  const hits: RegExpExecArray[] = [];
  let triggerMatch: RegExpExecArray | null;
  while ((triggerMatch = trigger.exec(normalized)) !== null) hits.push(triggerMatch);
  if (hits.length < 2) return [];
  return hits.slice(0, 6).map((hit, index) => {
    const start = hit.index || 0;
    const end = index + 1 < hits.length ? hits[index + 1].index : normalized.length;
    return normalized.slice(start, end).replace(/^[,\s]+|[,\s]+$/g, "");
  });
}

function categoriesForText(value: string) {
  const normalized = normalizeIntentPhrase(value);
  const categories = new Set<IntentCategory>();
  for (const profile of BUILT_IN_PHRASE_PROFILES) if (profile.phrases.some((phrase) => normalized.includes(normalizeIntentPhrase(phrase)))) for (const category of [...profile.categories, ...(profile.additions || [])]) categories.add(category);
  return Array.from(categories);
}

function buildPhases(source: string, maxPhases: number) {
  const segments = extractPhaseSegments(source).slice(0, maxPhases);
  if (segments.length < 2) return [];
  const workout = segments.some((segment) => /warm ?up/.test(segment)) && segments.some((segment) => /cool ?down/.test(segment));
  const shares = workout && segments.length === 3 ? [.2, .6, .2] : segments.map(() => round(1 / segments.length));
  shares[shares.length - 1] = round(1 - shares.slice(0, -1).reduce((sum, share) => sum + share, 0));
  return segments.map((segment, index): IntentPhase => {
    const vocalMode = /instrumental/.test(segment) ? "INSTRUMENTAL" : /vocal/.test(segment) ? "VOCAL" : "ANY";
    return {
      id: `phase-${index + 1}`, position: index + 1, label: labelForPhase(segment, index), targetShare: shares[index], categories: categoriesForText(segment),
      energy: targetForText(segment, "energy") as IntentPhase["energy"], valence: targetForText(segment, "valence") as IntentPhase["valence"], tempo: targetForText(segment, "tempo") as IntentPhase["tempo"],
      vocalMode, transition: /gradual|build|become|transition/.test(source.toLowerCase()) ? "GRADUAL" : "SMOOTH",
      confidence: .84, sourcePhrase: segment,
    };
  });
}

function curveFromPhases(phases: IntentPhase[], dimension: "energy" | "bpm") {
  const values = phases.map((phase) => dimension === "energy" ? phase.energy?.preferred : phase.tempo?.preferredBpm);
  if (values.filter((value) => value != null).length < 2) return null;
  const points = values.map((value, index) => ({ position: phases.length === 1 ? 0 : round(index / (phases.length - 1)), value: value ?? (dimension === "energy" ? .5 : 110) }));
  const first = points[0].value, last = points[points.length - 1].value, middle = Math.max(...points.slice(1, -1).map((point) => point.value));
  const shape = middle > first && middle > last ? "MIDDLE_PEAK" : last > first ? "RISING" : last < first ? "FALLING" : "FLAT";
  return { shape: shape as "MIDDLE_PEAK" | "RISING" | "FALLING" | "FLAT", points, tolerance: dimension === "energy" ? .12 : 10, hard: false, confidence: .85 };
}

function textCurve(normalized: string, dimension: "energy" | "bpm") {
  const tolerance = dimension === "energy" ? .12 : 10;
  const values = dimension === "energy" ? { low: .25, mid: .55, high: .85 } : { low: 85, mid: 115, high: 145 };
  if (/peak in the middle|middle peak/.test(normalized)) return { shape: "MIDDLE_PEAK" as const, points: [{ position: 0, value: values.mid }, { position: .5, value: values.high }, { position: 1, value: values.mid }], tolerance, hard: false, confidence: .9 };
  if (/rise and fall|high energy with a cooldown|start slow.*peak fast.*cool down/.test(normalized)) return { shape: "RISE_AND_FALL" as const, points: [{ position: 0, value: values.low }, { position: .65, value: values.high }, { position: 1, value: values.low }], tolerance, hard: false, confidence: .88 };
  if (/fall and rise/.test(normalized)) return { shape: "FALL_AND_RISE" as const, points: [{ position: 0, value: values.high }, { position: .5, value: values.low }, { position: 1, value: values.high }], tolerance, hard: false, confidence: .88 };
  if (/wave like|wave-like|alternate calm and energetic/.test(normalized)) return { shape: "WAVE" as const, points: [{ position: 0, value: values.low }, { position: .25, value: values.high }, { position: .5, value: values.low }, { position: .75, value: values.high }, { position: 1, value: values.mid }], tolerance, hard: false, confidence: .87 };
  if (/slowly build|gradual rise|build energy|build to|gradually (?:speed up|reach)|become more hopeful/.test(normalized)) return { shape: "RISING" as const, points: [{ position: 0, value: values.low }, { position: 1, value: values.high }], tolerance, hard: false, confidence: .9 };
  if (/gradual fall|slow down|wind down|cool down/.test(normalized)) return { shape: "FALLING" as const, points: [{ position: 0, value: values.high }, { position: 1, value: values.low }], tolerance, hard: false, confidence: .88 };
  if (/calm throughout|stay steady|stable energy|no abrupt energy changes|moderate tempo throughout|start strong and stay there/.test(normalized)) return { shape: "FLAT" as const, points: [{ position: 0, value: /strong/.test(normalized) ? values.high : values.mid }, { position: 1, value: /strong/.test(normalized) ? values.high : values.mid }], tolerance, hard: false, confidence: .9 };
  return null;
}

function extractBpm(source: string, normalized: string) {
  const preferences: IntentPreference[] = [];
  let curve = null as StructuredIntent["bpmCurve"];
  const range = normalized.match(/(?:between|from)\s+(\d{2,3})\s*(?:and|to|-)\s*(\d{2,3})\s*bpm/);
  const around = normalized.match(/(?:around|about|roughly|near)\s+(\d{2,3})\s*bpm/);
  const startEnd = normalized.match(/(?:begin|start)\s+(?:around|about|roughly|near)?\s*(\d{2,3})\s*bpm.*(?:finish|end|reach)\s+(?:around|about|roughly|near)?\s*(\d{2,3})\s*bpm/);
  const upper = normalized.match(/(?:nothing|anything)\s+(?:above|over)\s+(\d{2,3})\s*bpm|(?:avoid|never)\s+.*(?:above|over)\s+(\d{2,3})\s*bpm/);
  const lower = normalized.match(/(?:stay|stays|nothing)\s+(?:above|over)\s+(\d{2,3})\s*bpm/);
  const genericMaximum = normalized.match(/\b(?:under|below)\s+(\d{2,3})\s*bpm/);
  const genericMinimum = normalized.match(/\b(?:over|above)\s+(\d{2,3})\s*bpm/);
  if (range) preferences.push(preference({ target: `${range[1]}-${range[2]} BPM`, type: "BPM", strength: strengthFor(range[0]), sourcePhrase: range[0], field: "bpm_range", value: { minimum: Number(range[1]), maximum: Number(range[2]) } }));
  if (around) preferences.push(preference({ target: `around ${around[1]} BPM`, type: "BPM", strength: "PREFERRED", sourcePhrase: around[0], field: "bpm_target", value: Number(around[1]) }));
  if (upper) { const value = Number(upper[1] || upper[2]); preferences.push(preference({ target: `maximum ${value} BPM`, type: "BPM", strength: "REQUIRED", sourcePhrase: upper[0], field: "maximum_bpm", value, kind: "FILTER" })); }
  if (lower) { const value = Number(lower[1]); preferences.push(preference({ target: `minimum ${value} BPM`, type: "BPM", strength: "REQUIRED", sourcePhrase: lower[0], field: "minimum_bpm", value, kind: "FILTER" })); }
  if (genericMaximum && !upper) { const value = Number(genericMaximum[1]); preferences.push(preference({ target: `maximum ${value} BPM`, type: "BPM", strength: SOFT_MARKERS.test(genericMaximum[0]) ? "PREFERRED" : "REQUIRED", sourcePhrase: genericMaximum[0], field: "maximum_bpm", value, kind: "FILTER" })); }
  if (genericMinimum && !lower) { const value = Number(genericMinimum[1]); preferences.push(preference({ target: `minimum ${value} BPM`, type: "BPM", strength: SOFT_MARKERS.test(genericMinimum[0]) ? "PREFERRED" : "REQUIRED", sourcePhrase: genericMinimum[0], field: "minimum_bpm", value, kind: "FILTER" })); }
  if (startEnd) curve = { shape: Number(startEnd[2]) >= Number(startEnd[1]) ? "RISING" : "FALLING", points: [{ position: 0, value: Number(startEnd[1]) }, { position: 1, value: Number(startEnd[2]) }], tolerance: /around|about|roughly|near/.test(startEnd[0]) ? 10 : 6, hard: false, confidence: .96 };
  return { preferences, curve };
}

function extractPreferences(source: string, normalized: string, categories: IntentCategory[]) {
  const positive: IntentPreference[] = [], negative: IntentPreference[] = [];
  const addNegative = (pattern: RegExp, target: string, type: IntentPreference["type"], field: string, value: unknown) => {
    const match = normalized.match(pattern); if (match) negative.push(preference({ target, type, strength: strengthFor(match[0], true), sourcePhrase: match[0], field, value }));
  };
  addNegative(/\b(?:no|avoid|exclude|do not include|don't include)\s+(?:any\s+)?explicit(?: tracks| songs| music)?\b|family safe|family-safe|clean only/, "explicit content", "EXPLICIT", "isExplicit", true);
  addNegative(/\b(?:no|avoid|exclude)\s+live(?: recordings?| tracks?| versions?)?\b/, "live recordings", "LIVE", "isLive", true);
  addNegative(/\b(?:no|avoid|exclude)\s+podcasts?\b/, "podcasts", "MEDIA_TYPE", "media_type", "podcast");
  addNegative(/\b(?:no|avoid|exclude|do not include)\s+christmas(?: music)?\b/, "Christmas music", "HOLIDAY", "isHoliday", true);
  addNegative(/\b(?:no|avoid|exclude)\s+country(?: music)?\b/, "country", "GENRE", "genre", "country");
  addNegative(/\bnot (?:too )?aggressive\b|\bless aggressive\b/, "high aggressiveness", "CATEGORY", "aggressive", true);
  addNegative(/\b(?:without being sleepy|not sleepy|avoid sleepy)\b/, "sleep intent", "CATEGORY", "sleep", true);
  const vocals = normalized.match(/\b(minimal vocals|very little singing|little singing|no vocals|instrumental only|start instrumental|finish with instrumental)\b/);
  if (vocals) {
    const hard = /no vocals|instrumental only/.test(vocals[0]);
    negative.push(preference({ target: hard ? "vocals" : "vocal content", type: "VOCALS", strength: hard ? "EXCLUDED" : "DISCOURAGED", sourcePhrase: vocals[0], field: "vocal_content", value: hard ? "none" : "minimal" }));
  }
  const familiar = normalized.match(/\b(?:preferably|prefer|favor)?\s*familiar (?:songs|tracks|music)\b/);
  if (familiar) positive.push(preference({ target: "familiar tracks", type: "FAMILIARITY", strength: "PREFERRED", sourcePhrase: familiar[0], field: "familiarity", value: "high" }));
  const instrumental = normalized.match(/\b(?:favor|prefer|more)\s+instrumental(?: tracks| music)?\b/);
  if (instrumental) positive.push(preference({ target: "instrumental tracks", type: "INSTRUMENTAL", strength: "PREFERRED", sourcePhrase: instrumental[0], field: "instrumental", value: true }));
  const rating = normalized.match(/\b(?:prioritize|prefer|favor)\s+highly rated(?: tracks| songs)?\b/);
  if (rating) positive.push(preference({ target: "highly rated tracks", type: "RATING", strength: "PREFERRED", sourcePhrase: rating[0], field: "rating", value: "high" }));
  const decade = normalized.match(/\b(?:more|prefer|favor)\s+(19\d0s|20\d0s)(?: music)?\b/);
  if (decade) positive.push(preference({ target: decade[1], type: "DECADE", strength: "PREFERRED", sourcePhrase: decade[0], field: "decade", value: decade[1] }));
  const genre = normalized.match(/\b(?:lean toward|prefer|favor)\s+([a-z][a-z ]{1,30}?)(?: music)?(?:,|\.|$)/);
  if (genre && !/familiar|instrumental|highly rated/.test(genre[1])) positive.push(preference({ target: genre[1].trim(), type: "GENRE", strength: "PREFERRED", sourcePhrase: genre[0], field: "genre", value: genre[1].trim() }));
  const explicitOnly = normalized.match(/\bexplicit only\b|\bonly explicit(?: tracks| music)?\b/);
  if (explicitOnly) positive.push(preference({ target: "explicit only", type: "EXPLICIT", strength: "REQUIRED", sourcePhrase: explicitOnly[0], field: "isExplicit", value: true, kind: "FILTER" }));
  const smooth = normalized.match(/\b(?:no abrupt energy changes|minimal abrupt transitions|smooth transitions?)\b/);
  if (smooth) positive.push(preference({ target: "smooth transitions", type: "TRANSITION", strength: /\bno\b/.test(smooth[0]) ? "REQUIRED" : "PREFERRED", sourcePhrase: smooth[0], field: "transition_smoothness", value: "smooth", kind: "ORDERING" }));
  for (const category of categories) for (const item of PROFILE_SOFT_PREFERENCES[category] || []) {
    if (!positive.some((entry) => entry.target === item.target)) positive.push(preference({ target: item.target, type: item.type, strength: "PREFERRED", sourcePhrase: title(category), confidence: .72, field: item.field, value: item.value }));
  }
  return { positive, negative };
}

function detectConflicts(intent: Pick<StructuredIntent, "categories" | "hardRequirements" | "positivePreferences" | "negativePreferences" | "energyCurve">) {
  const conflicts: StructuredIntent["conflicts"] = [];
  const category = (name: IntentCategory) => intent.categories.find((item) => item.name === name);
  const minBpm = intent.hardRequirements.find((item) => item.deterministicMapping.field === "minimum_bpm");
  const maxBpm = intent.hardRequirements.find((item) => item.deterministicMapping.field === "maximum_bpm");
  if (minBpm && maxBpm && Number(minBpm.deterministicMapping.value) > Number(maxBpm.deterministicMapping.value)) conflicts.push({ id: id("conflict"), type: "HARD_CONFLICT", itemIds: [minBpm.id, maxBpm.id], explanation: "The minimum BPM is higher than the maximum BPM.", suggestion: "Widen the BPM range or remove one limit.", resolution: null });
  if (category("sleep") && minBpm && Number(minBpm.deterministicMapping.value) >= 140) conflicts.push({ id: id("conflict"), type: "HARD_CONFLICT", itemIds: [category("sleep")!.name, minBpm.id], explanation: "Sleep intent normally targets very low energy and slower tempo, but the approved minimum BPM is very high.", suggestion: "Lower or soften the BPM minimum, or remove the sleep intent.", resolution: null });
  if (category("relaxing") && category("aggressive")) conflicts.push({ id: id("conflict"), type: "SOFT_TENSION", itemIds: ["relaxing", "aggressive"], explanation: "Relaxing and aggressive characteristics pull the scoring targets in opposite directions.", suggestion: "Choose one as primary or scope aggressiveness to a peak phase.", resolution: null });
  const explicitOnly = intent.hardRequirements.find((item) => item.target === "explicit only"), clean = intent.hardRequirements.find((item) => item.type === "EXPLICIT" && item.strength === "EXCLUDED");
  if (explicitOnly && clean) conflicts.push({ id: id("conflict"), type: "HARD_CONFLICT", itemIds: [explicitOnly.id, clean.id], explanation: "Explicit-only and clean-only requirements cannot both be satisfied.", suggestion: "Remove one content requirement.", resolution: null });
  return conflicts;
}

export function interpretIntentLocally(input: { text: string; dictionaries?: RuntimeDictionaryMapping[]; maximumPhases?: number }): StructuredIntent {
  const source = input.text.trim().slice(0, 10_000), normalized = normalizeIntentPhrase(source);
  const matches = matchDefinitions(source, input.dictionaries || []);
  const categoryMap = new Map<IntentCategory, StructuredIntent["categories"][number]>();
  let dictionaryMatched = false;
  for (const match of matches) {
    const definition = dictionaryDefinitionSchema.parse(match.definition);
    dictionaryMatched ||= match.source !== "SAVED_PRESET";
    for (const name of definition.categories) {
      const existing = categoryMap.get(name);
      const next = { name, weight: definition.categories.length > 1 ? .75 : .9, confidence: match.confidence, sourcePhrase: match.matchedPhrase, source: match.source === "SAVED_PRESET" ? "BUILT_IN" as const : match.source };
      if (!existing || next.confidence > existing.confidence) categoryMap.set(name, next);
    }
  }
  const categories = Array.from(categoryMap.values());
  const phases = buildPhases(source, Math.min(6, Math.max(2, input.maximumPhases || 6)));
  const extracted = extractPreferences(source, normalized, categories.map((item) => item.name));
  for (const match of matches.filter((entry) => entry.source !== "SAVED_PRESET")) {
    const definition = dictionaryDefinitionSchema.parse(match.definition);
    extracted.positive.push(...definition.positivePreferences, ...definition.softPreferences.filter((item) => ["PREFERRED", "NEUTRAL"].includes(item.strength)));
    extracted.negative.push(...definition.negativePreferences, ...definition.hardRequirements.filter((item) => ["DISCOURAGED", "EXCLUDED"].includes(item.strength)));
  }
  const bpm = extractBpm(source, normalized);
  for (const item of bpm.preferences) (item.strength === "REQUIRED" || item.strength === "EXCLUDED" ? extracted.negative : extracted.positive).push(item);
  const allPreferences = [...extracted.positive, ...extracted.negative];
  const hardRequirements = allPreferences.filter((item) => item.strength === "REQUIRED" || item.strength === "EXCLUDED");
  const softPreferences = allPreferences.filter((item) => item.strength === "PREFERRED" || item.strength === "DISCOURAGED");
  let energyCurve = curveFromPhases(phases, "energy") || textCurve(normalized, "energy");
  let bpmCurve = bpm.curve || curveFromPhases(phases, "bpm") || (/speed up|slow down|tempo throughout/.test(normalized) ? textCurve(normalized, "bpm") : null);
  if (/begin (?:around )?95 bpm.*(?:reach|finish).*130 bpm/.test(normalized)) bpmCurve = { shape: "RISING", points: [{ position: 0, value: 95 }, { position: 1, value: 130 }], tolerance: 10, hard: false, confidence: .98 };
  const warnings: string[] = [];
  if (/ten minute cool ?down/.test(normalized)) warnings.push("The cooldown is represented as a 20% phase; an exact ten-minute duration depends on the final playlist duration and track lengths.");
  if (allPreferences.some((item) => item.deterministicMapping.kind === "UNAVAILABLE")) warnings.push("One or more requested dimensions are unavailable in current library metadata and will not be enforced.");
  if (categories.length === 0 && phases.length === 0 && allPreferences.length === 0 && !energyCurve && !bpmCurve) warnings.push("No high-confidence canonical intent was recognized; review and add preferences before generation.");
  const draft = { categories, hardRequirements, positivePreferences: extracted.positive, negativePreferences: extracted.negative, energyCurve };
  const conflicts = detectConflicts(draft);
  const confidenceInputs = [...categories.map((item) => item.confidence), ...allPreferences.map((item) => item.confidence), ...phases.map((item) => item.confidence)];
  const overallConfidence = confidenceInputs.length ? round(confidenceInputs.reduce((sum, value) => sum + value, 0) / confidenceInputs.length, 2) : .35;
  const requiresReview = conflicts.some((item) => item.type === "HARD_CONFLICT" && !item.resolution) || overallConfidence < .6 || hardRequirements.some((item) => item.classificationConfidence < .8);
  const categorySummary = categories.slice(0, 4).map((item) => title(item.name)).join(", ");
  const phaseSummary = phases.length > 1 ? `${phases.length}-phase progression` : "single-flow playlist";
  return structuredIntentSchema.parse({
    schemaVersion: 1, sourceText: source,
    summary: categorySummary ? `${categorySummary} ${phaseSummary.toLowerCase()} interpreted locally.` : `A ${phaseSummary} with editable deterministic targets.`,
    categories, phases, positivePreferences: extracted.positive, negativePreferences: extracted.negative, hardRequirements, softPreferences,
    energyCurve, bpmCurve, conflicts, warnings, overallConfidence, phaseBoundaryConfidence: phases.length > 1 ? .84 : .5,
    requiresReview, interpretationSource: dictionaryMatched ? "LOCAL_DICTIONARY" : "LOCAL_RULES",
    matchedPhrases: matches.map((match) => ({ phrase: match.matchedPhrase, normalizedPhrase: match.normalizedPhrase, source: match.source === "SAVED_PRESET" ? "BUILT_IN" : match.source, confidence: match.confidence })),
  });
}

export function resolveIntentConflict(intentValue: unknown, conflictId: string, resolution: NonNullable<StructuredIntent["conflicts"][number]["resolution"]>) {
  const intent = structuredIntentSchema.parse(intentValue);
  if (!intent.conflicts.some((item) => item.id === conflictId)) throw Object.assign(new Error("Intent conflict not found."), { code: "CONFLICT_NOT_FOUND", status: 404 });
  const conflicts = intent.conflicts.map((item) => item.id === conflictId ? { ...item, resolution } : item);
  return structuredIntentSchema.parse({ ...intent, conflicts, requiresReview: conflicts.some((item) => item.type === "HARD_CONFLICT" && !item.resolution) });
}
