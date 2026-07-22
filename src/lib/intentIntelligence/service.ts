import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { isUserAdmin } from "../auth";
import { interpretNaturalLanguage } from "../naturalLanguageRequests/interpreter";
import { adaptIntentToDeterministicInputs } from "./adapter";
import { interpretIntentLocally, normalizeIntentPhrase, resolveIntentConflict, type RuntimeDictionaryMapping } from "./interpreter";
import {
  dictionaryDefinitionSchema, dictionaryEntryInputSchema, intentPresetInputSchema, intentSettingsInputSchema,
  interpretIntentRequestSchema, structuredIntentSchema, type StructuredIntent,
} from "./contracts";

export const INTENT_PERMISSIONS = [
  "intent.interpret", "intent.generate", "intent.edit", "intent.view_explanation", "intent_dictionary.view",
  "intent_dictionary.create", "intent_dictionary.edit_own", "intent_dictionary.delete_own", "intent_dictionary.manage_household",
  "intent_presets.view", "intent_presets.create", "intent_presets.edit_own", "intent_presets.delete_own", "intent_presets.share", "intent_ai.use",
] as const;

const json = (value: unknown) => value as Prisma.InputJsonValue;
const error = (code: string, message: string, status = 400) => Object.assign(new Error(message), { code, status });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function requireUser(userId: string) {
  if (!userId) throw error("UNAUTHORIZED", "Unauthorized", 401);
  if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw error("UNAUTHORIZED", "Unauthorized", 401);
}

async function canAccessHousehold(userId: string, householdId: string | null, manage = false) {
  if (!householdId) return true;
  const household = await prisma.household.findUnique({ where: { id: householdId }, select: { ownerId: true, members: { where: { userId, isActive: true }, select: { memberType: true } } } });
  if (!household) return false;
  if (household.ownerId === userId || await isUserAdmin(userId)) return true;
  if (manage) return household.members.some((member) => member.memberType === "ADMIN");
  return household.members.length > 0;
}

async function runtimeDictionaries(userId: string): Promise<RuntimeDictionaryMapping[]> {
  const settings = await getIntentSettings(userId);
  if (!settings.personalDictionariesEnabled && !settings.householdDictionariesEnabled) return [];
  const rows = await prisma.intentDictionaryEntry.findMany({ where: { enabled: true, OR: [
    ...(settings.personalDictionariesEnabled ? [{ ownerId: userId }] : []),
    ...(settings.householdDictionariesEnabled ? [{ household: { members: { some: { userId, isActive: true } } }, visibility: "HOUSEHOLD" }] : []),
    { visibility: "ADMIN" },
  ] }, orderBy: [{ priority: "desc" }, { updatedAt: "desc" }], take: 500 });
  return rows.map((row) => ({ id: row.id, phrase: row.phrase, aliases: Array.isArray(row.aliasesJson) ? row.aliasesJson.filter((item): item is string => typeof item === "string") : [], definition: dictionaryDefinitionSchema.parse(row.definitionJson), source: row.visibility === "PERSONAL" ? "PERSONAL_DICTIONARY" : row.visibility === "HOUSEHOLD" ? "HOUSEHOLD_DICTIONARY" : "ADMIN_DICTIONARY", priority: row.priority }));
}

export async function getIntentSettings(userId: string) {
  await requireUser(userId);
  return prisma.intentInterpretationSetting.upsert({ where: { userId }, create: { userId }, update: {} });
}

export async function updateIntentSettings(userId: string, raw: unknown) {
  await requireUser(userId); const input = intentSettingsInputSchema.parse(raw);
  return prisma.intentInterpretationSetting.upsert({ where: { userId }, create: { userId, ...input }, update: input });
}

