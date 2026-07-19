import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { APP_VERSION_NUMBER } from "../appVersion";
import { normalizeOrchestrationSettings } from "./settings";
import { redactSecrets } from "./dashboardCore";

export const ORCHESTRATION_EXPORT_SCHEMA_VERSION = 1;

const importSchema = z.object({
  format: z.literal("mixarr-orchestration"),
  schemaVersion: z.literal(ORCHESTRATION_EXPORT_SCHEMA_VERSION),
  metadata: z.object({ exportedAt: z.string().datetime(), mixarrVersion: z.string(), includedSections: z.array(z.string()), excludedSections: z.array(z.string()).optional() }).passthrough(),
  sections: z.object({
    runtime: z.record(z.unknown()),
    preference: z.record(z.unknown()).nullable(),
    managedPlaylists: z.array(z.object({ playlistId: z.string(), displayName: z.string(), generatedPlaylistRatingKey: z.string().nullable(), libraryPlexId: z.string(), serverMachineIdentifier: z.string(), enabled: z.boolean(), automationEnabled: z.boolean(), priority: z.enum(["HIGH", "NORMAL", "LOW"]), orchestrationMode: z.enum(["COORDINATED", "OBSERVE_ONLY", "DRY_RUN_ONLY"]) })).max(1_000),
    playlistGroups: z.array(z.object({ name: z.string().min(1).max(200), description: z.string(), isPaused: z.boolean(), settings: z.unknown(), schedule: z.unknown().nullable(), playlistRatingKeys: z.array(z.string()).max(1_000) })).max(200),
    relationships: z.array(z.object({ sourcePlaylistId: z.string(), targetPlaylistId: z.string(), relationshipType: z.enum(["DEPENDS_ON", "RUNS_AFTER", "RELATED"]), enabled: z.boolean(), priority: z.number().int().min(-100).max(100) })).max(5_000),
    overlapPolicies: z.array(z.object({ playlistARatingKey: z.string().nullable(), playlistBRatingKey: z.string().nullable(), ignored: z.boolean(), allowedTrackOverlapPercent: z.number().nullable(), allowedArtistOverlapPercent: z.number().nullable(), allowedAlbumOverlapPercent: z.number().nullable(), maximumSharedTrackCount: z.number().int().nullable(), notes: z.string().nullable() })).max(5_000),
    crossPlaylistVariety: z.record(z.unknown()).nullable(),
    smartActionPreferences: z.record(z.unknown()).nullable(),
    smartActionPolicies: z.array(z.record(z.unknown())).max(500),
    experimentDefaults: z.record(z.unknown()).nullable(),
    healthThresholds: z.record(z.unknown()).nullable(),
  }).strict(),
}).strict();

export type OrchestrationImport = z.infer<typeof importSchema>;

function plain<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function sourceIdentifier(userId: string) { return createHash("sha256").update(`mixarr:${userId}`).digest("hex").slice(0, 16); }
function allow(value: unknown, keys: string[]) { const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])); }

