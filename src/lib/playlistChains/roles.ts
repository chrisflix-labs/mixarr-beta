import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { BUILT_IN_ROLE_PRESETS, resolveRoleGuidance, roleGuidanceDifferences } from "./presets";
import { roleAssignmentInputSchema, roleDefinitionInputSchema } from "./types";

const json = (value: unknown) => value as Prisma.InputJsonValue;
function createRoleKeySuffix() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
function validateRoleRange(value: { defaultBpmMin?: number | null; defaultBpmMax?: number | null }) {
  if (value.defaultBpmMin != null && value.defaultBpmMax != null && value.defaultBpmMin > value.defaultBpmMax) throw new Error("Minimum BPM cannot exceed maximum BPM.");
}

function guidanceFromDefinition(definition: any) {
  return {
    energyStart: definition.defaultEnergyStart ?? null,
    energyEnd: definition.defaultEnergyEnd ?? null,
    bpmMin: definition.defaultBpmMin ?? null,
    bpmMax: definition.defaultBpmMax ?? null,
    discoveryLevel: definition.defaultDiscoveryLevel ?? null,
    transitionMode: definition.defaultTransitionMode ?? null,
    moodDirection: definition.defaultMoodDirection ?? null,
    settings: (definition.defaultSettingsJson || {}) as Record<string, unknown>,
  };
}

export async function ensureBuiltInPlaylistRoles() {
  await prisma.$transaction(BUILT_IN_ROLE_PRESETS.map((preset) => prisma.playlistRoleDefinition.upsert({
    where: { key: preset.key },
    create: {
      id: preset.id, key: preset.key, name: preset.name, description: preset.description, isBuiltIn: true,
      defaultEnergyStart: preset.energyStart, defaultEnergyEnd: preset.energyEnd, defaultBpmMin: preset.bpmMin,
      defaultBpmMax: preset.bpmMax, defaultDiscoveryLevel: preset.discoveryLevel,
      defaultTransitionMode: preset.transitionMode, defaultMoodDirection: preset.moodDirection,
      defaultSettingsJson: json(preset.settings),
    },
    update: {
      name: preset.name, description: preset.description, isBuiltIn: true,
      defaultEnergyStart: preset.energyStart, defaultEnergyEnd: preset.energyEnd, defaultBpmMin: preset.bpmMin,
      defaultBpmMax: preset.bpmMax, defaultDiscoveryLevel: preset.discoveryLevel,
      defaultTransitionMode: preset.transitionMode, defaultMoodDirection: preset.moodDirection,
      defaultSettingsJson: json(preset.settings),
    },
  })));
}

export async function listPlaylistRoles(userId: string) {
  await ensureBuiltInPlaylistRoles();
  const definitions = await prisma.playlistRoleDefinition.findMany({
    where: { OR: [{ isBuiltIn: true }, { userId }] },
    orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
  });
  return definitions.map((definition) => ({ ...definition, guidance: guidanceFromDefinition(definition) }));
}

export async function createPlaylistRole(userId: string, raw: unknown) {
  const input = roleDefinitionInputSchema.parse(raw);
  validateRoleRange(input);
  const key = `custom-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "role"}-${createRoleKeySuffix()}`;
  return prisma.playlistRoleDefinition.create({ data: {
    userId, key, name: input.name, description: input.description, isBuiltIn: false,
    defaultEnergyStart: input.defaultEnergyStart, defaultEnergyEnd: input.defaultEnergyEnd,
    defaultBpmMin: input.defaultBpmMin, defaultBpmMax: input.defaultBpmMax,
    defaultDiscoveryLevel: input.defaultDiscoveryLevel, defaultTransitionMode: input.defaultTransitionMode,
    defaultMoodDirection: input.defaultMoodDirection, defaultSettingsJson: json(input.defaultSettings),
  } });
}

export async function updatePlaylistRole(userId: string, roleId: string, raw: unknown) {
  const input = roleDefinitionInputSchema.partial().parse(raw);
  const current = await prisma.playlistRoleDefinition.findFirst({ where: { id: roleId, userId, isBuiltIn: false } });
  if (!current) throw new Error("Custom playlist role not found.");
  validateRoleRange({ defaultBpmMin: input.defaultBpmMin === undefined ? current.defaultBpmMin : input.defaultBpmMin, defaultBpmMax: input.defaultBpmMax === undefined ? current.defaultBpmMax : input.defaultBpmMax });
  return prisma.playlistRoleDefinition.update({ where: { id: roleId }, data: {
    ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.defaultEnergyStart !== undefined ? { defaultEnergyStart: input.defaultEnergyStart } : {}), ...(input.defaultEnergyEnd !== undefined ? { defaultEnergyEnd: input.defaultEnergyEnd } : {}),
    ...(input.defaultBpmMin !== undefined ? { defaultBpmMin: input.defaultBpmMin } : {}), ...(input.defaultBpmMax !== undefined ? { defaultBpmMax: input.defaultBpmMax } : {}),
    ...(input.defaultDiscoveryLevel !== undefined ? { defaultDiscoveryLevel: input.defaultDiscoveryLevel } : {}),
    ...(input.defaultTransitionMode !== undefined ? { defaultTransitionMode: input.defaultTransitionMode } : {}),
    ...(input.defaultMoodDirection !== undefined ? { defaultMoodDirection: input.defaultMoodDirection } : {}),
    ...(input.defaultSettings !== undefined ? { defaultSettingsJson: json(input.defaultSettings) } : {}),
  } });
}