export async function interpretAndStoreIntent(userId: string, raw: unknown) {
  await requireUser(userId); const input = interpretIntentRequestSchema.parse(raw), settings = await getIntentSettings(userId);
  if (!settings.enabled || !settings.localEnabled) throw error("INTERPRETATION_UNAVAILABLE", "Local intent interpretation is disabled.", 409);
  let intent = interpretIntentLocally({ text: input.text, dictionaries: await runtimeDictionaries(userId), maximumPhases: settings.maximumPhases });
  let providerConfigId: string | undefined;
  const providerAttempted = input.providerAssistance && settings.providerAssistanceEnabled && input.privacyMode !== "LOCAL_ONLY";
  if (providerAttempted) {
    const enhanced = await interpretNaturalLanguage({ userId, requestText: input.text, privacyMode: input.privacyMode });
    intent = enhanced.interpretation.structuredIntent || intent;
    providerConfigId = enhanced.response.providerId;
  }
  const adapter = adaptIntentToDeterministicInputs(intent);
  if (!input.persist) return { intent, adapter, privacy: { customTerminologyResolvedLocally: intent.matchedPhrases.some((item) => item.source !== "BUILT_IN"), sentToProvider: providerAttempted, privateDefinitionsSent: false } };
  const row = await prisma.intentInterpretation.create({ data: {
    ownerId: userId, schemaVersion: intent.schemaVersion, sourceText: input.retainSourceText && settings.retainSourceText ? input.text : null,
    sourceTextHash: hash(input.text), sourceRetained: input.retainSourceText && settings.retainSourceText, summary: intent.summary,
    status: intent.requiresReview || settings.reviewRequired ? "NEEDS_REVIEW" : "READY", interpretationSource: intent.interpretationSource,
    structuredIntentJson: json(intent), adapterOutputJson: json(adapter), providerConfigId, overallConfidence: intent.overallConfidence, requiresReview: intent.requiresReview || settings.reviewRequired,
  } });
  await prisma.intentAuditEvent.create({ data: { interpretationId: row.id, actorId: userId, action: "LOCAL_INTERPRETATION_COMPLETED", summaryJson: json({ categories: intent.categories.map((item) => item.name), phaseCount: intent.phases.length, conflicts: intent.conflicts.length, customTerminologyResolvedLocally: intent.interpretationSource === "LOCAL_DICTIONARY" }) } });
  return { id: row.id, intent, adapter, privacy: { customTerminologyResolvedLocally: intent.matchedPhrases.some((item) => item.source !== "BUILT_IN"), sentToProvider: providerAttempted, privateDefinitionsSent: false } };
}

export async function getIntent(userId: string, intentId: string) {
  await requireUser(userId); const row = await prisma.intentInterpretation.findFirst({ where: { id: intentId, ownerId: userId, deletedAt: null }, include: { auditEvents: { orderBy: { createdAt: "desc" }, take: 100 } } });
  if (!row) throw error("INTENT_NOT_FOUND", "Intent interpretation not found.", 404);
  return { ...row, sourceText: row.sourceRetained ? row.sourceText : null, structuredIntent: structuredIntentSchema.parse(row.structuredIntentJson), approvedIntent: row.approvedIntentJson ? structuredIntentSchema.parse(row.approvedIntentJson) : null, structuredIntentJson: undefined, approvedIntentJson: undefined };
}

export async function updateIntent(userId: string, intentId: string, raw: unknown) {
  const row = await getIntent(userId, intentId); const source = raw as any;
  if (source.updatedAt && new Date(source.updatedAt).getTime() !== new Date(row.updatedAt).getTime()) throw error("STALE_UPDATE", "This interpretation changed since it was loaded.", 409);
  let intent = structuredIntentSchema.parse(source.intent ?? source);
  if (source.conflictId && source.resolution) intent = resolveIntentConflict(intent, source.conflictId, source.resolution);
  const adapter = adaptIntentToDeterministicInputs(intent);
  const updated = await prisma.intentInterpretation.update({ where: { id: intentId }, data: { summary: intent.summary, structuredIntentJson: json(intent), adapterOutputJson: json(adapter), overallConfidence: intent.overallConfidence, requiresReview: intent.requiresReview, status: intent.requiresReview ? "NEEDS_REVIEW" : "READY", revision: { increment: 1 }, approvedIntentJson: undefined, approvedById: null, approvedAt: null } });
  await prisma.intentAuditEvent.create({ data: { interpretationId: intentId, actorId: userId, action: source.conflictId ? "CONFLICT_RESOLVED" : "INTERPRETATION_EDITED", summaryJson: json({ revision: updated.revision }) } });
  return getIntent(userId, intentId);
}