export async function exportOrchestrationConfiguration(userId: string) {
  const [runtimeRow, preference, managed, groups, relationships, pairPolicies, variety, actionSettings, actionPolicies, experimentSettings, healthSettings] = await Promise.all([
    prisma.systemState.findUnique({ where: { key: "playlistOrchestrationSettings" }, select: { value: true } }),
    prisma.orchestrationPreference.findUnique({ where: { userId } }),
    prisma.managedPlaylist.findMany({ where: { userId }, select: { playlistId: true, displayName: true, enabled: true, automationEnabled: true, priority: true, orchestrationMode: true, generatedPlaylist: { select: { plexPlaylistRatingKey: true } }, library: { select: { plexId: true, server: { select: { machineIdentifier: true } } } } } }),
    prisma.playlistGroup.findMany({ where: { userId }, orderBy: { sortOrder: "asc" }, select: { name: true, description: true, isPaused: true, settingsJson: true, scheduleJson: true, memberships: { orderBy: { sortOrder: "asc" }, select: { playlist: { select: { plexPlaylistRatingKey: true } } } } } }),
    prisma.managedPlaylistRelationship.findMany({ where: { sourceManagedPlaylist: { userId } }, select: { sourceManagedPlaylist: { select: { playlistId: true } }, targetManagedPlaylist: { select: { playlistId: true } }, relationshipType: true, enabled: true, priority: true } }),
    prisma.playlistPairPolicy.findMany({ where: { userId }, select: { ignored: true, allowedTrackOverlapPercent: true, allowedArtistOverlapPercent: true, allowedAlbumOverlapPercent: true, maximumSharedTrackCount: true, notes: true, playlistA: { select: { plexPlaylistRatingKey: true } }, playlistB: { select: { plexPlaylistRatingKey: true } } } }),
    prisma.crossPlaylistVarietySetting.findUnique({ where: { userId } }),
    prisma.smartActionSetting.findUnique({ where: { userId }, select: { enabled: true, generateDuringNightlySync: true, generateAfterPlaylistCreation: true, generateAfterMetadataAnalysis: true, minimumConfidenceToDisplay: true, highConfidenceThreshold: true, mediumConfidenceThreshold: true, maximumPendingActions: true, expireAfterDays: true, recommendationTypesJson: true, maintenanceEnabled: true, maintenanceStartTime: true, maintenanceDaysJson: true, maximumActionsPerWindow: true, maximumPlaylistsPerWindow: true, maximumConcurrentActions: true, allowPlexRefreshes: true, allowMetadataChanges: true, allowPlaylistRegeneration: true, pauseDuringPlayback: true, automationEmergencyDisabled: true } }),
    prisma.smartActionAutomationPolicy.findMany({ where: { userId }, select: { actionType: true, enabled: true, minimumConfidence: true, maximumRisk: true, maximumPerWindow: true } }),
    prisma.smartExperimentSetting.findUnique({ where: { userId }, select: { enabled: true, defaultDurationType: true, defaultDurationTarget: true, defaultPublicationMode: true, minimumPlaybackSessions: true, minimumTrackInteractions: true, minimumDurationHours: true, minimumResultDifference: true, minimumConfidence: true, allowPlaybackMetrics: true, automaticallyEvaluate: true, automaticallyPauseMissingPlaylists: true, historyRetentionDays: true, showAdvancedControls: true, allowMultiVariableExperiments: true, notificationsEnabled: true } }),
    prisma.playlistHealthSetting.findUnique({ where: { userId }, select: { enabled: true, analyzeDuringNightlySync: true, staleAfterDays: true, artistConcentrationPercent: true, albumConcentrationPercent: true, excessiveBpmJump: true, moodConflictDelta: true, metadataDeclinePercent: true, minimumAlertSeverity: true, inAppNotifications: true } }),
  ]);
  let runtime: unknown = {};
  try { runtime = runtimeRow ? JSON.parse(runtimeRow.value) : {}; } catch { runtime = {}; }
  const sections = {
    runtime: normalizeOrchestrationSettings(runtime),
    preference: preference ? { dashboardTimeRange: preference.dashboardTimeRange, onboardingStep: preference.onboardingStep, onboardingComplete: preference.onboardingComplete, automationLevel: preference.automationLevel, goals: preference.goalsJson, safetySettings: preference.safetySettingsJson, dashboard: preference.dashboardJson } : null,
    managedPlaylists: managed.map((item) => ({ playlistId: item.playlistId, displayName: item.displayName, generatedPlaylistRatingKey: item.generatedPlaylist?.plexPlaylistRatingKey || null, libraryPlexId: item.library.plexId, serverMachineIdentifier: item.library.server.machineIdentifier, enabled: item.enabled, automationEnabled: item.automationEnabled, priority: item.priority, orchestrationMode: item.orchestrationMode })),
    playlistGroups: groups.map((group) => ({ name: group.name, description: group.description, isPaused: group.isPaused, settings: group.settingsJson, schedule: group.scheduleJson, playlistRatingKeys: group.memberships.map((item) => item.playlist.plexPlaylistRatingKey).filter((key): key is string => Boolean(key)) })),
    relationships: relationships.map((item) => ({ sourcePlaylistId: item.sourceManagedPlaylist.playlistId, targetPlaylistId: item.targetManagedPlaylist.playlistId, relationshipType: item.relationshipType, enabled: item.enabled, priority: item.priority })),
    overlapPolicies: pairPolicies.map((item) => ({ playlistARatingKey: item.playlistA.plexPlaylistRatingKey, playlistBRatingKey: item.playlistB.plexPlaylistRatingKey, ignored: item.ignored, allowedTrackOverlapPercent: item.allowedTrackOverlapPercent, allowedArtistOverlapPercent: item.allowedArtistOverlapPercent, allowedAlbumOverlapPercent: item.allowedAlbumOverlapPercent, maximumSharedTrackCount: item.maximumSharedTrackCount, notes: item.notes })),
    crossPlaylistVariety: variety ? plain(variety) : null,
    smartActionPreferences: actionSettings ? plain(actionSettings) : null,
    smartActionPolicies: plain(actionPolicies), experimentDefaults: experimentSettings ? plain(experimentSettings) : null, healthThresholds: healthSettings ? plain(healthSettings) : null,
  };
  return redactSecrets({ format: "mixarr-orchestration", schemaVersion: ORCHESTRATION_EXPORT_SCHEMA_VERSION, metadata: { mixarrVersion: APP_VERSION_NUMBER, exportedAt: new Date().toISOString(), sourceInstallationId: sourceIdentifier(userId), includedSections: Object.keys(sections), excludedSections: ["Plex credentials", "access tokens", "API keys", "sessions", "encrypted notification endpoints", "private encryption material"] }, sections });
}