export async function deletePlaylistRole(userId: string, roleId: string) {
  const definition = await prisma.playlistRoleDefinition.findFirst({ where: { id: roleId, userId, isBuiltIn: false }, include: { _count: { select: { assignments: true, progressionMemberships: true } } } });
  if (!definition) throw new Error("Custom playlist role not found.");
  if (definition._count.assignments || definition._count.progressionMemberships) throw new Error("Remove this role from playlists and chains before deleting it.");
  await prisma.playlistRoleDefinition.delete({ where: { id: roleId } });
  return { deleted: true };
}

async function ownedPlaylist(userId: string, playlistId: string) {
  const playlist = await prisma.generatedPlaylist.findFirst({ where: { id: playlistId, userId }, select: { id: true } });
  if (!playlist) throw new Error("Playlist not found.");
  return playlist;
}

export async function getPlaylistRoleAssignment(userId: string, playlistId: string) {
  await ownedPlaylist(userId, playlistId);
  const assignment = await prisma.playlistRoleAssignment.findUnique({ where: { playlistId }, include: { roleDefinition: true } });
  if (!assignment) return null;
  const recommended = guidanceFromDefinition(assignment.roleDefinition);
  const resolved = resolveRoleGuidance(recommended, (assignment.settingsOverrideJson || {}) as Record<string, unknown>);
  return { ...assignment, recommended, resolved, differences: roleGuidanceDifferences(recommended, resolved) };
}

export async function assignPlaylistRole(userId: string, playlistId: string, raw: unknown) {
  await ownedPlaylist(userId, playlistId);
  await ensureBuiltInPlaylistRoles();
  const input = roleAssignmentInputSchema.parse(raw);
  const definition = await prisma.playlistRoleDefinition.findFirst({ where: { id: input.roleDefinitionId, OR: [{ isBuiltIn: true }, { userId }] } });
  if (!definition) throw new Error("Playlist role not found.");
  if (definition.key === "custom" && !input.customRoleName) throw new Error("A name is required for the Custom role.");
  await prisma.playlistRoleAssignment.upsert({
    where: { playlistId },
    create: { playlistId, roleDefinitionId: definition.id, customRoleName: input.customRoleName, behaviorMode: input.behaviorMode, settingsOverrideJson: json(input.settingsOverride) },
    update: { roleDefinitionId: definition.id, customRoleName: input.customRoleName, behaviorMode: input.behaviorMode, settingsOverrideJson: json(input.settingsOverride) },
  });
  console.info("[PlaylistChains] playlist role changed", { userId, playlistId, roleKey: definition.key, behaviorMode: input.behaviorMode });
  return getPlaylistRoleAssignment(userId, playlistId);
}

export async function removePlaylistRole(userId: string, playlistId: string) {
  await ownedPlaylist(userId, playlistId);
  await prisma.playlistRoleAssignment.deleteMany({ where: { playlistId } });
  console.info("[PlaylistChains] playlist role removed", { userId, playlistId });
  return { removed: true };
}

export async function copyPlaylistRole(userId: string, targetPlaylistId: string, sourcePlaylistId: string) {
  await Promise.all([ownedPlaylist(userId, targetPlaylistId), ownedPlaylist(userId, sourcePlaylistId)]);
  const source = await prisma.playlistRoleAssignment.findUnique({ where: { playlistId: sourcePlaylistId } });
  if (!source) throw new Error("The source playlist has no role to copy.");
  await prisma.playlistRoleAssignment.upsert({
    where: { playlistId: targetPlaylistId },
    create: { playlistId: targetPlaylistId, roleDefinitionId: source.roleDefinitionId, customRoleName: source.customRoleName, behaviorMode: source.behaviorMode, settingsOverrideJson: source.settingsOverrideJson as Prisma.InputJsonValue },
    update: { roleDefinitionId: source.roleDefinitionId, customRoleName: source.customRoleName, behaviorMode: source.behaviorMode, settingsOverrideJson: source.settingsOverrideJson as Prisma.InputJsonValue },
  });
  return getPlaylistRoleAssignment(userId, targetPlaylistId);
}

export async function restorePlaylistRoleDefaults(userId: string, playlistId: string) {
  await ownedPlaylist(userId, playlistId);
  const result = await prisma.playlistRoleAssignment.updateMany({ where: { playlistId }, data: { settingsOverrideJson: {} } });
  if (!result.count) throw new Error("This playlist does not have a role.");
  return getPlaylistRoleAssignment(userId, playlistId);
}

export function applyRoleGuidanceToPlaylistConfig(config: any, assignment: any) {
  if (!assignment || assignment.behaviorMode !== "APPLY") return config;
  const recommended = guidanceFromDefinition(assignment.roleDefinition);
  const guidance = resolveRoleGuidance(recommended, (assignment.settingsOverrideJson || {}) as Record<string, unknown>);
  const next = { ...config, tuningConfig: { ...(config.tuningConfig || {}) } };
  const tuning = next.tuningConfig;
  const discovery = { ...(tuning.discovery || {}) };
  if (guidance.discoveryLevel != null && discovery.level == null) discovery.level = guidance.discoveryLevel >= 0.7 ? "high" : guidance.discoveryLevel <= 0.3 ? "low" : "medium";
  if (guidance.bpmMin != null && guidance.bpmMax != null && !tuning.bpmFlow?.enabled) tuning.bpmFlow = { ...(tuning.bpmFlow || {}), enabled: true, mode: guidance.energyEnd != null && guidance.energyStart != null && guidance.energyEnd < guidance.energyStart ? "RAMP_DOWN" : "RAMP_UP", startingBpmMode: "AUTO", maxPreferredGap: 8, strength: 65, allowJumps: false, halfDoubleTimeMatching: true };
  tuning.discovery = discovery;
  return next;
}