export async function deleteIntent(userId: string, intentId: string) {
  await getIntent(userId, intentId); await prisma.intentInterpretation.update({ where: { id: intentId }, data: { deletedAt: new Date(), status: "DELETED" } }); return { deleted: true };
}

export async function validateIntent(raw: unknown) {
  const intent = structuredIntentSchema.parse((raw as any)?.intent ?? raw), adapter = adaptIntentToDeterministicInputs(intent);
  return { valid: true, requiresReview: intent.requiresReview, conflicts: intent.conflicts, adapter };
}

export async function estimateIntentCoverage(userId: string, raw: unknown) {
  await requireUser(userId); const intent = structuredIntentSchema.parse((raw as any)?.intent ?? raw);
  const baseWhere: Prisma.TrackWhereInput = { syncStatus: "active", library: { server: { userId } } };
  const total = await prisma.track.count({ where: baseWhere });
  const explicit = intent.hardRequirements.some((item) => item.type === "EXPLICIT" && item.strength === "EXCLUDED");
  const live = intent.hardRequirements.some((item) => item.type === "LIVE" && item.strength === "EXCLUDED");
  const min = intent.hardRequirements.find((item) => item.deterministicMapping.field === "minimum_bpm")?.deterministicMapping.value;
  const max = intent.hardRequirements.find((item) => item.deterministicMapping.field === "maximum_bpm")?.deterministicMapping.value;
  const where: Prisma.TrackWhereInput = { ...baseWhere, ...(explicit ? { isExplicit: false } : {}), ...(live ? { isLive: false } : {}), ...((Number.isFinite(Number(min)) || Number.isFinite(Number(max))) ? { OR: [{ effectiveBpm: { ...(Number.isFinite(Number(min)) ? { gte: Number(min) } : {}), ...(Number.isFinite(Number(max)) ? { lte: Number(max) } : {}) } }, { bpm: { ...(Number.isFinite(Number(min)) ? { gte: Number(min) } : {}), ...(Number.isFinite(Number(max)) ? { lte: Number(max) } : {}) } }] } : {}) };
  const [hardMatches, bpmKnown, energyKnown] = await Promise.all([prisma.track.count({ where }), prisma.track.count({ where: { ...baseWhere, OR: [{ effectiveBpm: { not: null } }, { bpm: { not: null } }] } }), prisma.track.count({ where: { ...baseWhere, audioFeature: { effectiveEnergy: { not: null } } } })]);
  const ratio = total ? hardMatches / total : 0, state = total === 0 ? "INSUFFICIENT_MATCH" : ratio >= .6 ? "STRONG_MATCH" : ratio >= .35 ? "GOOD_MATCH" : ratio >= .12 ? "LIMITED_MATCH" : "INSUFFICIENT_MATCH";
  const phaseEstimate = intent.phases.map((phase) => ({ phaseId: phase.id, label: phase.label, state: energyKnown === 0 && phase.energy ? "UNKNOWN_MISSING_METADATA" : state, approximateCandidates: Math.round(hardMatches * Math.max(.25, phase.targetShare)) }));
  const result = { state, totalTracks: total, hardRequirementMatches: hardMatches, bpmMetadataCoverage: total ? bpmKnown / total : 0, energyMetadataCoverage: total ? energyKnown / total : 0, phases: phaseEstimate, suggestions: [...(ratio < .12 ? ["Widen BPM ranges or soften one exclusion."] : []), ...(intent.phases.length && energyKnown < total * .4 ? ["Run audio feature analysis or allow tracks with missing energy metadata."] : [])], disclaimer: "Coverage is an estimate, not a promise of playlist quality." };
  const intentId = (raw as any)?.id; if (intentId) await prisma.intentInterpretation.updateMany({ where: { id: intentId, ownerId: userId }, data: { coverageEstimateJson: json(result) } });
  return result;
}