export function parseOrchestrationImport(value: unknown) { return importSchema.parse(redactSecrets(value)); }

export async function previewOrchestrationImport(userId: string, value: unknown, mode: "merge" | "replace" | "preview" = "preview") {
  const document = parseOrchestrationImport(value);
  const ratingKeys = Array.from(new Set([...document.sections.managedPlaylists.map((item) => item.generatedPlaylistRatingKey).filter((key): key is string => Boolean(key)), ...document.sections.playlistGroups.flatMap((group) => group.playlistRatingKeys)]));
  const [playlists, groups, managed] = await Promise.all([
    prisma.generatedPlaylist.findMany({ where: { userId, plexPlaylistRatingKey: { in: ratingKeys } }, select: { id: true, plexPlaylistRatingKey: true, plexPlaylistTitle: true } }),
    prisma.playlistGroup.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.managedPlaylist.findMany({ where: { userId }, select: { id: true, playlistId: true } }),
  ]);
  const found = new Set(playlists.map((item) => item.plexPlaylistRatingKey));
  const missingPlaylists = ratingKeys.filter((key) => !found.has(key));
  const groupNames = new Set(groups.map((group) => group.name.toLowerCase()));
  const managedIds = new Set(managed.map((item) => item.playlistId));
  const conflicts = [
    ...document.sections.playlistGroups.filter((group) => groupNames.has(group.name.toLowerCase())).map((group) => ({ type: "GROUP_UPDATE", name: group.name, resolution: mode === "replace" ? "replace orchestration-owned fields" : "merge orchestration-owned fields" })),
    ...document.sections.managedPlaylists.filter((item) => managedIds.has(item.playlistId)).map((item) => ({ type: "PLAYLIST_UPDATE", name: item.displayName, resolution: "update enrollment settings" })),
  ];
  return { valid: true, schemaVersion: document.schemaVersion, mode, counts: { managedPlaylists: document.sections.managedPlaylists.length, playlistGroups: document.sections.playlistGroups.length, relationships: document.sections.relationships.length, overlapPolicies: document.sections.overlapPolicies.length }, missingPlaylists, conflicts, creates: { groups: document.sections.playlistGroups.filter((group) => !groupNames.has(group.name.toLowerCase())).map((group) => group.name), managedPlaylists: document.sections.managedPlaylists.filter((item) => !managedIds.has(item.playlistId)).map((item) => item.displayName) }, updates: conflicts.length, skips: missingPlaylists.length, warnings: mode === "replace" ? ["Replace disables existing orchestration enrollments and groups that are absent from the file; unrelated application settings are untouched."] : [], document };
}

export async function applyOrchestrationImport(userId: string, value: unknown, mode: "merge" | "replace", confirmed: boolean) {
  if (!confirmed) throw new Error("Import confirmation is required.");
  const preview = await previewOrchestrationImport(userId, value, mode);
  const document = preview.document;
  const localPlaylists = await prisma.generatedPlaylist.findMany({ where: { userId }, select: { id: true, plexPlaylistRatingKey: true } });
  const playlistByKey = new Map(localPlaylists.map((item) => [item.plexPlaylistRatingKey, item]));
  const libraries = await prisma.library.findMany({ where: { server: { userId } }, select: { id: true, plexId: true, server: { select: { machineIdentifier: true } } } });
  const libraryByKey = new Map(libraries.map((item) => [`${item.server.machineIdentifier}:${item.plexId}`, item.id]));
  const result = await prisma.$transaction(async (tx) => {
    if (mode === "replace") {
      await tx.managedPlaylist.updateMany({ where: { userId, playlistId: { notIn: document.sections.managedPlaylists.map((item) => item.playlistId) } }, data: { enabled: false, automationEnabled: false, automationState: "DISABLED", automationStateReason: "Disabled by confirmed v2.2.9 configuration replacement" } });
      await tx.playlistGroup.updateMany({ where: { userId, name: { notIn: document.sections.playlistGroups.map((item) => item.name) } }, data: { isPaused: true } });
    }
    await tx.systemState.upsert({ where: { key: "playlistOrchestrationSettings" }, create: { key: "playlistOrchestrationSettings", value: JSON.stringify(normalizeOrchestrationSettings(document.sections.runtime)) }, update: { value: JSON.stringify(normalizeOrchestrationSettings(document.sections.runtime)) } });
    const preference = document.sections.preference;
    if (preference) await tx.orchestrationPreference.upsert({ where: { userId }, create: { userId, dashboardTimeRange: String(preference.dashboardTimeRange || "30d"), onboardingStep: Number(preference.onboardingStep || 1), onboardingComplete: preference.onboardingComplete === true, automationLevel: String(preference.automationLevel || "OBSERVE_ONLY"), goalsJson: (preference.goals || []) as Prisma.InputJsonValue, safetySettingsJson: (preference.safetySettings || {}) as Prisma.InputJsonValue, dashboardJson: (preference.dashboard || {}) as Prisma.InputJsonValue }, update: { dashboardTimeRange: String(preference.dashboardTimeRange || "30d"), onboardingStep: Number(preference.onboardingStep || 1), onboardingComplete: preference.onboardingComplete === true, automationLevel: String(preference.automationLevel || "OBSERVE_ONLY"), goalsJson: (preference.goals || []) as Prisma.InputJsonValue, safetySettingsJson: (preference.safetySettings || {}) as Prisma.InputJsonValue, dashboardJson: (preference.dashboard || {}) as Prisma.InputJsonValue } });
    let managedApplied = 0;
    for (const item of document.sections.managedPlaylists) {
      const generated = item.generatedPlaylistRatingKey ? playlistByKey.get(item.generatedPlaylistRatingKey) : null;
      const libraryId = libraryByKey.get(`${item.serverMachineIdentifier}:${item.libraryPlexId}`);
      if (!libraryId || (item.generatedPlaylistRatingKey && !generated)) continue;
      await tx.managedPlaylist.upsert({ where: { userId_playlistId: { userId, playlistId: item.playlistId } }, create: { userId, libraryId, playlistId: item.playlistId, generatedPlaylistId: generated?.id, displayName: item.displayName, enabled: item.enabled, automationEnabled: item.automationEnabled, priority: item.priority, orchestrationMode: item.orchestrationMode, automationState: item.automationEnabled ? "ACTIVE" : "DISABLED" }, update: { libraryId, generatedPlaylistId: generated?.id, displayName: item.displayName, enabled: item.enabled, automationEnabled: item.automationEnabled, priority: item.priority, orchestrationMode: item.orchestrationMode, automationState: item.automationEnabled ? "ACTIVE" : "DISABLED", automationStateReason: null } });
      managedApplied += 1;
    }
    let groupsApplied = 0;
    for (const group of document.sections.playlistGroups) {
      const existing = await tx.playlistGroup.findFirst({ where: { userId, name: { equals: group.name, mode: "insensitive" } } });
      const saved = existing ? await tx.playlistGroup.update({ where: { id: existing.id }, data: { description: group.description, isPaused: group.isPaused, settingsJson: group.settings as Prisma.InputJsonValue, scheduleJson: group.schedule == null ? Prisma.JsonNull : group.schedule as Prisma.InputJsonValue } }) : await tx.playlistGroup.create({ data: { userId, name: group.name, description: group.description, isPaused: group.isPaused, settingsJson: group.settings as Prisma.InputJsonValue, scheduleJson: group.schedule == null ? undefined : group.schedule as Prisma.InputJsonValue } });
      const ids = group.playlistRatingKeys.map((key) => playlistByKey.get(key)?.id).filter((id): id is string => Boolean(id));
      if (mode === "replace") await tx.playlistGroupMembership.deleteMany({ where: { playlistGroupId: saved.id } });
      for (let index = 0; index < ids.length; index += 1) { const playlistId = ids[index]; await tx.playlistGroupMembership.upsert({ where: { playlistGroupId_playlistId: { playlistGroupId: saved.id, playlistId } }, create: { playlistGroupId: saved.id, playlistId, sortOrder: (index + 1) * 1_000 }, update: { sortOrder: (index + 1) * 1_000 } }); }
      groupsApplied += 1;
    }
    const savedManaged = await tx.managedPlaylist.findMany({ where: { userId }, select: { id: true, playlistId: true } });
    const managedByPlex = new Map(savedManaged.map((item) => [item.playlistId, item.id]));
    if (mode === "replace") await tx.managedPlaylistRelationship.deleteMany({ where: { sourceManagedPlaylist: { userId } } });
    let relationshipsApplied = 0;
    for (const relation of document.sections.relationships) {
      const sourceManagedPlaylistId = managedByPlex.get(relation.sourcePlaylistId), targetManagedPlaylistId = managedByPlex.get(relation.targetPlaylistId);
      if (!sourceManagedPlaylistId || !targetManagedPlaylistId || sourceManagedPlaylistId === targetManagedPlaylistId) continue;
      await tx.managedPlaylistRelationship.upsert({ where: { sourceManagedPlaylistId_targetManagedPlaylistId_relationshipType: { sourceManagedPlaylistId, targetManagedPlaylistId, relationshipType: relation.relationshipType } }, create: { sourceManagedPlaylistId, targetManagedPlaylistId, relationshipType: relation.relationshipType, enabled: relation.enabled, priority: relation.priority }, update: { enabled: relation.enabled, priority: relation.priority } });
      relationshipsApplied += 1;
    }
    if (mode === "replace") await tx.playlistPairPolicy.deleteMany({ where: { userId } });
    let overlapPoliciesApplied = 0;
    for (const policy of document.sections.overlapPolicies) {
      const playlistAId = policy.playlistARatingKey ? playlistByKey.get(policy.playlistARatingKey)?.id : null, playlistBId = policy.playlistBRatingKey ? playlistByKey.get(policy.playlistBRatingKey)?.id : null;
      if (!playlistAId || !playlistBId || playlistAId === playlistBId) continue;
      const data = { ignored: policy.ignored, allowedTrackOverlapPercent: policy.allowedTrackOverlapPercent, allowedArtistOverlapPercent: policy.allowedArtistOverlapPercent, allowedAlbumOverlapPercent: policy.allowedAlbumOverlapPercent, maximumSharedTrackCount: policy.maximumSharedTrackCount, notes: policy.notes };
      await tx.playlistPairPolicy.upsert({ where: { userId_playlistAId_playlistBId: { userId, playlistAId, playlistBId } }, create: { userId, playlistAId, playlistBId, ...data }, update: data });
      overlapPoliciesApplied += 1;
    }
    if (document.sections.crossPlaylistVariety) { const data = allow(document.sections.crossPlaylistVariety, ["maximumTrackOverlapPercent", "maximumArtistOverlapPercent", "maximumAlbumOverlapPercent", "maximumSharedTrackCount", "minimumUniqueTrackPercent", "minimumUniqueTrackCount", "recentUsageLookbackDays", "recentUsagePenaltyStrength", "sharedTrackAllowance", "coreTrackAllowance", "exclusivityBehavior", "automaticRepairEnabled", "requireRepairPreview", "comparisonScope", "analysisConcurrency", "analysisBatchSize"]) as any; await tx.crossPlaylistVarietySetting.upsert({ where: { userId }, create: { userId, ...data }, update: data }); }
    if (document.sections.smartActionPreferences) { const data = allow(document.sections.smartActionPreferences, ["enabled", "generateDuringNightlySync", "generateAfterPlaylistCreation", "generateAfterMetadataAnalysis", "minimumConfidenceToDisplay", "highConfidenceThreshold", "mediumConfidenceThreshold", "maximumPendingActions", "expireAfterDays", "recommendationTypesJson", "maintenanceEnabled", "maintenanceStartTime", "maintenanceDaysJson", "maximumActionsPerWindow", "maximumPlaylistsPerWindow", "maximumConcurrentActions", "allowPlexRefreshes", "allowMetadataChanges", "allowPlaylistRegeneration", "pauseDuringPlayback", "automationEmergencyDisabled"]) as any; await tx.smartActionSetting.upsert({ where: { userId }, create: { userId, ...data }, update: data }); }
    if (mode === "replace") await tx.smartActionAutomationPolicy.deleteMany({ where: { userId } });
    for (const policy of document.sections.smartActionPolicies) { const data = allow(policy, ["actionType", "enabled", "minimumConfidence", "maximumRisk", "maximumPerWindow"]) as any; if (!data.actionType) continue; await tx.smartActionAutomationPolicy.upsert({ where: { userId_actionType: { userId, actionType: data.actionType } }, create: { userId, ...data }, update: data }); }
    if (document.sections.experimentDefaults) { const data = allow(document.sections.experimentDefaults, ["enabled", "defaultDurationType", "defaultDurationTarget", "defaultPublicationMode", "minimumPlaybackSessions", "minimumTrackInteractions", "minimumDurationHours", "minimumResultDifference", "minimumConfidence", "allowPlaybackMetrics", "automaticallyEvaluate", "automaticallyPauseMissingPlaylists", "historyRetentionDays", "showAdvancedControls", "allowMultiVariableExperiments", "notificationsEnabled"]) as any; await tx.smartExperimentSetting.upsert({ where: { userId }, create: { userId, ...data }, update: data }); }
    if (document.sections.healthThresholds) { const data = allow(document.sections.healthThresholds, ["enabled", "analyzeDuringNightlySync", "staleAfterDays", "artistConcentrationPercent", "albumConcentrationPercent", "excessiveBpmJump", "moodConflictDelta", "metadataDeclinePercent", "minimumAlertSeverity", "inAppNotifications"]) as any; await tx.playlistHealthSetting.upsert({ where: { userId }, create: { userId, ...data }, update: data }); }
    await tx.playlistOrchestrationAuditEvent.create({ data: { userId, eventType: "CONFIGURATION_IMPORTED", actorType: "USER", actorId: userId, operationType: "IMPORT", outcome: "SUCCESS", message: `Orchestration configuration ${mode} import completed.`, metadataJson: { managedApplied, groupsApplied, relationshipsApplied, overlapPoliciesApplied, skippedMissingPlaylists: preview.missingPlaylists.length } } });
    return { managedApplied, groupsApplied, relationshipsApplied, overlapPoliciesApplied };
  });
  return { ...result, skipped: preview.missingPlaylists.length, preview: { counts: preview.counts, missingPlaylists: preview.missingPlaylists } };
}