export async function applyIntent(userId: string, intentId: string, raw: unknown = {}) {
  const row = await getIntent(userId, intentId), intent = structuredIntentSchema.parse((raw as any).intent || row.structuredIntent);
  const adapter = adaptIntentToDeterministicInputs(intent), approvedAt = new Date();
  await prisma.intentInterpretation.update({ where: { id: intentId }, data: { approvedIntentJson: json(intent), adapterOutputJson: json(adapter), status: "APPROVED", approvedById: userId, approvedAt, requiresReview: false } });
  await prisma.intentAuditEvent.create({ data: { interpretationId: intentId, actorId: userId, action: "INTERPRETATION_APPROVED", summaryJson: json({ deterministicTrackSelection: true }) } });
  return { id: intentId, approvedAt, adapter, deterministicTrackSelection: true };
}

export async function listDictionary(userId: string, page = 1, pageSize = 50) {
  await requireUser(userId); page = Math.max(1, page); pageSize = Math.min(100, Math.max(1, pageSize));
  const where: Prisma.IntentDictionaryEntryWhereInput = { OR: [{ ownerId: userId }, { household: { members: { some: { userId, isActive: true } } }, visibility: "HOUSEHOLD" }, { visibility: "ADMIN" }] };
  const [entries, total] = await Promise.all([prisma.intentDictionaryEntry.findMany({ where, orderBy: [{ priority: "desc" }, { updatedAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }), prisma.intentDictionaryEntry.count({ where })]);
  return { entries: entries.map((entry) => ({ ...entry, definition: dictionaryDefinitionSchema.parse(entry.definitionJson), aliases: entry.aliasesJson, definitionJson: undefined, aliasesJson: undefined, canEdit: entry.ownerId === userId })), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export async function createDictionaryEntry(userId: string, raw: unknown) {
  await requireUser(userId); const input = dictionaryEntryInputSchema.parse(raw);
  if (input.visibility !== "PERSONAL" && !(await canAccessHousehold(userId, input.householdId, true)) && !(await isUserAdmin(userId))) throw error("PRESET_ACCESS_DENIED", "You cannot share terminology with this household.", 403);
  try { const entry = await prisma.intentDictionaryEntry.create({ data: { ownerId: userId, householdId: input.visibility === "PERSONAL" ? null : input.householdId, phrase: input.phrase, normalizedPhrase: normalizeIntentPhrase(input.phrase), aliasesJson: json(input.aliases), description: input.description, definitionJson: json(input.definition), visibility: input.visibility, enabled: input.enabled, priority: input.priority } }); await prisma.intentAuditEvent.create({ data: { actorId: userId, action: "DICTIONARY_ENTRY_CREATED", summaryJson: json({ entryId: entry.id, visibility: entry.visibility }) } }); return entry; } catch (caught: any) { if (caught?.code === "P2002") throw error("DICTIONARY_PHRASE_CONFLICT", "A personal dictionary entry already uses this phrase.", 409); throw caught; }
}

export async function updateDictionaryEntry(userId: string, entryId: string, raw: unknown) {
  const existing = await prisma.intentDictionaryEntry.findUnique({ where: { id: entryId } }); if (!existing) throw error("DICTIONARY_ENTRY_NOT_FOUND", "Dictionary entry not found.", 404);
  if (existing.ownerId !== userId && !(await isUserAdmin(userId))) throw error("PRESET_ACCESS_DENIED", "You cannot edit this dictionary entry.", 403);
  const input = dictionaryEntryInputSchema.parse(raw); if (input.updatedAt && new Date(input.updatedAt).getTime() !== existing.updatedAt.getTime()) throw error("STALE_UPDATE", "This dictionary entry changed since it was loaded.", 409);
  return prisma.intentDictionaryEntry.update({ where: { id: entryId }, data: { householdId: input.visibility === "PERSONAL" ? null : input.householdId, phrase: input.phrase, normalizedPhrase: normalizeIntentPhrase(input.phrase), aliasesJson: json(input.aliases), description: input.description, definitionJson: json(input.definition), visibility: input.visibility, enabled: input.enabled, priority: input.priority } });
}

export async function deleteDictionaryEntry(userId: string, entryId: string) { const row = await prisma.intentDictionaryEntry.findUnique({ where: { id: entryId } }); if (!row) throw error("DICTIONARY_ENTRY_NOT_FOUND", "Dictionary entry not found.", 404); if (row.ownerId !== userId && !(await isUserAdmin(userId))) throw error("PRESET_ACCESS_DENIED", "You cannot delete this dictionary entry.", 403); await prisma.intentDictionaryEntry.delete({ where: { id: entryId } }); await prisma.intentAuditEvent.create({ data: { actorId: userId, action: "DICTIONARY_ENTRY_DELETED", summaryJson: json({ entryId }) } }); return { deleted: true }; }

export async function listPresets(userId: string) { await requireUser(userId); const presets = await prisma.intentPreset.findMany({ where: { OR: [{ ownerId: userId }, { household: { members: { some: { userId, isActive: true } } }, visibility: "HOUSEHOLD" }] }, orderBy: { updatedAt: "desc" } }); return { presets: presets.map((preset) => ({ ...preset, intent: structuredIntentSchema.parse(preset.intentJson), intentJson: undefined, canEdit: preset.ownerId === userId })) }; }
export async function createPreset(userId: string, raw: unknown) { await requireUser(userId); const input = intentPresetInputSchema.parse(raw); if (input.visibility === "HOUSEHOLD" && !(await canAccessHousehold(userId, input.householdId, true))) throw error("PRESET_ACCESS_DENIED", "You cannot share presets with this household.", 403); const preset = await prisma.intentPreset.create({ data: { ownerId: userId, householdId: input.visibility === "HOUSEHOLD" ? input.householdId : null, name: input.name, description: input.description, intentJson: json(input.intent), visibility: input.visibility, enabled: input.enabled } }); await prisma.intentAuditEvent.create({ data: { actorId: userId, action: "PRESET_CREATED", summaryJson: json({ presetId: preset.id, visibility: preset.visibility }) } }); return preset; }
export async function updatePreset(userId: string, presetId: string, raw: unknown) { const existing = await prisma.intentPreset.findUnique({ where: { id: presetId } }); if (!existing) throw error("PRESET_NOT_FOUND", "Intent preset not found.", 404); if (existing.ownerId !== userId && !(await isUserAdmin(userId))) throw error("PRESET_ACCESS_DENIED", "You cannot edit this preset.", 403); const input = intentPresetInputSchema.parse(raw); if (input.updatedAt && new Date(input.updatedAt).getTime() !== existing.updatedAt.getTime()) throw error("STALE_UPDATE", "This preset changed since it was loaded.", 409); return prisma.intentPreset.update({ where: { id: presetId }, data: { householdId: input.visibility === "HOUSEHOLD" ? input.householdId : null, name: input.name, description: input.description, intentJson: json(input.intent), visibility: input.visibility, enabled: input.enabled } }); }
export async function deletePreset(userId: string, presetId: string) { const row = await prisma.intentPreset.findUnique({ where: { id: presetId } }); if (!row) throw error("PRESET_NOT_FOUND", "Intent preset not found.", 404); if (row.ownerId !== userId && !(await isUserAdmin(userId))) throw error("PRESET_ACCESS_DENIED", "You cannot delete this preset.", 403); await prisma.intentPreset.delete({ where: { id: presetId } }); return { deleted: true }; }
export async function applyPreset(userId: string, presetId: string) { const { presets } = await listPresets(userId); const preset = presets.find((item) => item.id === presetId); if (!preset) throw error("PRESET_NOT_FOUND", "Intent preset not found or access denied.", 404); const adapter = adaptIntentToDeterministicInputs(preset.intent); await prisma.intentAuditEvent.create({ data: { actorId: userId, action: "PRESET_APPLIED", summaryJson: json({ presetId }) } }); return { preset, adapter }; }
